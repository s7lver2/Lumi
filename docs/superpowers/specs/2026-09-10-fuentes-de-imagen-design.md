# Más fuentes para el corpus: arreglar Commons y cubrir las fachadas

Escrito el 2026-09-10 tras investigar por qué un análisis de la catedral de
León no encuentra nada. Todo lo que aquí se afirma como hecho está
**verificado en vivo** contra la API real ese día; lo que no se pudo
confirmar va marcado como tal en vez de rellenarse a ojo.

## El problema

Un análisis de la catedral de León no la encuentra. No es un fallo del motor:
el corpus instalado no tiene ni una sola foto que enseñe la fachada.

Contado sobre las filas realmente instaladas en el servidor:

```
Counter({'mapillary': 11823, 'kartaview': 3182})
```

Dos fuentes, las dos de nivel de calle. Hay cobertura de la *zona* —fotos a
pocos metros— pero ninguna encara el monumento. Y **cero** de Commons, que es
la fuente que sí tendría fachadas.

Dos causas distintas, que se arreglan por separado:

1. **Commons está integrado pero no trae nada.** No es que Commons esté vacío.
2. **Ninguna fuente pregunta por monumento.** Todas preguntan por coordenada,
   y una coordenada no sabe que ahí hay una catedral.

## Qué NO entra en este spec

Investigado y descartado, para que nadie lo vuelva a proponer:

- **El bbox de Mapillary.** Se sospechó que el límite de área de 0,01 grados
  cuadrados (enero 2026) nos afectaba, confundiendo los 0,022° de *ancho* de
  una tesela z14 con el límite de *área*. El área real es ~0,00035°², y el
  adaptador ya lo documenta y lo tiene bajo test
  (`(n[2]-n[0])*(n[3]-n[1]) < 0.001`). No hay nada que arreglar.
