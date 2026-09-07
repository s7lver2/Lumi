# Panel de resultados: comparar foto vs. foto, luego detalle

## Problema

`ResultsDrawer.tsx` hoy solo enseña coordenadas y números — nunca la foto de
referencia que sostiene la hipótesis. El investigador tiene que fiarse del
número o irse al mapa a comprobar a ojo. Se pide: enseñar primero la mayor
coincidencia con AMBAS fotos (la tuya y la de referencia) una al lado de la
otra, con una barra arrastrable en medio para compararlas como un "antes/
después"; debajo, las demás hipótesis en una lista compacta; al elegir
cualquiera (incluida la principal) se centra su punto en el mapa y se ve su
información completa, con un botón para volver a la vista de comparación.

## Qué falta y por qué

Ninguna `Hipotesis` lleva hoy el id de una imagen de referencia — solo
lat/lng/radio/peso/indice/autor. El agrupador (`lumi-index/src/agrupar.rs`,
función `resumir()`) YA elige, dentro de cada grupo, el candidato de más peso
(`mejor`) para decidir de qué índice y autor es la atribución; reutilizar ese
mismo candidato como "la" foto de referencia es la única opción consistente
con un criterio que el código ya aplica, no uno nuevo que inventar.

Tampoco existe ninguna ruta que sirva una foto de `reference_images` al
cliente — solo existe `/v1/images/:id/thumb` para las fotos que el
investigador sube a un caso (`routes/images.rs::serve_thumb`).

## Backend (Rust)

- `lumi_index::agrupar::Candidato` gana un campo `id: i64`. `recuperar.rs`
  (función `candidatos()`) ya tiene ese id en `p.id` para hacer la consulta;
  solo falta guardarlo en el `Candidato` que construye.
- `Grupo` gana `imagen_id: i64`, tomado del mismo candidato `mejor` que ya
  decide `indice`/`autor` en `resumir()` — una consecuencia más de esa
  elección, no un criterio distinto.
- `lumi_proto::worker::Hipotesis` y el `Hipotesis` de la API (`api.ts`) ganan
  `imagen_id: number`. `recuperar::hipotesis()` lo copia de `Grupo::imagen_id`.
  La principal (`Analysis.result_*`) también necesita este campo — se añade
  `result_imagen_id: i64` a `analyses` (tabla) y a `Analysis` (proto + API),
  rellenado donde hoy se rellenan `result_lat`/`result_confidence` (en
  `queue::mod`, junto al resto de campos de la hipótesis ganadora).
- Nueva ruta `GET /v1/reference-images/:id/thumb` en un `routes/reference_images.rs`
  nuevo: mismo patrón que `serve_thumb` de `routes/images.rs` (sesión
  requerida, miniatura generada la primera vez y cacheada en disco), pero
  leyendo `reference_images.ruta` (ya absoluta, ver `volcar.rs`) en vez de la
  carpeta de imágenes de un caso. Se registra en el router principal junto a
  las demás rutas de `images`.

## Frontend (`ResultsDrawer.tsx`)

Estado local nuevo: `{ vista: "comparar" | "detalle", sel: number }` (`sel`
0 = principal, 1..N = alternativas por índice en `hypotheses`), reiniciado a
`{ vista: "comparar", sel: 0 }` cada vez que cambia `analysis.id` (otra
imagen, u otro intento).

**Vista Comparar (por defecto):**
- Tarjeta de la hipótesis principal: el componente nuevo `CompareSlider`
  (ver abajo) con la foto del caso (`image.id`) a un lado y
  `/v1/reference-images/{result_imagen_id}/thumb` al otro, más las mismas
  coords/radio/confianza/insignia de verificación que ya pinta
  `HipotesisList` hoy.
- Debajo, la lista de alternativas: igual que hoy (número, coords, barra de
  peso) pero cada fila es un botón que hace `sel = i+1, vista = "detalle"`
  — no un `<div>` inerte.
- La propia tarjeta principal también es clicable → `sel = 0, vista =
  "detalle"`.

**Vista Detalle:**
- Botón «← Volver» (mismo patrón visual que `AjustesSidebar`) que hace
  `vista = "comparar"` sin tocar `sel`.
- Llama a `onCenter(lat, lng)` en un `useEffect` al entrar (recupera el
  callback que la firma de `ResultsDrawer` ya acepta pero nadie dispara desde
  aquí — el comentario actual que dice "ese menú vive ahora en
  `AttemptsRail`" deja de ser cierto para este caso).
- Info completa de esa hipótesis sola: coords, radio, confianza, verificador
  + inliers si los hay, índice/autor. Sin la foto de comparación aquí — el
  slider es cosa de la vista Comparar, no se duplica.

**`CompareSlider` (nuevo, en `ui/` — es reutilizable, no específico de
resultados):**
- Dos `<img>` superpuestas del mismo tamaño; la de encima recortada con
  `clip-path: inset(0 X% 0 0)` donde `X` es `100 - posición%`.
- Una línea vertical + tirador en `posición%`, arrastrable con puntero
  (`pointerdown`/`pointermove`/`pointerup`, sin librería — el mismo criterio
  de "sin dependencias nuevas para algo que se resuelve con eventos nativos"
  que ya sigue el resto del cliente).
  Empieza en 50%. Etiquetas pequeñas "tuya" / "referencia" en las esquinas
  opuestas de cada foto, mono/subtle como el resto de metadatos.
- Colores/bordes: mismos tokens que el resto (`border-border`, `bg-elevated`
  para el hueco antes de cargar), nada de sombra/gradiente decorativo.

## Fuera de alcance

- No se cambia cómo se calculan las hipótesis, solo qué se expone de ellas.
- No hay galería de más de una foto de referencia por hipótesis — un
  candidato, una foto, igual que un solo `autor`/`indice` por grupo.
- El slider no hace zoom ni pan, solo el barrido horizontal.
