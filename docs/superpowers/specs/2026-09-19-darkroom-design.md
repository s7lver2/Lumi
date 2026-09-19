# Darkroom: el caso como unidad de trabajo

## Resumen

Darkroom es una segunda forma de trabajar un caso dentro de Lumi: en vez de subir una
foto y que el sistema responda dónde se tomó, el investigador **compone su propia cadena
de análisis** encadenando herramientas. Sustituye por completo al subsistema de agentes
(5c), que se borra.

Este primer spec **no construye el grafo de herramientas**. Construye lo que tiene que
existir debajo para que quepa, y deja la pantalla con una palabra dentro. Son cuatro
cosas:

| # | Qué | Por qué ahora |
|---|---|---|
| 1 | Los agentes se borran enteros | Hoy no funcionan (ver §1); y Darkroom ocupa su sitio |
| 2 | El caso nace con un **backend**: `normal` o `darkroom` | Es la frontera entre las dos apps |
| 3 | El candado **baja de proyecto a caso** | Varias personas por proyecto, una por caso |
| 4 | La pantalla Darkroom existe y dice «ola» | Demuestra el enrutado de extremo a extremo |

El hilo que une las cuatro: **el caso pasa a ser la unidad de trabajo**. Hoy no lo es —
el backend se elige por análisis y el candado se toma por proyecto. Después de este
spec, un caso es una cosa con su modo y su dueño temporal, que es lo que Darkroom
necesita para existir.

---

## Parte 0 — Qué es Darkroom (el destino, no este spec)

Se escribe aquí porque las decisiones de andamiaje solo se entienden sabiendo hacia
dónde van. **Nada de esta sección se implementa en este spec.**

Dentro de un caso Darkroom, el investigador crea **archivos**. Cada archivo tiene una
**clase**, y cada clase es una herramienta. Al abrir un archivo, el panel central muestra
el resultado de ejecutar esa herramienta y el panel lateral muestra sus **propiedades**.

La propiedad principal, la que tienen todas, es el **source**: de dónde viene la
información. Un source puede ser un valor directo (una cadena, una imagen subida) o
**el resultado de otro archivo**. Ahí está la idea entera: los archivos se encadenan.

El ejemplo del dueño, literal: se sube la foto de un coche, se crea un archivo de clase
`text_identifier`, y después otro de clase `carplate_research` cuyo source es el
`text_identifier`. El resultado es la matrícula del coche.

Algunas propiedades no se escriben, se **dibujan**: recortar una zona con un rectángulo,
un lazo o una varita mágica sobre la imagen de origen.

### Por qué esto sustituye a los agentes, y no solo los reemplaza

Los agentes eran ocho preguntas cerradas, fijadas en un catálogo, que el sistema hacía
siempre en el mismo orden: qué escritura se ve, de qué lado se conduce, qué vegetación
hay. El investigador no elegía nada y no veía el razonamiento, solo el veredicto y una
cifra de confianza.

Darkroom invierte quién decide. El investigador construye la cadena, y cada eslabón queda
registrado como un archivo con su source. Para una herramienta forense esa diferencia no
es cosmética: es la diferencia entre «la máquina dijo que es España con 0,87» y «esta es
la cadena de inferencia, míratela paso a paso». La trazabilidad deja de ser una promesa y
pasa a ser la estructura de datos.

### Lo que este spec deja deliberadamente sin diseñar

Archivos, clases, propiedades, tipos de source, encadenamiento, ejecución, herramientas
de dibujo, y la disposición de los dos paneles. Todo eso es el spec 2. Aquí solo se fija
que **el caso sabe que es Darkroom** y que **una sola persona lo tiene abierto**, que son
las dos premisas sobre las que el spec 2 podrá apoyarse sin rehacer nada.

---

## Parte 1 — Fase 0: borrar los agentes

### Por qué se borran, y por qué va primero

El subsistema de agentes (5c) se retira entero. Hay dos razones y conviene no
confundirlas:

