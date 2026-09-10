# Cuatro mejoras de UI: agentes compactados, editor de imagen, panel Media, debug de calibración

Aprobado por el owner el 2026-09-10, sección por sección, en brainstorming por
chat. Cuatro proyectos independientes, cada uno con su propio criterio de
"hecho" — no se implementan como un todo monolítico, y cada uno puede
entregarse y probarse por separado.

## Contexto compartido

- Dark-theme-only, sin librería de iconos (SVG a mano, mismo patrón
  `viewBox 24x24, stroke currentColor` que ya usa `client/src/ui/Icon.tsx`).
- "Nunca se inventa": ningún progreso, resultado o dato ficticio en ninguna de
  las cuatro piezas.
- Patrón de interruptor de admin ya establecido en
  `crates/lumid/src/routes/rendimiento.rs`: clave en `Store` (meta
  clave-valor, no tabla nueva), `GET`/`PATCH` protegidos por `require_admin`,
  descripción legible del estado actual (`DESC_ON`/`DESC_OFF`), componente
  `Interruptor` en el cliente. Los tres interruptores nuevos de este spec
  (`upscaler_activo`, `media_por_proyecto_activo`, `modo_calibracion`) siguen
  ese mismo patrón, todos apagados por defecto.
- Patrón de drawer de 360px ya establecido en `ExportDrawer.tsx`.

---

## 1. Selector de agentes: fusión + interfaz

### Qué agentes se fusionan

De 12 fichas en `registros/agentes/` a 6:

| Ficha nueva | Sustituye a |
|---|---|
| `condiciones-ambientales` | `clima-aparente` + `meteorologia` + `estacion` + `vegetacion` |
| `indicios-viales` | `lado-conduccion` + `senalizacion` + `matricula` |
| `texto-en-escena` | `idioma` + `toponimos` |
| `hora-sombras` | (sin cambios) |
| `escena` | (sin cambios) |
| `dimensiones` | (sin cambios) |

Las cuatro fichas fusionadas eliminan sus JSON individuales; no queda un
período de compatibilidad con IDs viejos — los análisis ya guardados con
`agente: "clima-aparente"` conservan ese texto tal cual en su historial (no se
reescriben registros pasados), pero el registro activo ya no ofrece ese ID
para lanzar un análisis nuevo.

### Esquema nuevo de `Agente`

`crates/lumi-index/src/agentes.rs`, struct `Agente`. Se añade un campo
opcional:

```rust
pub struct Agente {
    pub id: String,
    pub nombre: String,
    pub motor: String,
    pub pregunta: String,
    // Los campos etiquetas/mapa/restriccion/umbral_confianza EXISTENTES pasan
    // a ser opcionales: un agente fusionado no los rellena a nivel superior.
    #[serde(default)]
    pub etiquetas: Vec<String>,
    pub tipo: String,
    #[serde(default)]
    pub restriccion: String,
    #[serde(default)]
    pub mapa: HashMap<String, Vec<String>>,
    #[serde(default)]
    pub umbral_confianza: f64,
    /// Presente SOLO en agentes fusionados. Cada entrada es una de las
    /// preguntas originales, con sus propios campos — exactamente los mismos
    /// que un `Agente` no fusionado tenía. Vacío en los seis que no se
    /// fusionan.
    #[serde(default)]
    pub sub_preguntas: Vec<SubPregunta>,
}

pub struct SubPregunta {
    pub id: String,             // p.ej. "clima-aparente" dentro de "condiciones-ambientales"
    pub etiquetas: Vec<String>,
    pub restriccion: String,
    pub mapa: HashMap<String, Vec<String>>,
    pub umbral_confianza: f64,
}
```

El `pregunta` de nivel superior de un agente fusionado pide al VLM **un único
JSON de salida** con una clave por `SubPregunta.id`, en **una sola llamada de
inferencia** — no cuatro. Ejemplo de la ficha `condiciones-ambientales`:

```
"Mira la foto y responde con un JSON con estas claves exactas:
 {\"clima-aparente\": \"...\", \"meteorologia\": \"...\",
  \"estacion\": \"...\", \"vegetacion\": \"...\"}.
 Para cada clave, responde solo con una de sus opciones."
```

### Por qué el motor de puntuación no cambia

`lumi_index::agentes::aplicar` consume una lista plana de `Veredicto`, cada
uno con `agente`, `etiqueta`, `confianza`. Ese contrato no cambia. La
responsabilidad de "un agente fusionado, cuatro veredictos" vive en
`workers/lumi_agentes.py`: parsea el JSON compuesto que devolvió el VLM y
emite **un `Veredicto` por sub-pregunta**, con
`agente = "<id-fusionado>.<id-sub-pregunta>"` (p.ej.
`"condiciones-ambientales.clima-aparente"`). Aguas abajo, en Rust, es
indistinguible de doce agentes sueltos — cero cambios en `aplicar()`,
`arbitro.rs` ni en la penalización compuesta.

Si el VLM devuelve un JSON incompleto o mal formado (falta una clave, texto
que no parsea), las sub-preguntas que sí se resolvieron generan su
`Veredicto` igual; las que no, simplemente no aparecen — el mismo criterio
que ya existe para "el agente no contestó a tiempo": ausencia, no error
fabricado.

### Interfaz

`AgentPickerPopup.tsx`, `RejillaAgentes`: la rejilla pasa de 12 a 6 tarjetas
(2×3, cabe sin scroll en los 540px actuales). Una tarjeta fusionada muestra,
bajo el nombre, sus sub-preguntas como una lista corta de etiquetas cortas
("clima · tiempo · estación · vegetación") en vez de la única línea de
`a.pregunta` que hoy se trunca con `truncate`.

`AgentResultPopup.tsx`: un veredicto fusionado se agrupa bajo **un solo
card** por agente, con una fila por sub-pregunta (etiqueta + confianza cada
una), en vez de un card por sub-pregunta suelto.

### Criterio de hecho

- El registro trae 6 fichas, ninguna de las 12 antiguas queda activa.
- Un análisis con `agente: "condiciones-ambientales"` hace **una** llamada de
  inferencia y produce hasta 4 veredictos aplicados por `arbitro.rs`.
- El picker muestra 6 tarjetas sin scroll; el resultado agrupa sub-respuestas
  bajo un card por agente.

---

## 2. Editor pre-subida: recorte, blur y upscaler de IA

### Dónde se engancha

Popup nuevo `client/src/work/ImageEditorPopup.tsx`, se abre **antes** de
`UploadPopup` para cada imagen recién seleccionada por el usuario (no
sustituye `UploadPopup`, se intercala delante). Un botón "Omitir" salta
directo al flujo actual sin tocar la imagen — el editor es opcional en cada
subida, nunca obligatorio.

### Recorte y blur — cliente, canvas 2D, sin backend

- **Recorte**: caja arrastrable/redimensionable sobre un `<canvas>`,
  proporción libre (una foto forense no se fuerza a un ratio fijo, a
  diferencia del recorte de avatar típico).
- **Blur**: pincel manual libre, radio ajustable con un slider. Se pinta
  sobre un canvas de máscara superpuesto; al exportar, se aplica
  `ctx.filter = "blur(Npx)"` recortado a esa máscara — difuminado real con
  textura de fondo visible, no un rectángulo opaco. Coherente con lo pedido
  ("añadirle blur", no "tapar").
- **Deshacer/rehacer**: pila simple de snapshots del canvas (ImageData),
  profundidad razonable (20 pasos), sin persistencia entre sesiones.
- Todo esto corre en el navegador/WebView, sin llamada de red. El resultado
  se re-codifica a JPEG/PNG antes de entrar al flujo de subida existente.

