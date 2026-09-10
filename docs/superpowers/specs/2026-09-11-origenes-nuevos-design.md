# Seis orígenes más para el Indexer

> Estado: aprobado para plan · 2026-09-11 · subsistema 7b
> Precede: `dd5da1e` (Commons devolvía 0 en todas partes)

## 0. Una corrección antes de empezar

En la conversación que originó este spec propuse «Commons por categoría, vía
Wikidata» como el mayor multiplicador pendiente. **Estaba equivocado: ya
existe.** `origins/monumentos.rs` no es un adaptador de patrimonio pese al
nombre — su SPARQL es `SERVICE wikibase:around` sobre *cualquier* entidad con
`P625`, sin filtro de clase, y de ahí salta a `P373` (categoría de Commons) y
lista sus ficheros.

Lo que sí falta en ese camino son dos huecos concretos, medidos sobre la tesela
`03133320022212` (centro de León, radio 1,5 km):

| | items |
|---|---|
| entidades de Wikidata con imagen o categoría | 142 |
| con `P373` — las que `monumentos.rs` usa hoy | 104 |
| **solo `P18`, sin categoría — descartadas en `descargar()`** | **38 (27 %)** |

Así que el sexto origen de la lista original se convierte aquí en **una mejora
de `monumentos.rs`**, no en un adaptador nuevo. El resto sí son orígenes
nuevos. El recuento de «seis» se mantiene; lo que cambia es dónde vive uno de
ellos.

## 1. Objetivo y criterio de aceptación

Ampliar la oferta de imágenes geolocalizadas del Indexer sin romper tres
invariantes del 7b:

1. **Un origen sin credencial no entra en el registro.** Ninguno de los seis
   necesita clave, así que los seis entran siempre.
2. **Nada se descarga sin haber pasado por el presupuesto.** `Tarifa::Gratis`
   sigue anotándose: la línea existe aunque sume cero euros.
3. **Toda captura viaja con su atribución y su licencia reales.** No hay
   licencia «del origen»: la licencia es del fichero.

Aceptación: para una tesela urbana europea, el sondeo enumera los seis con un
número creíble en menos de 15 s por origen, y una descarga de prueba produce
capturas con `lat`/`lng`/`atribucion` correctos que sellan sin que
`lumi_index::filas` se queje.

## 2. Los seis, medidos contra la red

Todo lo de esta tabla está comprobado con peticiones reales el 2026-09-11
sobre `03133320022212` salvo donde se indica otra zona.

| # | Origen | id | Medido | Veredicto |
|---|---|---|---|---|
| 1 | Wikipedia → imágenes del artículo | `wikipedia` | 60 artículos, 45 con imagen principal; 475 imágenes enlazadas en los 20 primeros | **Alto**, con filtrado obligatorio |
| 2 | Wikidata `P18` (hueco de `monumentos`) | *(dentro de `monumentos`)* | 38 items recuperados de 142 | **Medio**, coste casi nulo |
| 3 | Ortofoto nacional por WMS | `wms-orto` | PNOA sirve JPEG 4096×4096 sobre la tesela (≈0,44 m/px), gratis | **Alto** para ES, sustituye pago |
| 4 | iNaturalist | `inaturalist` | 59 observaciones CC → **34** pasan `Reglas::por_defecto()`, 75 fotos | **Medio**, sube en rural |
| 5 | Geograph | `geograph` | 7.417 imágenes a 1 km de Londres, sin clave, con `lat`/`long`/`licence` | **Alto en UK/IE, nulo fuera** |
| 6 | OpenAerialMap | `openaerialmap` | **0** en León; 20 en Dar es Salaam, `gsd` 2,1 cm | **Bajo**, cobertura testimonial en Europa |

Que el 6 salga flojo es un resultado, no una pega: se implementa igual porque
es barato y porque donde hay cobertura es la única aérea libre a esa
resolución, pero **entra en la última fase y sin prioridad**.

## 3. Decisiones transversales

### 3.1 Cada origen es un `id` propio

Cinco `id` nuevos en `origins::registro()`. La alternativa —colgarlos del
adaptador que más se les parece— se descarta porque `id` no es una etiqueta de
interfaz: es la clave de `sondeos`, de `gasto`, de `descargas` y de
`Ficha.fuentes_por_quadkey`. Fundir dos caminos bajo un `id` hace que el
manifiesto publicado ya no pueda decir de dónde salió una foto, y que apagar el
camino caro obligue a apagar también el barato.