1. **Darkroom ocupa su sitio.** Es la razón de producto.
2. **Hoy no funcionan.** Es la razón técnica, y es independiente de Darkroom. La
   auditoría del 2026-09-19 (`2026-09-19-optimizacion-extrema-design.md`, §5) encontró
   dos defectos que juntos hacen que los agentes probablemente no emitan ni un veredicto:
   `registros/motores/qwen3-vl.json` pide `"cuantizacion": "4bit"` pero `bitsandbytes`
   no se instala en ninguna parte del repo (`grep` = 0 coincidencias), así que el motor
   VLM falla al cargar y queda marcado `None` de por vida; y los ids de agentes de
   `registros/niveles/mini.json` y `pro.json` son los del diseño anterior al rediseño del
   2026-09-17, filtrados en silencio por `lumi_agentes.py:146`, de modo que solo el nivel
   `vision` llega a pedir agentes.

La segunda razón es la que justifica que esta fase vaya **primero y pueda ejecutarse
sola**: es código muerto que nadie puede usar, así que no tiene que esperar a que el
diseño de Darkroom esté cerrado.

Y hay un motivo mecánico para el orden: las dos fases tocan los mismos ficheros
(`queue/mod.rs`, `store.rs`, `routes/cases.rs`, `client/src/lib/api.ts`). En serie no se
pisan. Borrar primero deja el árbol sin el `tokio::join!` ni `correr_agente_unico` cuando
llegue el andamiaje de Darkroom.

### Dimensión

~75 ficheros tocados, ~3.850 líneas. De ellas ~2.900 son borrado puro en 22 ficheros
completos:

| Capa | Ficheros borrados enteros | Líneas |
|---|---|---|
| Daemon | `crates/lumid/src/agentar.rs`, `routes/agentes.rs` | 337 |
| Crate compartido | `crates/lumi-index/src/agentes.rs` | 407 |
| Python | `workers/lumi_agentes.py`, `tools/evaluar_agentes.py` | 353 |
| Cliente | `AgentPickerPopup.tsx`, `AgentResultPopup.tsx`, `AgenteIcono.tsx` | 720 |
| Web | `web/components/AgentesVisual.tsx`, `docs/como-funciona/agentes/`, `EsquemaAgente.tsx` | ~780 |
| Datos | `registros/agentes/` (8 fichas), `niveles/agentes.json`, `motores/qwen3-vl.json` | ~170 |
| Pruebas | `pruebas/agentes/` | ~40 |

El resto son ~950 líneas de ediciones quirúrgicas en 53 ficheros, concentradas en
`queue/mod.rs`, `store.rs`, `routes/export.rs`, `routes/analyses.rs`,
`lumi-proto/src/api.rs` y `worker.rs`.

### Las tres trampas

Están localizadas y hay que respetarlas o el borrado rompe cosas ajenas:

1. **`BetaPill` vive dentro de lo que se borra.** Se exporta desde
   `client/src/work/AgentPickerPopup.tsx:128` y lo importa `ModelPicker.tsx:3`. Hay que
   reubicarlo (a `client/src/ui/`) **antes** de borrar su fichero, o el cliente no
   compila.
2. **`crates/lumid/src/persistente.rs` lo comparte la verificación geométrica.**
   `queue/mod.rs:181` mantiene `verif_persistente`, que usa `verificar::afinar`. El
   módulo se queda; solo se retira el campo `agentes_persistente` (`queue/mod.rs:186`,
   `:271`). El parámetro `limite: Option<Duration>` de `Persistente::pedir` queda sin
   usuario (hoy solo lo usan los agentes) — **se deja**, porque es la red que impide que
   un proceso persistente colgado se lleve por delante un análisis, y la verificación
   podría querer usarlo mañana.
3. **`workers/lumi_motores.py` contiene el `Upscalador`.** Lo usa
   `workers/lumi_upscale.py:24,57`, el editor de imagen. El fichero se queda con
   `_directorio`, `Upscalador`, `CLASES` y `cargar_motor`; se extirpa solo la clase `Vlm`
   (`:33-152`), su entrada en `CLASES` (`:185`) y su rama en `cargar_motor` (`:191-192`).

Por el mismo motivo **no se borra** `registros/motores/` (el directorio lo leen
`cargar_motores`, `routes/models.rs` y `store.rs:552`; `real-esrgan.json` alimenta el
upscaler), ni `crates/lumi-index/src/geo.rs` (`routes/export.rs:22` lo usa para dibujar
el país en el informe PDF), ni `routes/rendimiento.rs` ni `routes/calibracion.rs` (alojan
también interruptores de la verificación).

### Qué pasa con los datos

