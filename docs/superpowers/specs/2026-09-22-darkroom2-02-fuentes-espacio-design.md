# Darkroom 2 · 2 — Fuentes y espacio Darkroom

Parte de Darkroom 2 (ver `2026-09-22-darkroom2-00-indice-design.md`). Depende del spec 1
(Temas): todo lo que se pinta aquí usa sus tokens.

## Resumen

Dos cosas, que van juntas porque la segunda es la cara de la primera:

1. **Fuentes.** Un análisis ya no empieza con una imagen, sino con una **fuente**:
   *entrada + herramienta*. Se aplica a los dos backends y a los datos de los dos. En este
   spec solo existe el tipo `imagen` y la herramienta `geolocalizar`, que es el pipeline de
   hoy. Cada spec de herramienta añadirá los suyos.
2. **El espacio Darkroom.** La pantalla que sustituye a «ola»: panel de fuentes, mapa
   compartido, pines manuales, notas, Actividad encadenada y revisión de cada resultado. Es
   la estructura de Raven con la piel de Lumi.

El caso **normal** no cambia a la vista, salvo el vocabulario («Añadir fuente») y lo que ya
decía el spec de 2026-09-19. Por debajo pasa a tener fuentes, como Darkroom.

---

## Parte 1 — El modelo de datos

### 1.1 `sources`

```sql
CREATE TABLE IF NOT EXISTS sources (
    id           INTEGER PRIMARY KEY,
    case_id      INTEGER NOT NULL REFERENCES cases(id),
    tipo         TEXT NOT NULL,          -- 'imagen' en este spec; cada herramienta añade los suyos
    herramienta  TEXT NOT NULL,          -- 'geolocalizar' en este spec
    image_id     INTEGER REFERENCES images(id),  -- fuentes de tipo imagen
    valor        TEXT,                   -- fuentes de texto (dominio, matrícula…), specs futuros
    nivel        TEXT,                   -- mini | pro | vision con el que se lanzó
    derivada_de  INTEGER REFERENCES resultados(id),  -- «Crear fuente a partir de esto»
    creado_por   INTEGER NOT NULL,
    creado_en    INTEGER NOT NULL,
    CHECK ((image_id IS NULL) != (valor IS NULL))
);
CREATE INDEX IF NOT EXISTS idx_sources_case ON sources(case_id);
```

- **`images` pasa a ser el almacén de archivos** y deja de ser «lo que tiene un caso». Dos
  fuentes pueden apuntar a la misma fila de `images`: la misma foto por Geolocalización y
  por Car ID es un único blob, con un único `sha256` y una única cadena de custodia.
  `images.case_id` se queda, porque el blob pertenece al caso y las guardias de acceso
  (`guard_case`) siguen resolviéndose por él.
- **`tipo` y `herramienta` son texto libre** validado en el daemon contra un registro en
  código (`fuentes::TIPOS`, `fuentes::HERRAMIENTAS`), no un `CHECK` de SQLite. Así cada spec de
  herramienta los amplía sin migrar el esquema.
- Qué herramienta admite qué tipo en qué backend se decide en un solo sitio:
  `fuentes::admite(backend, tipo, herramienta) -> Result<(), Motivo>`. En el caso normal solo
  pasa `imagen/geolocalizar`. El motivo viaja a la interfaz (patrón de la matriz de
  capacidades).

### 1.2 `resultados`

La forma común que ven el panel, el mapa, la revisión, las notas y la Actividad, sea cual sea
la herramienta.

```sql
CREATE TABLE IF NOT EXISTS resultados (
    id            INTEGER PRIMARY KEY,
    source_id     INTEGER NOT NULL REFERENCES sources(id),
    orden         INTEGER NOT NULL,       -- ranking que dio la herramienta
    titulo        TEXT NOT NULL,          -- «Hipótesis 1», «SEAT León III · 2017»…
    puntuacion    REAL,                   -- similitud / confianza, si la herramienta la tiene
    lat           REAL, lng REAL, radio_m REAL,   -- si el resultado va al mapa
    revision      TEXT NOT NULL DEFAULT 'sin_revisar'
                  CHECK (revision IN ('sin_revisar','confirmado','descartado')),
    revisado_por  INTEGER, revisado_en INTEGER,
    auditor       TEXT,                   -- veredicto del auditor IA, JSON (spec 3); NULL si no aplica
    detalle_ref   TEXT,                   -- puntero a las tablas propias de la herramienta
    payload       TEXT,                   -- detalle pequeño de la herramienta, JSON
    creado_en     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_resultados_source ON resultados(source_id, orden);
```