`monumentos` no se renombra pese a que el nombre miente sobre lo que hace: el
`id` ya está escrito en fichas publicadas y en la tabla `sondeos` de todo el
que use el Indexer. Se corrige el **nombre visible** y la documentación del
módulo, no el identificador.

### 3.2 Coordenada: de la cámara o del sujeto, nunca mezcladas

El 7b ya distingue estos dos casos y hay que respetarlo:

- **De la cámara** (`commons`, `mapillary`, `kartaview`, `panoramax`,
  `geograph`, `inaturalist`): el fichero trae su propia geoetiqueta.
- **Del sujeto** (`monumentos`, `wikipedia`): la foto no está geoetiquetada; lo
  que está localizado es *aquello que retrata*. Se guarda la coordenada de la
  entidad, y el comentario de `monumentos.rs:362` explica por qué esa asimetría
  merece un `id` distinto.

`wms-orto` no es ninguna de las dos: es `Tipo::Cenital`, como `mapbox-satelite`.

### 3.3 Precisión declarada

`Reglas::por_defecto()` descarta por encima de `precision_maxima_m: 100.0`.
Todo origen que **publique** una precisión debe rellenar
`Candidata.precision_metros` con ella en vez de `None`. Es lo que recorta
iNaturalist de 59 a 34, y es correcto: una observación con ±293 m no localiza
nada.

`None` sigue significando «no lo dijo», que no descarta.

### 3.4 Los metadatos que no usamos no pueden tumbar los que sí

Regla nueva, escrita en sangre por `dd5da1e`: un adaptador **nunca** declara
`Option<String>` para un campo de proveedor que no lee. Se usa
`serde_json::Value` con un accesor, o `#[serde(default)]` sobre un tipo
tolerante. Cada uno de los seis adaptadores nuevos incluye un test que le mete
un tipo inesperado en un campo no usado y comprueba que la respuesta sigue
deserializando.

### 3.5 Ritmo

Todos con `Ctx::nuevo(None, stage, req_s, conc)`, conservadores por defecto y
declarados también en `indexer/src/lib/origenes.ts::LIMITES`:

| id | req/s | a la vez | por qué |
|---|---|---|---|
| `wikipedia` | 2 | 1 | misma infraestructura donada que Commons |
| `wms-orto` | 2 | 1 | servicios públicos nacionales, no CDN |
| `inaturalist` | 1 | 1 | su política pide ≤1 req/s sostenido |
| `geograph` | 2 | 1 | proyecto voluntario, servidor pequeño |
| `openaerialmap` | 4 | 2 | API sobre S3, aguanta más |

## 4. Origen por origen

### 4.1 `wikipedia` — imágenes de artículos geolocalizados

**Qué resuelve.** Sitios que tienen artículo pero cuyas fotos no están
geoetiquetadas en Commons. Es el complemento exacto de `commons`, que solo ve
la geoetiqueta por fichero.

**Sondeo.** Una petición, igual de barata que el `contar()` de Commons:

```
GET https://es.wikipedia.org/w/api.php
  ?action=query&format=json&formatversion=2
  &generator=geosearch&ggsbbox=N|O|S|E&ggslimit=500&ggsnamespace=0
  &prop=coordinates|pageimages&piprop=original&colimit=500
```

Se cuenta el número de artículos **con imagen principal**, no el de artículos.
Un artículo sin foto no es disponibilidad.

**Descarga.** Dos niveles, en este orden:

1. `pageimages` → la imagen principal del artículo. Una por artículo, casi
   siempre representativa.
2. `prop=images&imlimit=500` → todas las imágenes enlazadas. Aquí está el
   volumen (475 en 20 artículos) **y aquí está el ruido**: escudos, banderas,
   mapas de situación, iconos de plantilla, retratos.

El nivel 2 pasa por un filtro de títulos **antes** de gastar una petición de
`imageinfo`, con la misma forma de lista corta que
`monumentos::PREFIJOS_SUBCAT_VISTA` y el mismo `// ponytail:` reconociendo el
techo. Se descartan por subcadena en el título: `flag`, `bandera`, `escudo`,
`coat of arms`, `logo`, `icon`, `map`, `mapa`, `location`, `locator`, `.svg`,
`.png` (una foto de un sitio es JPEG; un diagrama no).