- **`analysis_agents`**: nada fuera de agentes la lee, así que `DROP TABLE` es seguro. No
  hay migración posible ni deseable: los veredictos son etiquetas de un catálogo que
  desaparece.
- **Análisis con `model = 'agentes'`**: se borran. Si se dejan, quedan huérfanos e
  invisibles — el cliente ya no ofrece ese modo, pero seguirían apareciendo en
  `AttemptsRail` como «hecho» sin coordenadas.
- **El patrón ya existe en el repo**: `store.rs:581-611` (`migracion_agentes_2026_09_17`)
  hizo exactamente este par de sentencias en septiembre. La migración de Darkroom lo
  copia.
- **`analysis_hypotheses.motivo_agente`**: se deja como columna muerta. SQLite no permite
  `DROP COLUMN` en esquemas antiguos sin recrear la tabla, y el coste de dejarla es cero.
  Se retira de los `SELECT` y de los structs.
- **El informe PDF** deja de pintar el bloque «Agente» y el contador «con agente»
  (`templates/informe.tex.tera:376-378`, `:441-444`). Un informe de un caso antiguo ya no
  los mostrará: las líneas se generan desde `export.rs`, no desde la tabla. La opción
  «Veredictos de agentes» desaparece de `ExportPopup`.
- **Pesos en disco**: `pesos/qwen3-vl-8b/` (~5,5 GB) queda huérfano. **No se borra
  automáticamente** — borrar 5,5 GB del disco de alguien sin preguntar no es una decisión
  que deba tomar una migración. Se avisa en el panel de Modelos.
- **Specs y planes históricos de agentes** (`2026-08-13-agentes-5c-design.md`,
  `2026-09-17-agentes-rediseno-design.md` y sus planes): **no se borran**, se marcan
  derogados con una nota al principio que apunte a este spec. Son el registro de por qué
  se hizo así, y borrarlos deja la historia del proyecto con un agujero.

### Orden de borrado

De hojas a raíz, para que el árbol compile en cada paso:

1. **Datos y docs** (no compilan): `registros/agentes/`, `niveles/agentes.json`,
   `motores/qwen3-vl.json`, las listas `agentes` de `mini/pro/vision.json`,
   `pruebas/agentes/`, `tools/evaluar_agentes.py`.
2. **Cliente**: mover `BetaPill` → quitar `"agentes"` de `lib/models.ts:7` y
   `ModelPicker.tsx:23-24` → limpiar `CaseView`, `ResultsDrawer`, `AttemptsRail`,
   `ExportPopup`, `CalibracionView`, `ModelosView` → borrar los tres componentes →
   limpiar `lib/api.ts`, `bridge.ts`, `toasts.ts`.
3. **Python**: borrar `lumi_agentes.py`; extirpar `Vlm` de `lumi_motores.py`; comprobar
   que `lumi_upscale.py` sigue arrancando.
4. **Daemon, hojas**: `routes/agentes.rs` + su ruta en `main.rs:402` + `routes/mod.rs:5`
   + la entrada `("/v1/agentes", "proyectos")` de `mantenimiento.rs:125-132`.
5. **Daemon, lecturas**: `routes/export.rs` **antes** que `routes/analyses.rs` (export
   depende de `agentes_por_caso`, que vive en analyses) → `media.rs`, `cases.rs`,
   `projects.rs`, `images.rs`.
6. **Daemon, periferia**: `routes/rendimiento.rs` (las 3 claves de agentes),
   `routes/models.rs:212-222`, `templates/informe.tex.tera`, `logging.rs:23`.
7. **Daemon, núcleo**: `queue/mod.rs` (desarmar el `tokio::join!` de `:746-783` dejando
   solo el `await` del verificador, y quitar `correr_agente_unico`, `agentes_de`,
   `guardar_agentes`, `agente_del_analisis` y los campos) → borrar `agentar.rs` y su
   `mod` → limpiar `queue/worker.rs:69-76` y `recuperar.rs`.
8. **`persistente.rs`**: solo quitar `agentes_persistente`.
9. **Esquema**: `store.rs` — retirar `CREATE TABLE analysis_agents`, la migración de
   septiembre y los `ALTER` de agentes; añadir la migración de Darkroom.