### Upscaler de IA — real, en el backend, gated por admin

- Motor nuevo en `registros/motores/`, tipo Real-ESRGAN (o equivalente que se
  evalúe al implementar — el spec no fija el modelo exacto, fija el
  contrato: entra una imagen, sale una versión de mayor resolución generada
  por un modelo real, nunca una interpolación disfrazada de "IA"). Vive en
  `workers/lumi_motores.py` con el mismo patrón de carga bajo demanda que
  `Vlm`/`Profundidad`: entra en la caché de pesos y en el desalojo por
  inactividad/presión que ya existe (`lumi_pesos.purgar_inactivos`,
  `quizas_purgar_por_presion`) — un motor más en la misma cola, no
  infraestructura aparte.
- Ruta nueva `POST /v1/images/upscale`: recibe la imagen ya recortada/con
  blur aplicado, la encola como un trabajo normal del sistema de colas
  existente (subsistema 4 — no hay cola nueva), responde con el resultado
  cuando termina. Es cómputo local: no consume `Presupuesto` ni cuota de
  proveedor externo.
- **Interruptor de admin `upscaler_activo`** (apagado por defecto, patrón
  `rendimiento.rs`). Con el interruptor apagado, el botón "Mejorar calidad"
  del editor **no aparece** — no un botón deshabilitado con explicación
  (patrón de capability matrix con `reason`), sino ausente sin más: no hay
  nada capado que explicar, es una función que el admin todavía no ha
  encendido, distinto de una función capada por hardware/licencia.
- Mientras corre: el estado real del trabajo de cola (`pendiente` →
  `en_curso` → `hecho`/`error`), reutilizando el mismo componente de estado
  que ya usan los análisis. Nunca una barra de progreso inventada.

### Criterio de hecho

- Recortar y difuminar una imagen produce un fichero nuevo, sin llamada al
  servidor, antes de que `UploadPopup` la reciba.
- Con `upscaler_activo` apagado, el botón no existe en la UI.
- Con `upscaler_activo` encendido, pedir upscaling lanza un trabajo de cola
  real y el popup refleja su estado real hasta terminar o fallar.

---

## 3. Panel "Media" en el drawer derecho

### Ubicación

`Drawer.tsx`: `DrawerId` gana `"media"` → `"results" | "invite" | "media" |
"export" | null`. En el carril de pestañas del drawer, entre "Invitar" y
"Exportar" (debajo de Invitar, como se pidió). Componente nuevo
`client/src/work/MediaDrawer.tsx`, mismo patrón de 360px que `ExportDrawer`.

### Alcance: por caso siempre, por proyecto opcional

- **Por caso** (siempre disponible, sin interruptor): `SELECT * FROM images
  WHERE case_id = ?` — el dato que ya existe hoy, sin cambios de esquema.
- **Por proyecto** (interruptor de admin `media_por_proyecto_activo`, apagado
  por defecto): cuando está activo, el panel gana un selector "Este caso /
  Todo el proyecto" en su cabecera. En modo proyecto, la consulta es
  `SELECT i.* FROM images i JOIN cases c ON c.id = i.case_id WHERE
  c.project_id = ?` — no hace falta columna nueva en `images` ni migración:
  la relación proyecto→imagen ya existe indirectamente vía `cases`.
  Con el interruptor apagado, el selector no aparece y el panel se comporta
  como si solo existiera el modo por caso.

### Carpetas — virtuales, metadato puro

Tabla nueva:

```sql
CREATE TABLE media_folders (
    id         INTEGER PRIMARY KEY,
    -- 'case_id' o 'project_id' según en qué modo se creó la carpeta. Una
    -- carpeta de proyecto es visible en modo proyecto para cualquiera de sus
    -- casos; una carpeta de caso solo en ese caso.
    case_id    INTEGER REFERENCES cases(id),
    project_id INTEGER REFERENCES projects(id),
    nombre     TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    CHECK ((case_id IS NULL) != (project_id IS NULL))
);
```