Después, lo que sobreviva pasa por `imageinfo` por lotes de 50 —
`monumentos::imageinfo_por_lotes` ya lo hace y se **extrae a `commons.rs`**
para que los tres lo compartan— y por `Reglas::por_defecto()`.

**Coordenada.** La del artículo (`prop=coordinates`). Sujeto, no cámara.

**Idioma.** `es.wikipedia` y `en.wikipedia`, en ese orden, deduplicando por
título de fichero en Commons. Dos idiomas cubren casi todo sin convertir esto
en un rastreador de 300 wikis. `// ponytail:` con la salida (una lista de
idiomas en `registros/`) escrita en el código.

**Atribución.** El fichero vive en Commons: misma `Atribucion` que
`commons.rs`, con `Artist` y `LicenseShortName` de `extmetadata`.

**Riesgo conocido.** Un artículo de una ciudad enlaza fotos de toda la ciudad,
no de su coordenada. Mitigación: **solo se aceptan artículos cuyo
`prop=coordinates` esté dentro de la tesela**, y el nivel 2 se limita a
artículos que no sean de entidades administrativas — detectable por el propio
`geosearch`, cuyos resultados para un municipio caen en el centroide. Si esto
resulta insuficiente en la verificación manual, el nivel 2 se apaga y el origen
se queda solo con `pageimages`, que ya son 45 fotos limpias por tesela urbana.

### 4.2 `monumentos` — cerrar el hueco de `P18`

**Cambio 1: usar `P18`.** `Monumento.categoria: Option<String>` gana un hermano
`imagen: Option<String>` (el título del fichero de `P18`). Hoy
`descargar()` hace `let Some(categoria) = ... else { continue }` y tira el
item entero; pasa a acumular títulos de las dos fuentes:

```rust
let mut titulos = Vec::new();
if let Some(c) = &m.categoria { titulos.extend(self.titulos_de_monumento(c).await?); }
if let Some(i) = &m.imagen { titulos.push(i.clone()); }
titulos.sort(); titulos.dedup();   // P18 casi siempre está también en P373
```

El `dedup` importa: la imagen principal suele estar además en la categoría, y
sin él se bajaría dos veces con dos `pageid` iguales.

`sondear()` cuenta igual: `+1` por item con `P18`, más los miembros de la
categoría si la hay.

**Cambio 2: aflojar `PREFIJOS_SUBCAT_VISTA`.** Cinco prefijos y un solo nivel
es demasiado estrecho para lo que ahora sabemos que hay detrás. Se añaden
`exteriors`, `outside`, `panorama`, `street view of`, `general views`,
`vista general`, `edificio`, `building`. Sigue siendo lista corta con su
`// ponytail:`: la salida sigue siendo la revisión por excepción, no una lista
infinita.

**Cambio 3: nombre visible.** `NOMBRES["monumentos"] = "Wikidata → Commons"`.
El `id` no se toca (§3.1). El doc-comment del módulo deja de decir
«monumentos» y dice lo que hace.

### 4.3 `wms-orto` — ortofoto nacional, gratis

**Qué resuelve.** Sustituye a `mapbox-satelite` (de pago) allí donde un
servicio nacional publique ortofoto abierta. Para España, PNOA del IGN a
≈0,44 m/px sobre una tesela z14 — mejor que lo que hoy se paga.

**Tabla de servicios, no código.** `registros/geo/orto-wms.json`, mismo
patrón que el resto de `registros/`: datos, no código, y **el adaptador
degrada a «no hay» cuando el fichero no está**, igual que hacen los datasets
de `registros/geo/`.

```json
{
  "servicios": [
    {
      "id": "pnoa-es",
      "nombre": "PNOA (IGN, España)",
      "url": "https://www.ign.es/wms-inspire/pnoa-ma",
      "capa": "OI.OrthoimageCoverage",
      "formato": "image/jpeg",
      "crs": "CRS:84",
      "version": "1.3.0",
      "licencia": "CC BY 4.0 (IGN, NOTA-A)",
      "atribucion": "Instituto Geográfico Nacional de España",
      "cobertura": [[-9.5, 35.9], [4.4, 43.9]]
    }
  ]
}
```