10. **Crates compartidos**: `lumi-proto/src/api.rs` y `worker.rs` (`Msg::Agente`,
    `DichoDeAgente`) → `lumi-index`: borrar `agentes.rs`, `cargar_agentes`, el campo
    `Nivel.agentes` y su uso en `resolver_composicion`; comprobar si `lumi-proto` sigue
    siendo dependencia de `lumi-index` (`Cargo.toml:8-10` dice que existe solo para
    `Veredicto`). Ajustar `indexer/src-tauri/src/niveles.rs:62,66`.
11. **Web y docs**: `AgentesVisual.tsx`, `docs/como-funciona/agentes/`, `arbolDocs.ts`,
    `indiceDocs.json`, `Escalera`, `Nav`, `meetmini`/`meetpro`; actualizar
    `ARCHITECTURE.md`, `CLAUDE.md`, `FUTURO.md`, `PRODUCT.md`.

**Criterio de cierre de la fase:** `cargo build`, `npx tsc -b --noEmit` y `npm run lint`
limpios; `cargo test -p lumi-proto` en verde; `grep -ri agente` sobre `crates/`,
`client/src/`, `workers/` y `registros/` sin resultados salvo los specs derogados.

---

## Parte 2 — El backend del caso

### El modelo

Columna nueva en `cases`:

```sql
ALTER TABLE cases ADD COLUMN backend TEXT NOT NULL DEFAULT 'normal'
```

Valores: `normal` | `darkroom`. Se añade en `store.rs:437` (`migrate()`), que ya tiene la
lista de `ALTER TABLE ADD COLUMN` idempotentes — el error «duplicate column» es la señal
de ya-aplicada, y no hay versionado que mantener.

Los casos existentes quedan en `normal` por el `DEFAULT`, sin migración de datos.

### Se elige al crear, y no se cambia

El backend se fija en la creación del caso (`POST /v1/projects/:id/cases`,
`routes/cases.rs:71`) y **es inmutable después**.

Es una decisión deliberada, no una limitación por pereza: un caso normal tiene imágenes,
análisis e hipótesis; un caso Darkroom tendrá archivos encadenados. Convertir uno en otro
no es cambiar un campo, es una migración de datos entre dos modelos que no se
corresponden. Mientras nadie pida esa conversión, la alternativa correcta es crear un
caso nuevo — que cuesta un clic.

`rename` (`routes/cases.rs:110`) no toca el campo. No hay endpoint para cambiarlo.

### El precedente que se sigue, y en qué se aparta

Ya existen dos «backends» en el repo: los modos `agentes` y `upscale` se bifurcan en el
despachador de la cola (`queue/mod.rs:1524` y `:1562`) según el valor de `analyses.model`.
Darkroom sigue esa idea pero **sube el nivel**: se elige por caso, no por análisis.

Esa diferencia es el punto. Un caso Darkroom no es «un caso normal en el que además se
lanzan análisis de otro tipo»: es otra aplicación. Por eso el campo vive en `cases` y no
en `analyses`, y por eso el cliente enruta a otra pantalla completa en vez de añadir una
pestaña.

### Superficie a tocar

- `crates/lumid/src/store.rs:437` — el `ALTER TABLE`.
- `crates/lumi-proto/src/api.rs:835` — campo `backend` en `struct Case`, y el body de
  creación (hoy `NameReq`; pasa a un `CaseReq` con `name` + `backend`).
- `crates/lumid/src/routes/cases.rs:38` (SELECT de `list`), `:83` (INSERT de `create`,
  validando que el valor sea uno de los dos), `:95-106` (construcción del `Case`).
- `client/src/lib/api.ts` — interfaz `Case`.
- `client/src/work/ProjectView.tsx:55` — el diálogo de crear caso gana la elección.
- `client/src/work/CaseRow.tsx` — distintivo visual del caso Darkroom en la lista.

---

## Parte 3 — El candado baja al caso

### El problema de hoy

El candado existente es **por proyecto**: `project_locks(project_id PK, user_id, token,
since)` (`store.rs:164`), y su propio comentario lo dice — *«Solo una fila por proyecto:
es justo lo que impide que dos personas trabajen en el mismo a la vez»*. Entrar en un
proyecto ocupado devuelve **409** (`routes/projects.rs:430`).

Es decir: hoy **dos personas no pueden compartir un proyecto en absoluto**. Lo que este
spec pide es lo contrario — proyecto compartido, caso exclusivo.

### La decisión: mudar el candado, no añadir otro