- **Flickr.** Hoy exige suscripción **Flickr Pro** para pedir una clave nueva,
  y sus términos limitan la API a uso **no comercial** ("el uso comercial es
  posible mediante acuerdo previo"). Publicando paquetes `.lumidx` no encajamos
  ahí. El adaptador existente se deja como está —no estorba y solo entra en
  `registro()` si hay clave— pero **no se invierte más en él** y deja de
  aparecer en la documentación como fuente recomendada.
- **Google Street View.** Sus términos prohíben expresamente el bulk download
  de imágenes, y la lista de lo que sí se puede cachear (coordenadas,
  `place_id`, `pano_id`) **no incluye la imagen**. Un `.lumidx` que guarde esos
  píxeles es incompatible con esos términos aunque las peticiones estén
  pagadas. Fuera de alcance, y no se escribe ningún scraper.
- **Bing Streetside** (retirado en octubre de 2025), **Apple Look Around**,
  **Yandex**, **Baidu**: sin API pública de descarga.
- **Unsplash, Pexels, Openverse**: sin coordenada por foto. Openverse ni
  siquiera tiene búsqueda geoespacial.
- **IPCE / Fototeca del Patrimonio**: CC BY-NC-ND. `Reglas::evaluar` ya la
  rechazaría, y con razón.
- **iNaturalist**: verificado, 59 observaciones CC con foto y coordenada exacta
  en la tesela de la catedral. Pero son primeros planos de plantas y bichos:
  inútil para emparejar una fachada. Puede tener valor futuro para geolocalizar
  fotos de campo, donde no llega ningún street view. No ahora.

---

## 1. Arreglar la geosearch de Commons

`indexer/src-tauri/src/origins/commons.rs`, función `url()`.

La consulta pide `cllimit=20` pero **no pide `colimit`**, y el submódulo
`coordinates` de GeoData tiene un **default de 10 por petición**. Con 500
páginas candidatas eso obliga a ~50 continuaciones solo para las coordenadas,
y el bucle de `paginas()` está topado a 60 iteraciones. En las teselas densas
—justo las de los monumentos— el bucle se agota antes de completar el cruce, y
`descargar()` descarta toda página a la que le falte uno de los dos campos:

```rust
let (Some(c), Some(i)) = (p.coordinates.first(), p.imageinfo.first()) else { continue };
```

Medido en vivo sobre la tesela z14 de la catedral (`7938/6045`), añadiendo
`colimit=500`, en **una sola petición**:

```
paginas: 500   con coordinates: 496   con imageinfo: 50
```

De ~50 peticiones a 1. `imageinfo` sigue resolviendo 50 páginas por petición
(es un tope del propio módulo, no un parámetro que podamos subir), así que la
tesela baja de ~60 peticiones a ~10.

Se añaden **tres** parámetros:

- `colimit=500` — el arreglo real.
- `cllimit=500` — sube el de categorías por coherencia; el filtro de interiores
  las lee y hoy solo ve las 20 primeras.
- `ggsprimary=all` — por defecto GeoData devuelve solo la coordenada
  **primaria**, que en Commons es la de `{{Location}}` (dónde estaba la
  cámara). La de `{{Object location}}` (dónde está el **monumento**) se indexa
  como secundaria y hoy se descarta entera. Muchas fotos de fachada solo llevan
  *object location*.
  **No confirmado cuantitativamente**: no se pudo medir el delta porque ambas
  consultas saturan el tope de 500 resultados. El default es incuestionable;
  la magnitud de la mejora, no.

Con eso, medido replicando la lógica del adaptador sobre esa tesela:

```
sin coordinates: 0   sin imageinfo: 0
PASAN el filtro: 475
descartadas: 20 por pequeñas, 5 por interior
```

475 imágenes utilizables donde hoy hay cero, incluidas fotos de la catedral.

### Lo que este arreglo NO resuelve

La caché de sondeos del Indexer (`indexer.db`, tabla `sondeos`) no tiene **ni
una sola fila** de `commons`:

```
kartaview|mucho|4|4119
kartaview|nada |2|0
mapillary|mucho|6|5345
```

`sondear_area` solo escribe en caché cuando el sondeo tiene éxito. Cero filas
significa que Commons nunca completó un sondeo, en ninguna tesela.

Se descartó la causa más obvia: el `User-Agent` que pone `Ctx`
(`LumiIndexer/2.0.38`) **no** es rechazado por Wikimedia — devuelve `200`.

Queda la explicación de coste: 60 peticiones secuenciales por tesela a 2 req/s
con concurrencia 1, y `sondear_area` lanza todas las teselas a la vez contra
ese mismo limitador. Con 6 teselas son ~3 minutos antes de que Commons empuje
su primer resultado, mientras Mapillary y KartaView aparecen al instante.
Bajar a ~10 peticiones por tesela lo deja en segundos.

**No está confirmado que sea solo eso** —no hay logs de aquellas ejecuciones—
pero es coherente con todo lo medido. Si tras el arreglo la tabla `sondeos`
sigue sin filas de `commons`, hay una segunda causa y hay que buscarla con
logs, no con más parámetros.

---

## 2. Origen nuevo: monumentos vía Wikidata → Commons

Este es el que tapa el hueco. Ninguna cantidad de street view va a enseñar una
fachada; hay que **preguntar por monumento, no por coordenada**.

Fichero nuevo: `indexer/src-tauri/src/origins/monumentos.rs`,
`id() == "monumentos"`, `Tipo::Suelta`, `Tarifa::Gratis`,
`Redistribucion::Libre`. Sin clave. Entra siempre en `registro()`, como
Commons y KartaView.

### Paso 1 — qué monumentos hay en la tesela

SPARQL contra `https://query.wikidata.org/sparql`
(`Accept: application/sparql-results+json`, `User-Agent` identificable, sin
clave). `SERVICE wikibase:around` sobre `P625` centrado en la tesela, pidiendo
`P18` (imagen principal) y `P373` (categoría de Commons), quedándose con los
que tengan al menos uno de los dos.

Verificado con radio de 1 km desde la catedral:

```
monumentos con imagen o categoria en 1 km: 60
 - Catedral de Santa María de Regla de León |cat: Cathedral of León |img: si
 - Iglesia de San Salvador de Palat del Rey |cat: ...              |img: si
 - Palacio del Conde Luna | Plaza del Grano | Museo Sierra Pambley
```

### Paso 2 — todas las vistas de cada monumento

`action=query&list=categorymembers&cmtype=file` sobre la categoría de Commons.
Verificado sobre `Category:Cathedral of León`: **67 ficheros directos**, más
subcategorías.

Luego un `prop=imageinfo` por lotes sobre esos títulos para obtener tamaño,
URL de miniatura de 2048 y `extmetadata` — exactamente lo que
`commons.rs::descargar` ya hace, reutilizando `Reglas::por_defecto()` y el
mismo mapeo a `Captura`.

### La coordenada

Un fichero de una categoría **no** está geoetiquetado. Se le asigna la
**coordenada del monumento** (`P625`), no la de la cámara.

Es una decisión deliberada y hay que documentarla en el propio fichero: para
un corpus de referencia de fachadas, "dónde está el edificio" es una
coordenada **mejor** que "dónde estaba el turista". Pero **no es lo mismo**, y
el que lea el manifiesto tiene que poder saberlo. Por eso:

- `Captura.atribucion` conserva autor, URL y licencia reales del fichero.
- La `fuente` es `"monumentos"`, no `"commons"`, aunque los bytes salgan de
  Commons: son dos procedencias distintas de coordenada y el manifiesto no
  puede fundirlas.

### Recursión en subcategorías

Solo **un nivel** de subcategorías, y solo las que empiecen por `Exterior`,
`Facade`, `Views of`, `Fachada` o `Vistas`. Bajar la categoría entera de una
catedral recursivamente arrastra vidrieras, capiteles, planos y grabados del
XIX — material que el verificador geométrico no puede emparejar con una foto
de móvil.

`// ponytail:` el prefijo es una heurística de lista corta, igual que
`filter::INTERIOR`. Si resulta que deja fuera demasiado, la salida es la
revisión por excepción, que ya existe, no una lista más larga.

### Límites

- 2 req/s y concurrencia 1, igual que Commons: es la misma infraestructura
  donada.
- SPARQL tiene timeout de 60 s por consulta; una tesela que lo agote se anota
  como fallo y no se cachea, igual que hace hoy `sondear_area`.
- `sondear()` devuelve `Disponibilidad::Muestreo` con la suma de ficheros de
  las categorías encontradas, sin bajar un byte.

---

## 3. Origen nuevo: Panoramax

Fichero nuevo: `indexer/src-tauri/src/origins/panoramax.rs`. Es un clon casi
exacto del de Mapillary: street-level, con rumbo, sin clave.

- Endpoint: `https://api.panoramax.xyz/api/search?bbox=oeste,sur,este,norte`
  (STAC). **Verificado sin clave.**
- Licencia: **CC-BY-SA-4.0**, declarada por *feature* en el propio JSON.
- `Tarifa::Gratis`, `Redistribucion::Libre`, `Tipo::Calle`.

Verificado sobre la tesela de la catedral: **11 features**, con tomas de
**agosto de 2026** y assets `hd` / `sd` / `thumb`. Cobertura real en España,
pero **fina** — no es un sustituto de Mapillary, es un cuarto origen que suma.

Campos del `properties` que interesan, todos verificados presentes:

| Campo Panoramax | Campo de `Captura` |
|---|---|
| `geometry.coordinates` | `lat` / `lng` |
| `view:azimuth` | `rumbo` |
| `datetime` | `capturada_en` |
| `license` | `atribucion.licencia` |
| `geovisio:producer` | `atribucion.autor` |
| `assets.sd.href` | la imagen que se baja |

Y uno que **ninguna otra fuente nos da**: `quality:horizontal_accuracy`, que
alimenta directamente `Candidata::precision_metros`. Hoy ese campo va siempre
a `None` porque ni Commons ni Mapillary publican precisión, y la regla
`precision_maxima_m: 100.0` de `Reglas::evaluar` nunca llega a dispararse.
Panoramax es la primera fuente que la activa de verdad.

### No confirmado

- **Rate limits**: no hay cifra publicada. Se trata como Commons (2 req/s,
  concurrencia 1, `User-Agent` identificable) por prudencia, no porque lo pida.
- **Paginación**: la respuesta de prueba (11 features) no traía `links`, así
  que no se pudo observar el mecanismo de página siguiente. Hay que resolverlo
  contra una tesela densa —París, por ejemplo— **antes** de dar el adaptador
  por terminado; sin eso, una tesela con más features que el `limit` se
  quedaría truncada en silencio, que es exactamente el fallo que Mapillary ya
  tuvo y costó encontrar.

---

## 4. YFCC100M: investigación previa, no adaptador

**No se compromete implementación.** Se escribe aquí lo averiguado para que
quien lo retome no repita el trabajo.

La idea era buena: YFCC100M es el archivo CC de Flickr ya volcado en AWS Open
Data, así que daría el contenido de Flickr **sin** el API de Flickr ni sus
términos. El bucket sigue vivo y es público:

```
=== AWS multimedia-commons ===
200
Key>data/images/000/24a/00024a73d1a4c32fb29732d56a2.jpg
```

Pero los **metadatos con lat/lng y licencia no están ahí**. Los prefijos del
bucket son `data/images/`, `data/videos/`, `features/`, `subsets/`, `tools/`.
El fichero geo del subset `YLI-GEO` resulta ser una lista de identificadores
pelada:

```
f2b13098849106fb62ca4b3b9c57b73	0	2014	0
30a023d5ed5d6eed4fc71fcc5eb18bb	0	2014	0
```

Sin coordenada y sin licencia no sirve: no se puede filtrar NC/ND antes de
bajar, que era justo la ventaja.

**Lo que hay que averiguar antes de escribir nada**: dónde vive hoy el
`yfcc100m_dataset` original (el fichero con URL, lat/lng, `accuracy` y
licencia por foto) y bajo qué condiciones se descarga. Hasta que eso esté
confirmado, esto no es una fuente, es una hipótesis.

Aparte, dos avisos que ya se saben: es una **instantánea de 2014** que no
crece, y buena parte de su contenido CC **ya está en Commons** (lo trasvasa
Flickr2Commons desde hace años), así que el solape con los puntos 1 y 2 podría
ser grande. Conviene medirlo antes de invertir.

---

## Orden y criterio de hecho

1. **Commons** (`colimit` + `cllimit` + `ggsprimary`). Tres parámetros.
   *Hecho cuando*: un sondeo real de la tesela de la catedral deja fila en
   `sondeos` y una descarga trae >0 capturas de `commons`.
2. **Monumentos** (Wikidata → Commons). El que tapa el hueco.
   *Hecho cuando*: un análisis de una foto de la fachada de la catedral
   devuelve una hipótesis con respaldo geométrico.
3. **Panoramax**. Cuarto origen de calle, con la paginación resuelta.
   *Hecho cuando*: una tesela densa (no León) trae más features que el `limit`
   de una sola página y el adaptador las recoge todas.
4. **YFCC100M**. Solo la investigación de arriba, sin código.

Los tres primeros son 0 € y licencia libre, sin acuerdo con nadie.

## Fuera de alcance

- Tocar el motor de inferencia, el verificador geométrico o los umbrales.
  Esto es un problema de **corpus**, no de modelo: `roma` no puede confirmar
  una fachada que no tiene con qué comparar.
- Reindexar o volver a sellar los paquetes ya publicados.
- Quitar el adaptador de Flickr. Se queda inerte; borrarlo es otra tarea.
- Cambiar `Reglas::por_defecto()`. Los 475 que pasan el filtro en la tesela de
  la catedral dicen que el filtro no es el problema.