**Selección.** Se elige el primer servicio cuyo `cobertura` (bbox
`[[oeste,sur],[este,norte]]`) contenga el centro de la tesela. Sin coincidencia,
`Disponibilidad::Muestreo { nivel: Nada, estimadas: 0 }` y ni una petición.

**Sondeo.** Cero peticiones de red: la disponibilidad de una ortofoto es
geométrica, se sabe de la tabla. Devuelve `1` cuando hay servicio. Es
exactamente lo mismo que hace `mapbox-satelite`, y por eso `AvailabilityPanel`
ya lo pinta como `"global"` en vez de como muestreo (`tipo === "cenital"`).

**Descarga.** Un `GetMap` por tesela:

```
GET {url}?service=WMS&version=1.3.0&request=GetMap
  &layers={capa}&crs=CRS:84&bbox={O},{S},{E},{N}
  &width=4096&height=4096&format=image/jpeg
```

Verificado: 4,3 MB de JPEG válido. `Ctx::bajar_imagen` ya comprueba que
decodifica.

**Ojo con el eje.** WMS 1.3.0 con `CRS:84` es `lon,lat`; con `EPSG:4326` sería
`lat,lon`. Es el mismo tipo de trampa que el `ggsbbox` de Commons y va
comentada igual de fuerte en el código. La tabla fija `crs` por servicio
precisamente porque no todos ofrecen `CRS:84`.

**`Tipo::Cenital`, `Redistribucion::Libre`** con la licencia del servicio, y
`Atribucion` con el `atribucion` de la tabla. PNOA exige cita; eso no es
opcional y por eso el campo es obligatorio en el JSON.

### 4.4 `inaturalist` — cobertura rural

**Qué resuelve.** Donde no llega ni Mapillary ni Commons: caminos, monte,
riberas. El encuadre es de organismo, pero el fondo —vegetación, geología,
cielo, suelo— es justo lo que los verificadores de clima y bioma del 5c usan.

**Sondeo y descarga.** Una sola forma de consulta:

```
GET https://api.inaturalist.org/v1/observations
  ?nelat=N&nelng=E&swlat=S&swlng=O
  &photos=true&license=cc-by,cc-by-sa,cc0&per_page=200&page=n
```

`license=` en la consulta filtra en el servidor: **`-ND` y `-NC` no llegan
siquiera**, que es más barato que descartarlos después. El sondeo lee
`total_results` de la primera página: una petición.

**Dos reglas propias, no negociables.**

1. **`obscured == true` o `geoprivacy != null` → fuera.** iNaturalist
   aleatoriza la coordenada de las especies amenazadas dentro de una caja de
   ~25 km. Una foto así no es un dato de geolocalización, es ruido con
   apariencia de dato, y además usarla contra la intención del proyecto sería
   un abuso de una fuente donada.
2. **`positional_accuracy` → `Candidata.precision_metros`.** Es lo que aplica
   el corte de 100 m ya existente. Medido: de 59 observaciones, 34 pasan.

**Foto.** La URL viene como `.../square.jpg`; se sustituye el sufijo por
`original.jpg`. La licencia por foto es `photos[].license_code`, que **puede
diferir** de la de la observación — se usa la de la foto.

**Coordenada.** `location: "lat,lng"`, de la cámara.

### 4.5 `geograph` — Reino Unido e Irlanda

**Qué resuelve.** ~7 M de fotos CC BY-SA con una foto por cuadrícula de 1 km,
tomadas a propósito para documentar el territorio. Es la mejor cobertura rural
que existe de las islas y no la cubre ninguna otra fuente de la lista.

**API.** `syndicator.php` responde JSON sin clave (verificado):

```
GET https://api.geograph.org.uk/syndicator.php
  ?key=&format=JSON&q=&lat={lat}&lon={lng}&distance={km}&perpage=100
```

Cada item trae `title`, `author`, `lat`, `long`, `licence`, `thumb`, `link`,
`imageTaken`. `distance` se calcula con `centro_y_radio_km`, que ya existe en
`monumentos.rs` y **se sube a `origins/mod.rs`** para compartirla.

**Recorte por tesela.** `distance` es un radio, así que devuelve de más: se
descarta todo item cuyo `lat`/`long` caiga fuera del bbox exacto de la tesela.