`project_locks` desaparece y nace `case_locks`, con la misma forma:

```sql
CREATE TABLE IF NOT EXISTS case_locks (
  case_id  INTEGER PRIMARY KEY,
  user_id  INTEGER NOT NULL,
  token    TEXT    NOT NULL,
  since    INTEGER NOT NULL
)
```

Se descartaron dos alternativas:

- **Dos niveles** (mantener el de proyecto y añadir el de caso) permitiría «reservar» un
  proyecto entero, pero contradice el requisito principal y duplica un mecanismo que ya
  es sutil.
- **Una tabla genérica `locks(ambito, id, …)`** estaría preparada para candados futuros
  (¿un archivo Darkroom bloqueado?), pero hoy no existe un segundo ámbito real. Es
  abstracción por adelantado, y `ponytail` manda: cuando aparezca el segundo ámbito, se
  generaliza entonces.

`enter`/`leave`/`kick` (`routes/projects.rs:430`, `:476`, `:496`) se mudan de
`/v1/projects/:id/...` a `/v1/cases/:id/...`, conservando lo que ya hacen bien: el robo
de un candado caducado, el cruce del token con la sesión viva, y el `409` con el nombre
de quien lo tiene.

Los proyectos dejan de tener candado: `enter` desaparece de projects, y el `LEFT JOIN`
que alimenta `locked_by`/`locked_by_id` en el listado (`routes/projects.rs:88-95`) pasa a
contar **cuántos casos del proyecto están ocupados y por quién**, que es lo que el
investigador necesita ver antes de entrar.

### Tres defectos del candado actual que hay que arreglar al mudarlo

Copiar el mecanismo tal cual heredaría sus tres agujeros. Los tres son necesarios para
que lo que pide este spec sea cierto y no solo aparente:

**1. Hoy no es exclusión real, es cortesía.** El candado solo se comprueba en `enter`.
Ninguna otra ruta lo mira, así que un cliente que ignore el 409 —o una API key— puede
crear, subir y analizar en un proyecto candado por otro.

El arreglo es barato porque el embudo ya existe: `guard_case` (`routes/cases.rs:16`) es
el único punto por el que pasan casos, imágenes y análisis, y su propio doc-comment lo
declara. Se le añade la comprobación del candado, con dos excepciones explícitas:

- **Las lecturas pasan.** Un compañero puede mirar un caso ajeno sin tomarlo. El criterio
  es el método HTTP: `GET` y `HEAD` no exigen candado; `POST`, `PATCH`, `PUT` y `DELETE`
  sí. Es un criterio mecánico y comprobable, no una lista de rutas que habría que
  mantener al día cada vez que nace un endpoint.
- **Los administradores nunca se quedan fuera**, mismo criterio que ya aplica
  `mantenimiento.rs:166`.

**2. Hoy la liberación por inactividad solo la aplica el cliente.**
`client/src/App.tsx:329-355` cuenta la actividad del puntero y el teclado y llama a
`leave`. Si alguien cierra el portátil de golpe o pierde la red, el caso queda bloqueado
hasta el `STALE_AFTER = 12 h` de `routes/projects.rs:428`.

Como el plazo pasa a ser configurable (Parte 4), la caducidad se mueve **al daemon**, que
es donde puede ser fiable: un barrido periódico que borra las filas de `case_locks` cuyo
`since` no se ha refrescado dentro del plazo. Eso obliga a que el candado tenga
**latido**: el cliente refresca `since` mientras hay actividad real. El cliente sigue
haciendo su parte (devolver al usuario a la lista cuando detecta su propia inactividad),
pero ya no es la única red.

**3. Hoy nadie se entera de que un caso quedó libre.** El SSE filtra los eventos por
destinatario (`routes/queue.rs:33`, `c.user_id() == uid`), así que `Cambio::Expulsion`
llega solo al expulsado. No existe ningún evento de «candado liberado», y el segundo
investigador se entera reintentando `enter`.

Se añade una variante `Cambio::CasoLibre { case_id }` y se emite a los miembros del
proyecto. Eso **exige tocar ese filtro**, que hoy impide difundir a terceros — es el
único punto del cambio que toca el transporte de eventos, y conviene hacerlo con cuidado:
el filtro existe para que nadie vea eventos de otros, así que la difusión nueva debe
acotarse a los miembros del proyecto del caso, no a todo el mundo.

