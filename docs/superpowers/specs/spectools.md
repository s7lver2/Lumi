# Darkroom 2 · 3 — Infraestructura de herramientas

Parte de Darkroom 2 (ver `2026-09-22-darkroom2-00-indice-design.md`). Esta pieza llega antes
de las galerías y las herramientas de análisis: define cómo una fuente se ejecuta, cómo se
cargan los modelos, cómo se sale de la red y cómo una sugerencia de IA se mantiene separada de
la decisión del investigador.

## Resumen

Darkroom gana un registro único de herramientas y sus capacidades. Cada herramienta declara
qué fuentes admite, qué resultados produce, qué modelos, servicios externos y nivel de
hardware necesita. `lumid` usa ese registro para validar una fuente, encolar trabajo y decir
con honestidad por qué algo no está disponible.

La ejecución local vive en workers de proceso largo. Un gestor de VRAM carga los modelos bajo
demanda y libera el menos usado cuando hace falta espacio. Un único servicio VLM/LLM caliente
atiende a las herramientas que necesitan descripción o auditoría; puede ser local o un endpoint
compatible con OpenAI, decidido por modelo y nivel.

Los servicios externos no son dependencias implícitas: el administrador los habilita uno a
uno, configura su clave y límite, y cada envío deja una entrada exacta en la bitácora encadenada
del caso. Los módulos activos vienen deshabilitados y advierten antes de actuar.

El auditor IA es una capa común y opcional. Solo propone un veredicto explicable; jamás cambia
la revisión humana de un resultado, puede abstenerse y no se habilita hasta superar una
calibración registrada.

---

## Parte 1 — El registro de herramientas

### 1.1 Una fuente solo se crea si se puede ejecutar

`fuentes.rs` (creado por el spec 2) deja de contener una lista fija. Pasa a exponer un registro
estático de `Herramienta` y `TipoFuente`:

```rust
pub struct Herramienta {
    pub id: &'static str,
    pub nombre: &'static str,
    pub tipos: &'static [&'static str],
    pub resultado: TipoResultado,
    pub worker: Option<&'static str>,
    pub requisitos: RequisitosHerramienta,
}
```

- `id` es estable y se guarda en `sources.herramienta`; no se deriva del nombre visible.
- `tipos` declara las entradas que admite. El diálogo «Añadir fuente» solo enseña una
  combinación tipo/herramienta válida.
- `resultado` declara si una fila puede tener coordenadas, pista de región, imagen candidata o
  convertirse en una fuente derivada. La interfaz no inventa acciones para resultados que no
  las soportan.
- `requisitos` reúne nivel mínimo, modelos, servicios externos opcionales y si hay módulos
  activos. Es la única fuente de la matriz de capacidades.

El registro inicial conserva `geolocalizar` y añade solo la infraestructura, no nuevas
herramientas de cara al investigador. OSINT, Car ID, Verify Image, Interiores, Objetos y
Especies se registran en sus respectivos specs. Ningún tipo de fuente aparece hasta que su
herramienta esté registrada y disponible.

### 1.2 Matriz de capacidades

`GET /v1/capacidades` devuelve cada herramienta y cada módulo con uno de estos estados:

| Estado | Significado en la interfaz |
|---|---|
| `disponible` | se puede lanzar en este servidor y nivel |
| `no_instalado` | falta un modelo o worker; indica cuál |
| `sin_vram` | el nivel elegido no tiene presupuesto suficiente |
| `sin_servicio` | el administrador no habilitó/configuró el servicio requerido |
| `deshabilitado` | un módulo activo o el auditor no están autorizados |
| `no_compatible` | el tipo de fuente no admite esa herramienta |

El cliente reutiliza este dato tanto en «Añadir fuente» como en el cajón. Las opciones no se
ocultan: aparecen deshabilitadas, con el motivo en texto y tooltip. Una petición al servidor
revalida el estado; el cliente nunca es la autoridad.

### 1.3 Contrato de worker

Los workers siguen el contrato JSON-lines de Lumi: `lumid` les entrega una tarea autocontenida
por `stdin` y recibe progreso, resultados y error estructurado por `stdout`. El contrato común
añade:

```json
{
  "task_id": "…",
  "tool": "car_id",
  "source": { "id": 42, "type": "imagen", "sha256": "…", "path": "…" },
  "level": "pro",
  "models": [{ "id": "…", "version": "…" }],
  "options": { "auditor": false }
}
```

Un resultado lleva `titulo`, `orden`, `puntuacion`, `datos` (JSON canónico), `origen` y,
cuando proceda, coordenadas, una pista de región o una propuesta de fuente derivada. `origen`
identifica modelo/versión, módulo y, si hubo red, servicio y momento de consulta. No contiene
secretos ni una API key.