**`thumb` no vale.** Es una miniatura pequeña; hay que resolver la imagen
grande desde `link`. Si eso obliga a una petición HTML por foto, **el origen se
queda con lo que dé `thumb` y se marca el techo con `// ponytail:`** — una foto
de 640 px pasa el `lado_minimo` justo, y 7 M de fotos a 640 px valen más que
cero fotos a 1024.

**Fuera del área, cero peticiones.** Igual que `wms-orto`: si el centro de la
tesela no cae en el bbox de las islas, `Nivel::Nada` sin salir a la red.

**Licencia.** El campo `licence` por item. Geograph es CC BY-SA casi
íntegramente, pero se lee el campo, no se asume.

### 4.6 `openaerialmap` — aérea abierta

**Qué resuelve.** Aérea libre de alta resolución donde la haya. Medido: 0 en
León, 20 en Dar es Salaam con `gsd` de 2,1 cm.

**API.** `GET https://api.openaerialmap.org/meta?bbox={O},{S},{E},{N}&limit=100`.
Devuelve `meta.found` (sondeo: una petición) y `results[]` con `uuid`,
`bbox`, `gsd`, `footprint`, `properties`.

**Descarga.** Se elige **la imagen de menor `gsd` que cubra la tesela** y se
recorta a la tesela, no se bajan las 20. Una tesela no necesita veinte
ortofotos del mismo sitio; necesita la mejor.

**Licencia.** El `license` de nivel superior viene `null`; está en
`properties`. Sin licencia legible → **no se descarga**. Un origen abierto sin
licencia declarada no es publicable, y `Redistribucion::Libre` mentiría.

**Prioridad.** Última fase. Es el único de los seis que puede quedarse fuera
sin que el resultado se resienta.

## 5. El séptimo: un origen que falla no es un cero

Esto no es un origen, es la razón por la que el bug de Commons vivió meses sin
que nadie lo viera, y con seis APIs nuevas —seis formas nuevas de fallar— es lo
que impide que vuelva a pasar.

Hoy, `probe.rs:127`:

```rust
let Ok(d) = o.sondear(&qk).await else {
    log::warn!("{} no pudo sondear {qk}", o.id());
    sondeo.empujar(SondeoTesela { nivel: "nada".into(), estimadas: 0, .. });
```

Un fallo se pinta idéntico a un cero real. Y `estimar()` hace lo mismo en su
`Err(_) => 0`.

**Cambio.** `SondeoTesela` gana un campo:

```rust
/// El motivo por el que este sondeo no pudo preguntar. `None` es «preguntó
/// y esto es lo que hay»; `Some` es «no lo sabemos», que NO es cero.
pub error: Option<String>,
```

- `probe.rs` lo rellena con el `Display` del error en vez de fingir `"nada"`.
  Se sigue sin cachear: un fallo no puede heredarse 30 días.
- `estimar()` propaga lo mismo a `LineaPrevista` para que la tabla de coste no
  presente un cero inventado como si fuera un dato.
- `AvailabilityPanel` pinta el origen en `warning-fg` con el motivo en el
  `title`, y el mapa deja la tesela **sin sombrear** en vez de sombrearla como
  «no hay». Sin iconos dentro de cajas de color y sin verde: es texto ámbar
  sobre el mismo `surface`, como el aviso que el panel ya tiene abajo.
- El botón dice «Sondear de nuevo lo que falló» cuando hay errores, en vez de
  «Volver a sondear».

## 6. Cambios por fichero

**Rust — nuevos**
- `indexer/src-tauri/src/origins/wikipedia.rs`
- `indexer/src-tauri/src/origins/wms_orto.rs`
- `indexer/src-tauri/src/origins/inaturalist.rs`
- `indexer/src-tauri/src/origins/geograph.rs`
- `indexer/src-tauri/src/origins/openaerialmap.rs`
- `registros/geo/orto-wms.json` + su entrada en el LEEME de `registros/geo/`

**Rust — tocados**
- `origins/mod.rs`: cinco `pub mod`, cinco altas en `registro()` (ninguno pide
  clave), y sube `centro_y_radio_km` desde `monumentos.rs`.
- `origins/commons.rs`: recibe `imageinfo_por_lotes` desde `monumentos.rs` como
  `pub(crate)`, para que `wikipedia` y `monumentos` lo compartan.
- `origins/monumentos.rs`: `P18`, `dedup`, prefijos, doc-comment (§4.2).
- `probe.rs`: `SondeoTesela.error`, y `estimar()` deja de convertir `Err` en 0.