### Superficie a tocar

- `crates/lumid/src/store.rs` — `CREATE TABLE case_locks`, y `DROP TABLE project_locks`
  en la migración.
- `crates/lumid/src/routes/projects.rs:420-510` — se muda `enter`/`leave`/`kick`; el
  listado pasa a contar casos ocupados.
- `crates/lumid/src/routes/cases.rs:16` — `guard_case` gana la comprobación.
- `crates/lumid/src/main.rs` — rutas nuevas bajo `/v1/cases/:id/`.
- `crates/lumid/src/tasks.rs` — el barrido de candados caducados.
- `crates/lumi-proto/src/api.rs:1104` — variante `Cambio::CasoLibre`.
- `crates/lumid/src/routes/queue.rs:33` — el filtro de difusión.
- `client/src/App.tsx:262-300` — `leaveProject` pasa a `leaveCase`; el latido.
- `client/src/work/ProjectView.tsx`, `CaseRow.tsx` — quién tiene cada caso.
- `client/src/work/ProjectPicker.tsx:81,132` — ya no hay candado de proyecto.

---

## Parte 4 — La sección de administración

Sección nueva **«Colaboración»** en el panel de administración, con cuatro ajustes:

| Ajuste | Clave `meta` | Defecto | Qué hace |
|---|---|---|---|
| Exclusividad de caso | `caso_exclusivo` | activado | Apagado, varias personas pueden abrir el mismo caso a la vez |
| Plazo de liberación | `caso_liberar_s` | 1800 (30 min) | Sin latido durante este tiempo, el caso se libera solo |
| Quién puede echar a otro | `caso_expulsar_rol` | `admin_o_dueno` | `admin` \| `admin_o_dueno` \| `cualquier_miembro` |
| Tope de personas por proyecto | `proyecto_max_personas` | 0 (sin tope) | Simultáneas dentro del mismo proyecto |

Se sigue el patrón ya establecido en `routes/security.rs` y `routes/rendimiento.rs`, sin
inventar nada: claves en la tabla `meta` vía `get_meta`/`set_meta`, un struct
`ColaboracionSettings` + `PatchColaboracionReq` con todos los campos `Option<T>` en
`crates/lumi-proto/src/api.rs`, handlers `get`/`patch` con `require_admin`, validación de
rango y `tracing::info!("… por el administrador {admin}")`, ruta en `main.rs`, e interfaz
espejo en `client/src/lib/api.ts` con su vista registrada en `AdminPanel.tsx` y
`Sidebar.tsx`.

La UI reusa el patrón de «Modo Zero Trust» y «Expulsar por inactividad»: el interruptor
de exclusividad arriba, y su configuración desplegándose debajo solo cuando está
encendido (`grid-template-rows: 0fr → 1fr`, como en `SecurityView.tsx:82`).

**Nota de alcance:** los cuatro ajustes son **globales**, no por proyecto. No existe hoy
ningún precedente de configuración por proyecto en todo el repo — todo es global (tabla
`meta`) o por usuario (tabla `limits`) — y crear ese tercer ámbito para cuatro
interruptores sería abrir una puerta grande por una razón pequeña. Si algún día un
proyecto necesita su propia política, la tabla `limits` ya tiene la semántica de «fila
global + anulación» lista para copiarse.

**Qué cuenta el tope de personas.** Como los proyectos ya no tienen `enter`, no hay un
momento de «entrar en el proyecto» donde comprobarlo. `proyecto_max_personas` cuenta
por tanto **cuántas personas distintas tienen algún caso de ese proyecto abierto**, y se
comprueba al tomar un caso: si tomarlo superaría el tope, se devuelve `409` con el mismo
formato que el candado. Con `0` no se comprueba nada — es el defecto, porque un tope que
nadie pidió solo puede estorbar.

**Qué pasa con la exclusividad apagada.** El candado se sigue tomando y se sigue
mostrando quién tiene cada caso: lo que cambia es que `guard_case` deja de rechazar al
segundo. Es decir, el ajuste gobierna la *aplicación* de la exclusión, no el registro de
quién está dónde. Así apagarlo no ciega al equipo, solo le quita el cerrojo — y volver a
encenderlo no necesita que nadie salga y vuelva a entrar.

---

## Parte 5 — La pantalla