- **Geolocalización** no duplica nada: cada fila de `analysis_hypotheses` produce un
  resultado con `detalle_ref = 'hip:<analysis_id>:<orden>'`, y `lat`/`lng`/`radio_m`/`puntuacion`
  copiados de ella. La vista de detalle sigue leyendo la hipótesis y su foto de referencia
  como hoy.
- **La fuente se une al análisis** con una columna nueva, `analyses.source_id`. Un análisis
  es *una ejecución* de la herramienta de una fuente: si se relanza con otro nivel, la
  fuente gana otro análisis, y el panel muestra el último con un selector de intentos (el
  `AttemptsRail` de hoy).
- **`revision` solo se muestra y se edita en Darkroom.** En un caso normal la columna existe
  (todos los resultados quedan `sin_revisar`), pero la interfaz clásica no la enseña. Así los
  datos tienen la misma forma en los dos backends.

### 1.3 La migración

Una migración única (`migracion_darkroom2_fuentes_2026_09_22`, mismo patrón que las de
`store.rs`), de una sola pasada y dentro de una transacción:

1. Por cada fila de `images` que no sea resultado de un reescalado, crear una fuente
   `imagen/geolocalizar` con el `case_id`, el `image_id`, `creado_por = uploader_id` y
   `creado_en = images.created_at`.
2. Por cada análisis, poner `analyses.source_id` a la fuente de su imagen (hoy siempre hay
   una sola por análisis: el cliente solo manda `image_ids: [id]`). Si en algún análisis
   antiguo hubiera varias, se asigna a la de la primera y se registra en el log.
3. Por cada hipótesis, crear su fila de `resultados`.

Los análisis `upscale` no son fuentes: son derivados de una imagen y se quedan colgando de
ella como hoy.

La migración es idempotente: se marca en `meta` y no se repite.

### 1.4 API

| Método | Ruta | Qué hace |
|---|---|---|
| `GET` | `/v1/cases/:id/sources` | fuentes del caso, con contadores por estado de revisión |
| `POST` | `/v1/cases/:id/sources` | crea una fuente (`tipo`, `herramienta`, `image_id` o `valor`, `nivel`, `derivada_de?`) y encola su primera ejecución |
| `DELETE` | `/v1/sources/:id` | borra la fuente (409 si su análisis está en curso, como hoy); el blob no se borra mientras otra fuente lo use |
| `POST` | `/v1/sources/:id/rerun` | nueva ejecución con otro nivel |
| `GET` | `/v1/sources/:id/resultados` | resultados de la última ejecución, o de `?analysis=` |
| `PATCH` | `/v1/resultados/:id` | `{ revision }`; solo si el caso es Darkroom |

Todas pasan por `guard_case` con su método real, así que las escrituras respetan el candado
del caso (spec de 2026-09-19, Parte 3).

**Compatibilidad:** `POST /v1/cases/:id/analyses` sigue existiendo, porque la interfaz clásica
y `tools/benchmark.py` lo usan. Por dentro crea (o reutiliza) la fuente `imagen/geolocalizar`
de esa imagen y encola el análisis contra ella. Cualquier camino acaba en fuentes.

---

## Parte 2 — El caso normal

Cambia solo el vocabulario:

- El botón y la zona de soltar dicen **«Añadir fuente»** en vez de «Subir imagen». Soltar una
  foto sigue haciendo lo mismo que hoy: crea la fuente `imagen/geolocalizar`.
- `UploadPopup` gana una primera línea, «Tipo: Imagen», que en el caso normal es la única
  opción y no es un selector. Así la palabra «fuente» tiene sentido sin ofrecer nada que no
  exista.

Todo lo demás (mapa, hipótesis, verificación, `ResultsDrawer`, export) queda exactamente
igual.

---

## Parte 3 — El espacio Darkroom

`DarkroomView.tsx` deja de decir «ola». Estructura, de izquierda a derecha, bajo la barra de
título de Lumi (que no cambia):