**Frontend**
- `indexer/src/lib/origenes.ts`: los cinco nuevos en `PALETA`, `NOMBRES`,
  `LIMITES`, `ORDEN` y `SIN_CLAVE` — **y también `monumentos` y `panoramax`,
  que hoy faltan y caen al gris por defecto**. Colores nuevos dentro de la
  rampa existente, sin verde (`#4ec9a5` de Mapillary es el único cercano y ya
  está tomado).
- `indexer/src/territory/AvailabilityPanel.tsx`: estado de error (§5).
- `indexer/src/territory/MapCanvas.tsx`: tesela sin sombrear cuando hay error.

## 7. Fases

Cada fase es un commit y deja la aplicación funcionando.

1. **Estado de error del sondeo** (§5). Va primero a propósito: es el
   instrumento con el que se verifican las cinco fases siguientes. Sin él, un
   origen nuevo que falle se ve exactamente igual que uno que funciona y no
   encuentra nada.
2. **`monumentos`: `P18` y prefijos** (§4.2). El cambio más pequeño y sobre
   código ya probado.
3. **`wikipedia`** (§4.1). El de más volumen; se extrae `imageinfo_por_lotes` a
   `commons.rs` en este paso.
4. **`wms-orto`** (§4.3). Independiente de todo lo anterior: no toca Commons ni
   MediaWiki.
5. **`inaturalist`** y **`geograph`** (§4.4, §4.5). Juntos: los dos son «una
   API JSON con bbox, filtro y atribución por item», misma forma.
6. **`openaerialmap`** (§4.6). Puede caerse sin consecuencias.

## 8. Fuera de alcance

- **Bing Streetside, Yandex Panoramas, Baidu y Tencent.** No tienen API pública
  y sus términos prohíben expresamente este uso. No se implementan, y no por
  dificultad técnica.
- **Flickr.** Ya está en el registro; su API exige cuenta Pro desde 2025. No se
  toca en este spec — la decisión de pagarla o retirar el adaptador es del
  operador, no de este trabajo.
- **Openverse.** Sin filtro geográfico, solo por topónimo. No encaja en un
  contrato por tesela.
- **Sentinel-2 / Copernicus.** 10 m/px: sirve para contexto de vegetación, no
  para emparejar una fotografía. Si alguna vez hace falta, es un origen de
  *señal*, no de imagen, y eso es otro contrato.
- **Recursión de categorías de Commons más allá de un nivel.** Sigue siendo la
  decisión del 7b y sigue vigente por la misma razón: arrastra vidrieras,
  planos y grabados que el verificador geométrico no puede emparejar.
- **Fechas de captura** (5d). Varios de estos orígenes las traen
  (`imageTaken` de Geograph, `observed_on` de iNaturalist); se guardan en
  `Captura.capturada_en` porque el campo existe, pero explotarlas es el 5d.

## 9. Verificación manual

Sin suite automática (convención del repo). Lo que hay que comprobar a mano,
en este orden:

1. **Tesela urbana española** (`03133320022212`, centro de León): los nueve
   orígenes sin clave —`kartaview`, `commons`, `monumentos`, `panoramax` y los
   cinco nuevos— aparecen en la estimación con número propio; `wikipedia`
   ≥ 45; `wms-orto` dice `global`; `geograph` y `openaerialmap` dicen 0 **sin
   haber hecho ninguna petición** (comprobable en el log).
2. **Tesela británica** (cualquiera sobre Londres): `geograph` da centenares y
   `wms-orto` vuelve a 0 por falta de servicio en la tabla.
3. **Tesela rural**: `inaturalist` sube y `mapillary` baja. Es la comprobación
   de que el origen aporta donde se dijo que aportaría.
4. **Con la red caída a media faena**: los orígenes que fallen se pintan en
   ámbar con motivo, no como «no hay», y volver a sondear los reintenta sin
   arrastrar el fallo desde la caché.
5. **Descarga de una tesela y sellado**: `filas/` y los fragmentos cuadran, y
   cada `Atribucion` tiene autor y licencia reales — en particular la del IGN,
   que es obligatoria.
6. **Borrar `registros/geo/orto-wms.json`**: `wms-orto` degrada a 0 en vez de
   reventar, igual que los datasets de `registros/geo/`.