Un caso con `backend = 'darkroom'` abre una pantalla propia **en lugar de** el mapa, el
carrusel de imágenes y el cajón de resultados. No es una pestaña dentro de la vista de
caso: es otra vista, hermana de `CaseView`.

En este spec contiene la palabra **«ola»**, centrada, con la tipografía del producto. Y
nada más.

Su valor no está en lo que muestra sino en lo que demuestra: que el backend elegido al
crear el caso enruta de extremo a extremo hasta una interfaz distinta. Cuando el spec 2
traiga los archivos y las herramientas, el sitio donde ponerlos ya existirá y estará
probado.

**Superficie:** un componente nuevo `client/src/work/DarkroomView.tsx`, y la bifurcación
por `case.backend` allí donde hoy `App.tsx` monta `CaseView`. El candado, la expulsión
por inactividad y la barra de título funcionan igual en ambas vistas — son del caso, no
de la pantalla.

---

## Parte 6 — Lo que este spec no hace

Dicho explícitamente para que el plan de implementación no se lo invente:

- **No diseña el grafo**: ni archivos, ni clases, ni propiedades, ni tipos de source, ni
  encadenamiento, ni ejecución, ni herramientas de dibujo. Spec 2.
- **No toca el pipeline de geolocalización.** Los casos `normal` funcionan exactamente
  igual que hoy, salvo que su candado ahora es del caso y no del proyecto.
- **No convierte casos** de un backend a otro.
- **No crea configuración por proyecto.**
- **No borra los pesos huérfanos** de `qwen3-vl-8b`.
- **No arregla** los defectos de rendimiento del spec del mismo día
  (`2026-09-19-optimizacion-extrema-design.md`). Son trabajos independientes; el único
  punto de contacto es que borrar los agentes vuelve irrelevantes sus hallazgos W1, W2,
  W3, W6 y B1, que quedan derogados por esta vía.

---

## Plan de ejecución

Dos fases con una frontera dura en medio. Se puede parar después de la Fase 0.

### Fase 0 — Borrar los agentes

Once pasos, en el orden de la Parte 1. Un commit por paso o por grupo coherente de
pasos; el árbol debe compilar al final de cada uno.

Cierra con: `cargo build` + `tsc -b --noEmit` + `npm run lint` limpios,
`cargo test -p lumi-proto` en verde, y sin menciones a agentes fuera de los specs
derogados.

### Fase 1 — El andamiaje de Darkroom

| # | Paso | Parte |
|---|---|---|
| 1 | Columna `backend` en `cases` + tipos + creación con elección | §2 |
| 2 | `case_locks` y el traslado de `enter`/`leave`/`kick` | §3 |
| 3 | La exclusión real en `guard_case` | §3 |
| 4 | El barrido de caducidad en el daemon + el latido del cliente | §3 |
| 5 | `Cambio::CasoLibre` y el filtro de difusión | §3 |
| 6 | La sección «Colaboración» del panel de administración | §4 |
| 7 | `DarkroomView.tsx` con «ola» y la bifurcación por backend | §5 |

El paso 3 es el más delicado: `guard_case` está en el camino de **todas** las rutas de
casos, imágenes y análisis, así que una comprobación de más deja a alguien fuera de su
propio trabajo. Merece revisarse con cuidado y probarse con dos sesiones reales antes de
darlo por bueno.

El paso 5 es el segundo más delicado por la razón contraria: toca el filtro que impide
que un usuario vea eventos de otro. Una difusión demasiado ancha ahí es una fuga de
información, no un bug de UX.

---

## Nota sobre el orden

La Fase 0 borra ~3.850 líneas y la Fase 1 añade unos cientos. Esa asimetría es la forma
correcta de empezar Darkroom: **el sitio se hace antes de ocuparlo.** Si las dos fases se
mezclaran, el andamiaje se construiría esquivando código que está a punto de desaparecer,
y el borrado tendría que esquivar código que acaba de nacer — en los mismos ficheros,
además (`queue/mod.rs`, `store.rs`, `routes/cases.rs`, `lib/api.ts`).

Y hay una propiedad que conviene no perder: después de la Fase 0 el producto sigue siendo
coherente. No hay agentes, no hay Darkroom, y nada promete ninguna de las dos cosas. Si
Darkroom se parase aquí por lo que fuera, lo que queda es un Lumi más pequeño y más
honesto que el de hoy, no uno a medias.