Los workers no escriben SQLite, no llaman a servicios externos directamente y no deciden
`revision`. `lumid` persiste los resultados, crea la entrada de bitácora correspondiente y
emite los eventos SSE del spec 2. Un error de worker queda como intento fallido de la fuente,
con el motivo técnico visible en mono, sin fabricar resultados parciales como concluyentes.

---

## Parte 2 — Modelos, niveles y memoria

### 2.1 Manifiestos instalables

Cada modelo vive en `registros/modelos/<id>.json`, con id, versión, licencia, hash, tamaño,
papel, VRAM/RAM estimadas y fecha de «entrenado hasta» si clasifica un dominio que caduca.
`registros/niveles/{mini,pro,vision}.json` no enumera modelos por pantalla: asigna a cada
herramienta el papel que puede usar cada nivel y el presupuesto que consume.

Mini mantiene el objetivo de 8 GB de VRAM y 16 GB de RAM; Pro, 12/32 GB; Vision, 24 GB o más,
o un endpoint externo para el modelo de lenguaje. Si falta un modelo, la matriz lo dice antes
de crear una fuente.

Las licencias marcadas como pendientes de verificación en la investigación no se incorporan a
un manifiesto instalable hasta confirmarlas. El spec no convierte una licencia incierta en una
autorización de distribución o uso comercial.

### 2.2 Gestor de VRAM

`lumid` mantiene un `GestorModelos` por GPU, con reserva por tarea y una lista LRU de modelos
residentes. Antes de iniciar un worker:

1. calcula la reserva del modelo y de la tarea;
2. reutiliza pesos ya cargados si coinciden id y versión;
3. descarga el modelo residente menos usado que no esté prestado;
4. si aún no cabe, deja la fuente en cola con `sin_vram` en vez de provocar OOM.

Un modelo no se descarga mientras una tarea lo usa. El worker informa de carga, inferencia y
liberación; la cola muestra estados reales, nunca porcentaje inventado. Fallos de memoria se
registran como error de ejecución y no rebajan silenciosamente al siguiente nivel.

### 2.3 Servicio VLM/LLM compartido

`lumid` expone internamente un solo adaptador para un VLM/LLM caliente. Sus clientes le piden
salida estructurada contra un esquema; no reciben texto libre como dato de producto. Cada
modelo y nivel puede apuntar a local, OpenRouter o cualquier endpoint compatible con OpenAI.

La configuración externa es de administrador y usa secreto almacenado como las API keys de
Lumi. Enviar texto, imagen o metadatos al endpoint es una salida externa: se anuncia en la
herramienta, requiere que el servicio esté habilitado y se audita como cualquier otro envío.

---

## Parte 3 — Servicios externos y módulos activos

### 3.1 Un adaptador, una política

`crates/lumid/src/externos.rs` define un trait para los adaptadores de red. Cada adaptador
declara identificador, proveedor, qué datos recibe, qué devuelve, si es pasivo o activo,
configuración requerida, límite de tasa y texto de advertencia. Las implementaciones no leen
la configuración del usuario ni hacen HTTP fuera de este módulo.

La configuración de administrador contiene `habilitado`, credencial, límite y, para módulos
activos, una segunda confirmación explícita. Una prueba de conexión no se ejecuta al guardar:
es un botón separado que genera su propia auditoría.

### 3.2 Envío y auditoría

Antes de una llamada se crea una entrada `externo.enviado` en la misma transacción que deja el
trabajo en curso. Incluye caso, usuario, herramienta, adaptador, propósito técnico, campos
enviados y el `sha256` de una imagen si se transmitió. Tras la respuesta se añade
`externo.respondido` con código, duración y resumen; nunca respuesta íntegra que pueda contener
datos personales ajenos.

El investigador ve, antes de lanzar, «Se enviará X a Y». Si el adaptador es activo ve además
la consecuencia concreta, por ejemplo que puede notificar al titular o que el escaneo saldrá
desde la IP del servidor. Los módulos activos nacen apagados y requieren tanto habilitación del
admin como clic de confirmación por ejecución.

### 3.3 Límite de alcance

Este núcleo no incorpora scraping general, cookies de cuentas ni acceso mediante credenciales.
Cada proveedor futuro debe pasar por el adaptador y declarar su comportamiento. GHunt queda
fuera por requerir cookie de Google; SpiderFoot queda fuera por agrupar demasiados módulos sin
control individual. La herramienta no solicita al investigador su base legal o finalidad: la
bitácora deja trazabilidad, pero no sustituye sus obligaciones organizativas.

---

## Parte 4 — Auditor IA y pistas de región

### 4.1 Auditor separado de la revisión

El auditor recibe resultados ya generados, el contexto mínimo de la fuente y evidencias
permitidas por la herramienta. Devuelve exactamente uno de:

`probable`, `no_concluyente`, `probable_falso_positivo` o `abstencion`, más una explicación
breve, el modelo/version y la evidencia usada. Se guarda en `resultados.auditoria_json`; no
sobrescribe `revision`, no altera el orden original y no crea ni elimina resultados.

