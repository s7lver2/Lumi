# Versionado de índices en el Indexer — diseño

## Contexto

"Versión" significa cinco cosas distintas en este código, sin que ninguna se llame así en la
conversación de todos los días:

1. **Versión de modelo** (`Modelo.version`, `indexer/src-tauri/src/models.rs:21`) — un string
   suelto por cada JSON de `registros/modelos/`. No forma parte de la clave primaria que rastrea
   qué imágenes ya tienen vector (`vectores` en `store.rs`, clave `(imagen_id, modelo)` — sin
   `version`), así que subir la versión de un modelo existente en el sitio es indefinido hoy, no
   solo incómodo. Fuera de alcance de esta spec — es un problema de integridad de datos, no de
   experiencia de versionado, y se trata aparte.
2. **Versión de esquema del manifiesto** (`Manifiesto.version: u32`, `crates/lumi-index/src/manifest.rs:155`).
3. **Versión de esquema de la ficha** (`Ficha.version: u32`, `crates/lumi-index/src/ficha.rs:62`).
4. **Versión de CONTENIDO del índice** (`numero_version`, ver abajo) — la que esta spec rediseña.
5. **Versión de esquema de cobertura** (`Cobertura.version: u32`, `crates/lumi-index/src/coverage.rs:39`)
   — sin usar todavía, placeholder.

El punto 4 es "Crear versión nueva" en el Indexer de hoy: clona el índice sellado entero en uno
nuevo (`store.rs:392` `crear_version`, `store.rs:634` `clonar_version`), con un techo duro que le
impide al hijo indexar ni una tesela fuera de las que tenía el padre al nacer
(`territorio_clasificar`, `lib.rs:693-718`; `fuera_de_techo`, `package.rs:26-32,93-110`).

Esto hace que "expandir" — sumar imágenes de otro proveedor, ampliar el área — se sienta como
crear-algo-nuevo-y-atado en vez de seguir llenando lo que ya existe, tanto antes como después de
publicar. Confirmado con el propio operador: el único uso real de "Crear versión nueva" hoy es
crecer, nunca ramificar (probar algo en paralelo sin tocar la línea publicada).

## Alcance

- Colapsar `numero_version` a una sola línea de tiempo por índice: el índice de trabajo (sin
  publicar) crece sin límite ni clonado — proveedor nuevo, área nueva, modelo nuevo, en cualquier
  orden, en el mismo sitio.
- Publicar pasa a significar "cortar el estado actual como versión N", calculando automáticamente
  la diferencia desde el último corte (teselas nuevas, imágenes nuevas, capas de modelo nuevas) y
  empaquetando solo eso — generalización del mecanismo que ya existe hoy para publicar solo una
  capa de modelo sin resubir cuerpos (`publicar_capa`, `publicar.rs:700`).
- El etiquetado de release en GitHub no cambia: cada publicación sigue teniendo su propia tag
  (`etiquetar_de`, `publicar.rs:391-403`). Lo que cambia es que cada tag ahora solo lleva su
  delta, y la ficha de la versión N referencia la anterior para reconstruir el conjunto completo
  encadenando hacia atrás.
- Eliminar el clonado (`crear_version`/`clonar_version`, `versions.rs` entero, el comando Tauri
  `version_crear`) y el techo (`fuera_de_techo`, el cap de `teselas_trabajo` en
  `territorio_clasificar`) — sin ramificación, ese mecanismo no protege nada que no proteja ya el
  sistema normal de reclamo de territorio entre proyectos distintos.
- Eliminar la columna `viene_de` (genealogía padre→hijo) de `indices`.

Fuera de alcance (con motivo):

- **Versión de modelo como tipo real / clave primaria** (punto 1 de arriba): es un problema de
  integridad de datos independiente, no de experiencia de versionado — se trata en su propia
  spec cuando toque.
- **Ramificación**: confirmado que no hace falta — colapsar a una sola línea es la simplificación
  correcta, no una limitación a compensar más adelante.
- **Migración de índices ya publicados con `numero_version` > 1 por clonado**: no existen en
  producción (la app es de un solo operador, uso reciente) — no hace falta ruta de migración.

---

## 1. Índice de trabajo: crece sin corte

Hoy, un índice sin sellar ya puede recibir teselas/proveedores/modelos nuevos libremente — el
techo solo entra en juego a través de `numero_version` > 1 (un hijo clonado). Con el clonado
fuera, el techo deja de tener ningún disparador: se borra `fuera_de_techo` (`package.rs:26-32`)
y el cap correspondiente en `territorio_clasificar` (`lib.rs:693-718`), que vuelve a clasificar
`local`/`catálogo`/`nueva` sin mirar `numero_version` en absoluto.

`indices.numero_version` se queda como columna (default `1`, `store.rs:257`), pero pasa de
"generación del clonado" a "cuántas veces se ha publicado este índice" — se incrementa solo en
`publicar()`, nunca en la creación del índice.

## 2. Publicar: corte incremental automático

`publicar()` (`publicar.rs:465`, cuerpo completo) sigue siendo el camino para la primera
publicación (v1: todo lo indexado hasta ahora). Para v2 en adelante, se generaliza el mecanismo
de `publicar_capa()` (hoy solo para capas de modelo nuevas, referenciando el cuerpo de otro por
hash) para que también cubra:

- **Teselas/imágenes nuevas desde la última publicación**: se comparan las teselas cubiertas
  localmente contra las que ya aparecían en la ficha de la versión anterior
  (`Ficha` de `numero_version - 1`, leída del catálogo local); solo las teselas nuevas entran en
  el cuerpo de esta publicación.
- **Capas de modelo nuevas**: sin cambios respecto al mecanismo actual.

El cálculo de "qué es nuevo" es responsabilidad de `publicar()`/`publicar_capa()` unificados —
no del operador: al pulsar "Publicar" en un índice que ya tiene una versión previa, no hay
elección que hacer, se publica la diferencia completa.

## 3. Ficha: encadenar versiones

`Ficha.numero_version` (`ficha.rs:66-68`) se queda con su nombre y su semántica de "versión de
CONTENIDO, no de formato" — solo cambia lo que puede representar (un corte incremental, no un
clon). Gana un campo `version_anterior: Option<String>` (hash o tag de la ficha/release previa),
para que quien descargue la versión N pueda resolver la cadena completa hacia atrás sin depender
de haber visto todas las versiones intermedias antes.

`FichaResumen.numero_version` (`catalogo.rs:52-53`) sigue mostrando el número tal cual — sigue
siendo cierto que dice "cuántas veces se publicó esto", solo que ahora ninguna de esas
publicaciones es un fork.

## 4. Qué se borra

- `indexer/src-tauri/src/versions.rs` — archivo entero.
- `version_crear` (comando Tauri, `lib.rs:468-472`) y su botón "Crear versión nueva" en el
  frontend.
- `crear_version`/`clonar_version` (`store.rs:392,634`).
- `viene_de` (columna `indices`).
- `fuera_de_techo` (`package.rs:26-32,93-110`) y el cap de `teselas_trabajo` en
  `territorio_clasificar` (`lib.rs:693-718`).
- El sentinel de "techo, no un reclamo real" en `package.rs` y su renderizado en
  `MapCanvas.tsx:216-231`.

Neto: menos código que hoy, no más — el clonado y el techo desaparecen sin sustituto porque no
protegen nada que el reclamo de territorio entre proyectos distintos no proteja ya.