```
┌ barra del caso ───────────────────────────────────────────────────────────────┐
│ [● Abierto · tú]  Caso X  DARKROOM           Filtro  Capas  Timeline  [+ Añadir fuente] │
├────────────────┬──────────────────────────────────────────┬───────────────────┤
│ Fuentes│Notas│Actividad │                                          │ cajón de la fuente │
│ [buscar…]      │                 mapa                     │ seleccionada       │
│ grupos por     │   resultados · pines · pistas            │ (resultados y      │
│ herramienta    │                                          │  revisión)         │
│ [+ Añadir…]    │                                          │                    │
└────────────────┴──────────────────────────────────────────┴───────────────────┘
```

Filtro, Capas y Timeline aparecen **deshabilitados, con el motivo en el tooltip**
(«Llega cuando haya varias herramientas» / «Necesita fechas por fuente»). No se esconden:
es el patrón de la matriz de capacidades, y además la barra no cambia de forma cuando lleguen.

### 3.1 Panel izquierdo: Fuentes

- **Buscador** que filtra por nombre, valor o herramienta.
- **Contador**: «N fuentes · M pines».
- **Grupos por herramienta** («Geolocalización (3)»), plegables, en un orden fijo del
  registro de herramientas. Un grupo vacío no se muestra.
- **Fila de fuente** (una fila con separador, nunca una tarjeta): miniatura (o el icono del
  tipo, para fuentes de texto) · nombre en mono · `dd-mm hh:mm · nivel` en mono · si es
  derivada, `↳ de fuente N · resultado M` · contadores `✓ confirmados · ○ sin revisar` y, si el
  auditor marcó ruido, `· K probable ruido`. Mientras la herramienta trabaja, los contadores
  se sustituyen por el punto que late (`jg-live`) y «en cola» / «trabajando», sin porcentaje
  falso.
- **Fila seleccionada:** fondo `sel/14`, sin borde lateral (DESIGN.md).
- **Grupo «Pines»** al final, con el icono, el nombre, las coordenadas en mono y, si viene de
  un resultado, `↳ fijado desde <resultado>`.
- **«Añadir fuente…»** al pie, igual que el botón de la barra.

### 3.2 Añadir fuente

Un diálogo en dos pasos, con la composición de diálogo que ya existe:

1. **Tipo.** Lista de tipos del registro. En este spec solo hay «Imagen». Cuando lleguen más,
   cada fila tendrá su icono, su nombre y una línea de lo que admite. Un tipo cuya herramienta
   no está disponible en este servidor aparece deshabilitado con el motivo.
2. **Entrada y herramienta.** Para «Imagen»: soltar o elegir el archivo (reutiliza la subida
   de hoy, con EXIF, `sha256` y todo) y elegir herramienta y nivel. En este spec la única
   herramienta es Geolocalización, así que el paso muestra la herramienta ya elegida y solo
   se puede cambiar el nivel. Si el `sha256` ya existe en el caso, se reutiliza el blob y se
   dice («Esta imagen ya está en el caso · se reutiliza»).

Al aceptar, la fuente aparece en su grupo con el punto que late y el cajón se abre sobre ella.

### 3.3 El cajón de la fuente

A la derecha, al seleccionar una fuente (`Drawer.tsx`, el mismo componente de los cajones
de hoy). Contiene:

- **Cabecera:** herramienta en versalitas, nombre, `nivel · hora`, y acciones: relanzar con
  otro nivel, borrar y «Vista partida» (§3.4).
- **Lista de resultados**, en el orden que dio la herramienta, con los descartados al final y
  atenuados. Cada fila tiene: rango · título · coordenadas en mono si las tiene · puntuación ·
  **veredicto del auditor** (punto de color, texto corto y motivo; solo en herramientas que
  lo usan, spec 3) · si una pista confirmada lo movió, `↑ por pista: <pista>` o `↓ …` en
  `warning` · el **control de revisión** (Sin revisar · Confirmado · Descartado, un control
  segmentado de tres) · y las acciones «Fijar como pin» (solo si está confirmado y tiene
  coordenadas), «Nota» y, cuando haya tipos que lo permitan, «Crear fuente a partir de esto».
- Pasar el ratón sobre una fila resalta su marca en el mapa; hacer clic centra el mapa.

