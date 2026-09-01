# Descarga y embebido, fusionados — diseño

## Contexto

Hoy `DownloadView.tsx` y `EmbedQueueView.tsx` son dos pantallas separadas, con su propia
navegación (`Rail`/`Destino`) — terminar de descargar no lleva a embeber, hay que cambiar de
pestaña. El nivel (mini/pro/vision, `niveles.rs`) se fija una sola vez al crear el índice
(`NewIndexDialog.tsx`, copy explícito: *"Se fija al crear el índice y no se puede cambiar
después"*) y no hay forma de subirlo o bajarlo más tarde salvo reindexar desde cero. El ETA de
descarga se calcula por imágenes cuando hay una estimación (`imagenesEstimadas`), pero cae a un
cálculo por teselas —que el propio comentario del código admite que se queda mudo— en cuanto esa
estimación no llega, lo cual pasa en la práctica (no es un caso raro). Y no existe ningún control
de cuántos recursos usa embeber: siempre a la misma prioridad de proceso.

## Alcance

- **Una sola pantalla**: descarga arriba, embebido debajo del todo en cuanto hay algo que
  embeber — mismo scroll, sin navegación aparte. Sustituye a `DownloadView`/`EmbedQueueView`
  como destinos separados.
- **Portear a otro nivel**: acción nueva sobre un índice ya creado (sellado o no) que cambia su
  nivel objetivo y encola solo los modelos que le faltan para el nuevo — reutiliza
  `reembeber::encolar` (ya existe, por modelo) en vez de un mecanismo nuevo. Subir de nivel
  añade modelos; bajar no borra vectores ya calculados, solo dejan de exigirse.
- **Modo de consumo (alto/bajo)** en Ajustes, junto a "Concurrencia de embebido" (que ya existe):
  alto = prioridad de proceso normal + concurrencia 2 (el comportamiento de hoy); bajo =
  prioridad de proceso baja + concurrencia 1. Aplica al proceso `lumi_embed.py` que ya se lanza
  vía `queue.rs::arrancar` → `proceso::cmd_async`.
- **ETA de descarga por imágenes, siempre**: nunca caer al cálculo por teselas. Si no llega una
  estimación fiable de antemano, se deriva de lo que ya se sabe (imágenes servidas hasta ahora +
  teselas que quedan × imágenes media por tesela ya vista), no de un contador que se queda mudo.
  Un total claro y visible ("X de Y imágenes"), no solo el ritmo.

Fuera de alcance (con motivo):

- **Sistema de revisión**: investigado aparte, confirmado que se queda tal cual — sirve para
  Commons/Flickr, que el operador no usa hoy, pero no es código muerto si algún día los usa.
- **Tope de potencia de GPU** (como el slider de `HardwareView` en `lumid`): confirmado que
  prioridad de proceso + concurrencia basta para el objetivo real ("poder seguir usando el
  ordenador mientras corre de fondo") — es infraestructura que el Indexer no tiene hoy y que
  lumid tiene para un producto distinto.
- **Ejecución tras cerrar la app** (bandeja del sistema, superviviencia entre reinicios del
  proceso): confirmado que "segundo plano" significa "no acaparar el ordenador mientras la app
  sigue abierta", no "seguir corriendo con la app cerrada".

---

## 1. Pantalla fusionada

`DownloadView`/`EmbedQueueView` se combinan en un componente nuevo (p. ej.
`indexer/src/embed/DescargaYEmbebidoView.tsx`) que renderiza el contenido de descarga primero
(igual que hoy, incluyendo mapa/registro/gasto) y, debajo, la sección de embebido — visible en
cuanto `api.indiceProgresoEmbebido(indiceId)` devuelve alguna fila con `total > 0`, sin esperar a
que la descarga termine del todo (un índice puede tener trabajo de embebido pendiente de una
sesión anterior mientras la descarga de hoy sigue en marcha). `Rail`/`App.tsx` pierden el destino
separado de embebido; el índice queda abierto en una sola vista que cubre todo su ciclo de
trabajo tras crearse.

## 2. Portear a otro nivel

Botón junto al nombre del índice (en la vista fusionada o en su cabecera, a decidir en el plan de
implementación contra el layout real) que abre un selector de nivel (mismo componente visual que
`NewIndexDialog.tsx` ya usa para elegirlo la primera vez). Al confirmar:

- Se resuelve la composición del nivel elegido (`niveles::resolver_composicion`, ya existe) para
  saber qué modelos exige.
- Se compara contra los modelos que el índice YA tiene encolados/embebidos (consulta existente,
  `vectores`/`indices_con_pendientes` o equivalente — a confirmar el método exacto contra
  `store.rs` en el plan).
- Por cada modelo que falte, `reembeber::encolar(almacen, indice_id, modelo)` — ya soporta
  encolar un modelo nuevo sobre un índice existente, sellado o no.
- El nivel guardado del índice (columna a confirmar si ya existe o hace falta añadirla — el nivel
  se pasa hoy solo en la creación, `indice_crear(nombre, niveles)`) se actualiza al nuevo.

## 3. Modo de consumo

`proceso::cmd_async` (`indexer/src-tauri/src/proceso.rs:35-41`) ya fija `creation_flags` en
Windows (`SIN_CONSOLA`/`CREATE_NO_WINDOW`). Se añade un parámetro (o una variante) que también
fije `BELOW_NORMAL_PRIORITY_CLASS` cuando el modo es "bajo" — combinable por OR con el flag ya
presente. En Unix, aplicar `nice` a través del mecanismo que exponga `tokio::process::Command`
más limpio contra la versión real del crate (a confirmar en el plan; si no hay uno directo, es
aceptable dejarlo como techo anotado para Unix en esta primera pasada — el uso principal de este
producto es Windows con los servicios en WSL, no el Indexer en sí corriendo en Linux).

El ajuste vive en `ServicesPanel.tsx`, junto a "Concurrencia de embebido" — mismo bloque, mismo
patrón de botones — y se persiste igual que la concurrencia ya se persiste hoy (a confirmar el
mecanismo exacto, `colaConcurrenciaFijar`/equivalente, en el plan). "Alto" fija concurrencia 2 +
prioridad normal; "Bajo" fija concurrencia 1 + prioridad baja — un solo control en vez de dos
independientes, porque separarlos deja combinaciones sin sentido (prioridad baja + concurrencia
2 no cumple el objetivo de dejar el ordenador libre).

## 4. ETA de descarga por imágenes

`DownloadView.tsx`'s cálculo de ETA (líneas 29-55 de la lectura de referencia) cae al ritmo por
teselas cuando `imagenesEstimadas` es `null`/`0`. Se elimina esa rama: el ritmo se calcula
SIEMPRE sobre `x.imagenes` (que sí sube en tiempo real, tesela en curso o no) contra el total
mejor conocido en cada momento — la estimación inicial si existe, o si no, una que se recalcula
sobre la marcha a partir de la media de imágenes por tesela ya vista
(`x.imagenes / teselas_hechas`, proyectada sobre `teselas_total`). El ETA deja de desaparecer
sin más que porque el prop de estimación inicial no llegó.

Encabezado de la vista: junto a "N de M teselas" (que se queda, es información real), se añade
"N de M imágenes" con el mismo tratamiento visual, siempre que haya un total (estimado o
recalculado) que mostrar.