La UI atenúa los posibles falsos positivos pero los conserva. La persona sigue marcando Sin
revisar, Confirmado o Descartado. Para fuentes de persona, toda coincidencia nace sin revisar:
el auditor puede señalar un posible homónimo, nunca confirmar identidad.

### 4.2 Calibración antes de habilitar

Un modelo/auditor no está disponible por instalarse. El administrador crea una calibración con
un conjunto etiquetado por herramienta, umbrales publicados y fecha. Lumi guarda versión del
modelo, conjunto, métricas y decisión de habilitar/deshabilitar. Si cambia el modelo o el
prompt/esquema, la calibración caduca y el auditor vuelve a `deshabilitado`.

No se fija una cifra universal de precisión: cada spec de herramienta define su conjunto y
criterio de aceptación. La matriz muestra «sin calibrar» hasta entonces, no una promesa de
fiabilidad.

### 4.3 Pistas de región

Una herramienta puede devolver una o varias pistas de región: geometría o área, confianza,
motivo, evidencia y procedencia. Se persisten en `pistas_region` vinculadas al resultado y se
dibujan con las reglas del spec 2. Mientras estén sin revisar o descartadas no cambian la
geolocalización. Al confirmarlas, `lumid` conserva qué hipótesis se reponderó, el factor y la
pista que lo produjo; esa acción también va a la bitácora. La aplicación no debe presentar una
pista como coordenada exacta.

---

## Parte 5 — API y superficie a tocar

| Dónde | Qué |
|---|---|
| `crates/lumid/src/fuentes.rs` | registro de herramientas, tipos, resultados y requisitos |
| `crates/lumid/src/modelos.rs` *(nuevo)* | manifiestos, niveles, `GestorModelos` y reservas de VRAM |
| `crates/lumid/src/externos.rs` *(nuevo)* | trait de adaptador, políticas, rate limiting y auditoría |
| `crates/lumid/src/auditor.rs` *(nuevo)* | cliente VLM/LLM, esquema, calibración y persistencia |
| `crates/lumid/src/pistas.rs` *(nuevo)* | persistir, confirmar/descartar y reponderar pistas |
| `crates/lumid/src/store.rs` | tablas de configuración, calibraciones, pistas y metadatos de modelos |
| `crates/lumid/src/queue/mod.rs` | reserva/liberación de modelos, contrato de worker y errores |
| `crates/lumid/src/routes/{capabilities,externos,calibracion}.rs` *(nuevos)* | matriz, administración de servicios y calibración |
| `crates/lumi-proto/src/api.rs` | `Capacidad`, `EstadoCapacidad`, `VeredictoAuditor`, `PistaRegion` y eventos SSE |
| `client/src/lib/api.ts` | tipos y llamadas |
| `client/src/work/AñadirFuente.tsx`, `CajonFuente.tsx` | motivos de capacidad, aviso externo y auditoría |
| `client/src/admin/*` | matriz de capacidades, servicios, secretos y calibraciones |
| `registros/modelos/`, `registros/niveles/` | manifiestos instalables y papeles por nivel |

La API mínima es `GET /v1/capacidades`, `GET/PUT /v1/admin/externos/:id`,
`POST /v1/admin/externos/:id/probar`, `GET/POST /v1/admin/calibraciones` y
`PATCH /v1/pistas/:id`. Todas las escrituras de caso pasan por `guard_case`; todas las de
administración exigen el permiso de administración existente.

---

## Parte 6 — Lo que este spec no hace

- No añade OSINT, Car ID, galerías, Verify Image, Interiores, Objetos ni Especies como
  herramientas utilizables.
- No elige ni descarga pesos de modelos ni valida licencias pendientes.
- No entrena clasificadores ni una cabeza de atribución de generadores.
- No automatiza matrícula → titular, scraping de portales, ni acceso con cookies.
- No convierte al LLM en planificador autónomo de investigaciones: en este ciclo es auditor
  estructurado de resultados producidos por módulos deterministas.
- No rediseña Darkroom, el caso normal, el mapa ni el candado del caso.

## Verificación

Se añaden tests de `lumid` para: resolución del registro y estados de capacidad; validación de
que una combinación fuente/herramienta inválida no se encola; reserva LRU sin descargar un
modelo prestado; serialización del contrato JSON-lines; rechazo de un adaptador deshabilitado;
dos entradas de auditoría por una llamada externa; caducidad de calibración al cambiar versión;
y confirmación de una pista sin reponderación antes de ella.

El cierre manual es: un servidor Mini sin modelo muestra un motivo honesto; Pro carga dos
modelos compatibles sin OOM y libera el menos usado; un servicio externo habilitado muestra
exactamente lo que se enviará y deja la cadena de actividad íntegra; un auditor sin calibrar no
aparece disponible; y una pista confirmada explica qué hipótesis cambió y por qué.