Para Geolocalización, el detalle de una hipótesis (foto de referencia, índice, autor,
verificador, correspondencias) es la `VistaDetalle` de `ResultsDrawer` de hoy, reutilizada
dentro del cajón.

### 3.4 Vista partida

Una vista a pantalla del área de trabajo, a la manera de Raven: **consulta a la izquierda,
candidato a la derecha**, con un divisor arrastrable, zoom y ajuste de cada lado, la tira de
candidatos abajo y el control de revisión en la barra superior. En Geolocalización, el
candidato es la foto de referencia de la hipótesis. Cada herramienta futura la reutiliza con
su propio contenido (el coche candidato, el anuncio, el piso…).

### 3.5 El mapa

`MapCanvas` y `mapEngine` de hoy, con tres capas nuevas:

- **Resultados.** Los de la fuente seleccionada van numerados por rango, en el tamaño
  normal. Los **confirmados de cualquier fuente** están siempre visibles, más pequeños.
  Colores: confirmado en `ok` (con halo), sin revisar neutro (`elevated` con borde `muted`),
  descartado en `subtle` al 50 %.
- **Pines.** Marcador en forma de gota en `fg` con el icono en negativo.
- **Pistas de región** (llegan con spec 3). Contorno discontinuo en `warning` mientras están
  sin revisar; relleno tenue y contorno continuo cuando se confirman; ocultas cuando se
  descartan.

Una ficha sobre el mapa (clic en una marca) repite lo esencial del resultado y sus acciones,
para no tener que ir al cajón.

### 3.6 Pines

```sql
CREATE TABLE IF NOT EXISTS pins (
    id           INTEGER PRIMARY KEY,
    case_id      INTEGER NOT NULL REFERENCES cases(id),
    nombre       TEXT NOT NULL,
    icono        TEXT NOT NULL CHECK (icono IN ('lugar','casa','persona','vehiculo','alerta')),
    lat          REAL NOT NULL, lng REAL NOT NULL,
    resultado_id INTEGER REFERENCES resultados(id),  -- si nació de «Fijar como pin»
    creado_por   INTEGER NOT NULL, creado_en INTEGER NOT NULL,
    borrado_en   INTEGER                              -- borrado lógico: la Actividad lo cita
);
```

Tres formas de crear un pin:

1. **Clic derecho en el mapa → «Poner pin aquí».** Abre una ficha pequeña con nombre, icono
   (cinco, dibujados a mano) y las coordenadas del punto en mono, editables.
2. **«Añadir pin» con coordenadas.** Se aceptan decimales (`40.4168, -3.7038`),
   grados-minutos-segundos (`40°25'00.5"N 3°42'13.7"W`) y un enlace de Google Maps (se
   extraen `@lat,lng` o `q=lat,lng`). El análisis es local, sin llamar a nadie. Si no se puede
   leer, se dice por qué, sin adivinar.
3. **«Fijar como pin»** desde un resultado confirmado con coordenadas. El pin guarda
   `resultado_id`, y el panel muestra de dónde vino.

**Mover un pin** es editar sus coordenadas en la ficha; no se arrastran (decisión del dueño:
un arrastre accidental en un caso forense no debe pasar). Borrar es lógico. Crear, editar y
borrar quedan en Actividad.

API: `GET/POST /v1/cases/:id/pins`, `PATCH/DELETE /v1/pins/:id`.

### 3.7 Notas

```sql
CREATE TABLE IF NOT EXISTS notas (
    id          INTEGER PRIMARY KEY,
    case_id     INTEGER NOT NULL REFERENCES cases(id),
    texto       TEXT NOT NULL,
    ancla_tipo  TEXT CHECK (ancla_tipo IN ('fuente','resultado','pin')),
    ancla_id    INTEGER,
    autor       INTEGER NOT NULL, creado_en INTEGER NOT NULL,
    editado_en  INTEGER, borrado_en INTEGER
);
```

- **Pestaña Notas:** un compositor arriba (texto + selector de ancla opcional, que lista las
  fuentes, resultados y pines del caso) y la lista debajo, de la más nueva a la más antigua,
  con autor y hora en mono y, si la tiene, la etiqueta `⚓ <cosa anclada>`, que al pulsarla
  selecciona esa cosa.
- **La cosa anclada** muestra un indicador pequeño (el número de notas) que abre la pestaña
  Notas filtrada.