`images` gana `folder_id INTEGER REFERENCES media_folders(id)`, nulo por
defecto ("Sin carpeta"). Mover una imagen de carpeta es un `UPDATE` de una
columna. Borrar una carpeta no borra sus imágenes: las deja en "Sin
carpeta" (`ON DELETE SET NULL`) — una carpeta es organización, nunca un
contenedor de vida o muerte de una imagen.

Esto es metadato puro: no toca el pipeline de análisis, export, ni el hash
de integridad de la imagen.

### Interacción

- Rejilla de miniaturas con selección múltiple (click con `Ctrl`/`Shift`,
  patrón estándar de gestor de ficheros).
- Barra de acciones sobre la selección: mover a carpeta (menú desplegable con
  las carpetas existentes + "Nueva carpeta"), eliminar (confirmación
  explícita, borrado real — nunca oculto ni "papelera" fingida a menos que ya
  exista una papelera real en otro punto del producto, que no es el caso),
  analizar (una imagen → abre el picker existente; varias → una petición de
  análisis por imagen encolada, reutilizando el endpoint actual, sin
  inventar un endpoint de lote que el backend no tiene).
- **Click izquierdo en una miniatura individual** → abre `AgentPickerPopup`/
  selector de modelo existente para esa imagen, mismo flujo de siempre.
- **Click derecho** → menú contextual con "Editar" (abre `ImageEditorPopup`
  del punto 2, mismas herramientas: recorte, blur, upscaler si está
  activo), "Mover a...", "Eliminar".

### Editar desde Media: sobrescribir vs. copia

Al cerrar `ImageEditorPopup` desde este flujo (a diferencia del flujo de
subida, donde no hay "imagen anterior" que sobrescribir), aparecen dos
opciones:

- **Sobrescribir**: reemplaza los bytes de la fila `images` existente
  (mismo `id`), recalcula `sha256`. Los análisis previos de esa imagen
  (`analyses.image_id`) **no se borran ni se re-etiquetan silenciosamente**:
  ganan un aviso visible ("este análisis se hizo sobre una versión anterior
  de la imagen, editada el <fecha>") comparando el `sha256` guardado en el
  análisis contra el actual de la imagen — el mismo mecanismo de integridad
  que ya usa el informe PDF (`integridad_sha256`), reutilizado aquí como
  detector de desincronía, no solo como sello de exportación.
- **Guardar como copia**: `INSERT` de una fila nueva en `images` con los
  bytes editados; la original queda intacta con sus análisis tal cual.

### Criterio de hecho

- El panel Media, en modo caso, lista exactamente las imágenes de
  `images WHERE case_id = ?`, con carpetas funcionando (mover, crear, borrar
  sin perder imágenes).
- Con `media_por_proyecto_activo` apagado, no hay selector de modo ni forma
  de ver imágenes de otro caso.
- Click derecho → editar → sobrescribir dispara el aviso de "versión
  anterior" en cualquier análisis existente de esa imagen cuyo sha256 ya no
  coincida.

---

## 4. Opciones de debug para calibración de modelos

Todo detrás de un interruptor de admin nuevo, `modo_calibracion` (apagado
por defecto). Con el interruptor apagado, **ninguna** de las cuatro
capacidades siguientes aparece en ningún punto de la interfaz, ni para el
propio admin — no es una función capada con explicación, es tooling de
calibración que no está montado.

Con el interruptor activo, se añade una sección "Calibración" en el panel
admin (junto a Modelos/Rendimiento):

### 4a. Umbrales de verificación geométrica editables

`GET/PATCH /v1/admin/verificadores/:id/umbrales`, mismo patrón que
`rendimiento.rs`: el `PATCH` guarda un override en `Store`
(`umbral_inliers:<id>` como clave meta). `crates/lumi-index/src/arbitro.rs`,
al leer el umbral de un verificador, primero mira el override en `Store` y
si no existe cae al valor de `registros/verificadores/<id>.json` — el JSON
sigue siendo la fuente para una instalación nueva; el override es por
servidor, no se propaga a otras instalaciones ni se escribe de vuelta al
fichero.

### 4b. Prompts de agentes editables

`PATCH /v1/admin/agentes/:id` (y, para uno fusionado,
`/v1/admin/agentes/:id/sub/:sub_id`) sobre el campo `pregunta` (o
`etiquetas`/`mapa` de una sub-pregunta). Mismo mecanismo de override en
`Store`, fallback al JSON. **Validación obligatoria antes de persistir**: el
`PATCH` deserializa el resultado contra el struct `Agente`/`SubPregunta` de
Rust — un JSON que rompería el parser de `lumi_agentes.py` (falta una clave
esperada, tipo equivocado) se rechaza con 400 y nunca llega a guardarse. No
hay estado intermedio de "prompt roto en producción".

### 4c. Ver la respuesta cruda del modelo

Campo nuevo en `Veredicto` (`crates/lumi-index/src/agentes.rs`):
`respuesta_cruda: Option<String>` — el texto/JSON exacto que devolvió el VLM
antes de que `lumi_agentes.py` lo interprete. **Solo se rellena y se
persiste cuando `modo_calibracion` está activo** en el momento del análisis
— con el modo apagado, el campo va siempre a `None` y no se acumula en la
base de datos de instalaciones que nunca activaron calibración. En
`AgentResultPopup`, una sección colapsada "Ver crudo" aparece únicamente si
el veredicto trae ese campo relleno.

### 4d. Forzar motor/dispositivo

`POST /v1/cases/:id/analyses` gana un campo opcional
`forzar_motor: Option<String>` / `forzar_dispositivo: Option<String>`. La
cola (`crates/lumid/src/queue/mod.rs`), antes de aplicar su enrutado
automático, comprueba `modo_calibracion`: si está apagado, estos campos se
**ignoran silenciosamente** (no es un error — un cliente viejo o un script
que los mande sin querer no debe romperse, simplemente no tienen efecto);
si está activo, saltan el enrutado y fuerzan el motor/dispositivo pedido. En
la UI, el selector de motor/dispositivo en el picker de modelo solo se
renderiza si `modo_calibracion` está activo.

### Criterio de hecho

- Con `modo_calibracion` apagado, ningún endpoint ni campo de la UI de este
  punto es visible o tiene efecto.
- Con el modo activo: cambiar un `umbral_inliers` desde el panel cambia el
  comportamiento de `arbitro.rs` en el siguiente análisis sin reiniciar
  `lumid`; un prompt de agente inválido se rechaza antes de guardarse; un
  veredicto nuevo trae su `respuesta_cruda`; una petición con
  `forzar_motor` se sirve con ese motor exacto.

---

## Fuera de alcance (las cuatro piezas)

- Migrar análisis históricos con `agente` en su forma antigua (p.ej.
  `"clima-aparente"` suelto) a la nueva convención `"<fusionado>.<sub>"` — se
  quedan tal cual en su historial.
- Detección automática de caras/matrículas para el blur (se evaluó y se
  descartó a favor del pincel manual, ver brainstorming).
- Upscaler en el cliente o basado en interpolación — el upscaler es real o
  no existe el botón.
- Endpoint de análisis por lote nuevo — "analizar varias" desde Media reusa
  el endpoint actual, una petición por imagen.
- Papelera/recuperación de imágenes eliminadas desde Media — el borrado es
  real, como en el resto del producto.
- Editar el propio schema de `arbitro.rs`/`agentes.rs` más allá de leer un
  override — la lógica de puntuación y penalización no cambia.
- Sincronizar los overrides de calibración entre servidores — son
  por-instalación, a propósito.