- «Nota» en un resultado o un pin abre el compositor con el ancla ya puesta.
- **Editar o borrar** es posible, pero el texto anterior va entero a la Actividad (§3.8). Así
  la cadena de hashes tiene sentido: lo que se dijo no desaparece.

API: `GET/POST /v1/cases/:id/notas`, `PATCH/DELETE /v1/notas/:id`.

### 3.8 Actividad encadenada

Es la cadena de custodia del caso. El nombre de tabla y de módulo evita chocar con
`routes/actividad.rs`, que es el feed del Resumen del admin.

```sql
CREATE TABLE IF NOT EXISTS bitacora (
    id         INTEGER PRIMARY KEY,
    case_id    INTEGER NOT NULL REFERENCES cases(id),
    user_id    INTEGER,                 -- NULL para acciones del propio daemon
    accion     TEXT NOT NULL,           -- 'fuente.creada', 'resultado.revisado', 'nota.editada', 'externo.enviado'…
    datos      TEXT NOT NULL,           -- JSON canónico con lo necesario para reconstruir el hecho
    creado_en  INTEGER NOT NULL,
    hash_prev  TEXT NOT NULL,           -- hash de la entrada anterior del mismo caso ('0'*64 la primera)
    hash       TEXT NOT NULL            -- SHA-256(hash_prev ‖ case_id ‖ user_id ‖ accion ‖ datos ‖ creado_en)
);
CREATE INDEX IF NOT EXISTS idx_bitacora_case ON bitacora(case_id, id);
```

- **Solo-añadir.** La única función que escribe es `bitacora::anotar(conn, case_id, user,
  accion, datos)`, que lee el último `hash` del caso y calcula el nuevo en la misma
  transacción que el cambio que registra. Si el cambio falla, no hay entrada; si no hay
  entrada, no hay cambio. **Ninguna ruta del API la edita ni la borra**, admins incluidos.
- **`datos` va en JSON canónico** (claves ordenadas y sin espacios), para que el hash sea
  reproducible.
- **Qué se anota:** crear y borrar fuentes; lanzar y relanzar herramientas (con el nivel);
  cada cambio de revisión (con el estado anterior y el nuevo); pines creados, editados y
  borrados (con las coordenadas anteriores); notas creadas, editadas y borradas (con el texto
  anterior); pistas confirmadas y descartadas; **todo envío a un servicio externo** (spec 3:
  qué servicio, qué se mandó, el hash de la imagen si fue una imagen); entrar y salir del
  caso, y las expulsiones.
- **Verificación.** `GET /v1/cases/:id/bitacora/verificar` recorre la cadena y devuelve
  `{ integra: true, entradas }` o `{ integra: false, rota_en: <id>, motivo }`. Se ejecuta al
  abrir la pestaña y al exportar. La pestaña lo enseña en una línea fija arriba:
  «Cadena íntegra · 47 entradas» o, en `danger`, «Registro alterado a partir de la entrada
  23». No hay botón de «reparar».
- **Pestaña Actividad:** lista de la más nueva a la más antigua. Cada entrada: hora en mono ·
  texto legible generado desde `accion` + `datos` · autor · el hash corto en mono (`#3fa2c1`).
  Pulsar una entrada selecciona la cosa a la que se refiere, si sigue existiendo.
- **Límite honesto:** la cadena demuestra que nadie ha editado ni borrado filas *en medio*
  sin que se note. Quien tenga root puede reescribir la cadena entera desde una entrada
  hacia delante; eso solo se detecta comparando con una copia exportada. El informe
  exportado incluye el hash de la última entrada, precisamente para eso.

Esto cubre para los casos Darkroom la entrada «Registro de auditoría» de `FUTURO.md`
(subsistema 6). Se actualiza allí diciendo que existe para Darkroom y que falta para el caso
normal.

### 3.9 Revisión

- El control segmentado de tres estados está en cada fila del cajón, en la ficha del mapa y
  en la barra de la vista partida.
- Cambiar el estado es un `PATCH` inmediato, sin «guardar», y deja una entrada en la
  Actividad. Los contadores del panel y el color en el mapa cambian al momento.
- Descartado no borra: la fila baja al final, atenuada, y sigue pudiendo confirmarse.

### 3.10 Crear fuente a partir de esto

Aparece en los resultados cuya herramienta declara que tienen forma de fuente
(`Resultado::como_fuente() -> Option<(tipo, valor | image_id)>`). En este spec ninguna
herramienta lo declara: Geolocalización no produce resultados con forma de fuente. La acción
existe, y el esquema (`derivada_de`) y la interfaz (`↳ de fuente N · resultado M`) quedan
listos para OSINT, Car ID y demás. Al usarla se abre «Añadir fuente» ya en el paso 2, con el
tipo y el valor rellenos.

### 3.11 Tiempo real

El caso Darkroom tiene un único dueño temporal (el candado), así que no hay edición
concurrente que resolver. Los cambios que produce el daemon (una herramienta que termina, un
veredicto del auditor) llegan por el SSE de la cola (`/v1/queue/events`), con eventos nuevos
de `Cambio`: `FuenteActualizada { source_id }` y `ResultadosListos { source_id }`, con
destinatario único como los demás (el filtro `Cambio::para(uid)`).

---

## Parte 4 — Superficie a tocar

| Dónde | Qué |
|---|---|
| `crates/lumid/src/store.rs` | tablas `sources`, `resultados`, `pins`, `notas`, `bitacora`; `analyses.source_id`; migración §1.3 |
| `crates/lumid/src/fuentes.rs` *(nuevo)* | registro de tipos y herramientas, `admite`, `como_fuente` |
| `crates/lumid/src/bitacora.rs` *(nuevo)* | `anotar`, `verificar`, JSON canónico |
| `crates/lumid/src/routes/{sources,resultados,pins,notas,bitacora}.rs` *(nuevos)* | API de §1.4, §3.6, §3.7, §3.8 |
| `crates/lumid/src/routes/analyses.rs` | crear análisis a través de su fuente; resultados al terminar |
| `crates/lumid/src/queue/mod.rs` | al terminar un análisis: filas de `resultados`, entrada en la bitácora, `Cambio::ResultadosListos` |
| `crates/lumi-proto/src/api.rs` | `Source`, `Resultado`, `Revision`, `Pin`, `Nota`, `EntradaBitacora`, `VerificacionBitacora`, variantes de `Cambio` |
| `client/src/lib/api.ts` | tipos y llamadas |
| `client/src/work/DarkroomView.tsx` | el espacio (Parte 3) |
| `client/src/work/darkroom/*` *(nuevos)* | `PanelFuentes`, `CajonFuente`, `VistaPartida`, `PanelNotas`, `PanelActividad`, `AñadirFuente`, `FichaPin`, `ControlRevision` |
| `client/src/work/MapCanvas.tsx`, `mapEngine.ts` | capas de resultados, pines y pistas; menú contextual |
| `client/src/work/UploadPopup.tsx`, `DropTarget.tsx`, `CaseView.tsx` | vocabulario de «fuente» en el caso normal |
| `FUTURO.md` | nota en «Registro de auditoría» |

---

## Parte 5 — Lo que este spec no hace

- No trae ninguna herramienta nueva. Solo Geolocalización.
- No enseña la revisión en el caso normal.
- No trae Filter, Layers, Timeline, Board ni rutas entre pines (índice §3).
- No toca el pipeline de geolocalización ni la cola, salvo para colgar los resultados de su
  fuente.
- No exporta el caso Darkroom a PDF. El export de hoy sigue sirviendo para casos normales. El
  informe Darkroom (fuentes, resultados revisados, notas, pines y el hash final de la
  bitácora) queda como punto de trabajo propio en `FUTURO.md`.

## Verificación

Sin tests nuevos, salvo uno en `lumid` para `bitacora::verificar`: cadena íntegra,
una fila editada y una fila borrada. La integridad de la cadena es exactamente la lógica no
trivial que la convención sí pide probar.

El cierre es:

- `cargo build`, `cargo test -p lumi-proto`, el test de la bitácora, `tsc -b --noEmit` y `npm run
  lint` limpios.
- Migración aplicada sobre una copia de la base de datos real: mismo número de fuentes que
  de imágenes no-upscale, y los casos normales se ven exactamente igual que antes.
- Recorrido en un caso Darkroom: añadir fuente → resultados → confirmar/descartar → fijar pin
  → nota anclada → Actividad íntegra. Luego editar una fila de `bitacora` a mano en el SQLite y
  comprobar que la pestaña lo detecta.
