# Rendimiento del Indexer: arranque, descarga, recursos y revisión

> Estado: borrador para revisión · 2026-09-13 · subsistemas 7a/7b
> Precede: `03436a5` (el tope de 2 GiB por asset), `d81bfc2` (sellar bloqueaba la app)

## 0. Método, y una corrección

Todo número de este documento está **medido** contra la instalación real del
operador —`indexer.db` de 34 MB, 52.090 imágenes, 258.697 vectores, 19,09 GB de
fotos, 9,0 GB de almacenamiento de Qdrant— o contra un banco reproducible con el
esquema real. Donde una sospecha razonable no aguantó la medición, queda escrita
como descartada (§8): son trabajo que este spec **no** debe encargar.

Tres hipótesis mías cayeron durante la investigación y conviene decirlo antes de
que alguien las reintroduzca:

1. *«El sondeo ocioso de la cola machaca la base de datos»* — falso.
   `indices_con_pendientes` tarda **0,01 ms**: el índice parcial
   `vectores_pendientes` hace exactamente su trabajo.
2. *«La rejilla de revisión se trae miles de filas»* — falso. `revision_pendientes`
   ya está topado a 120.
3. *«Hay colecciones de Qdrant creadas y nunca usadas»* — falso. Las nueve tienen
   datos reales.

Y una corrección de lectura que cambia el diagnóstico entero de §5: el proceso
Qdrant que escucha en 6333 **no es del Indexer**, es el de `lumid`. El del
Indexer escucha en 6633. No hay procesos duplicados compitiendo.

## 1. Objetivo y criterio de aceptación

Cuatro quejas concretas del operador: tarda en abrir, indexa lento, se come la
máquina, y la experiencia es peor de lo que debería. Este spec las ataca sin
romper tres invariantes que el 7b ya pagó caros:

1. **Ningún cambio puede aumentar el ritmo de peticiones que ve un proveedor.**
   Los 429 de Wikimedia costaron un sondeo entero en ámbar y dos días de
   diagnóstico. La regla es más fuerte que «ir rápido».
2. **Nada se descarga sin pasar por el presupuesto**, y lo apuntado sigue siendo
   lo servido, no lo previsto.
3. **Una descarga cortada se retoma sin pagar dos veces.** La unidad de trabajo
   sigue siendo tesela × origen, anotada al completarse.

Aceptación, medible sobre el índice 5 (26.739 imágenes, 7 orígenes):

| | hoy | objetivo |
|---|---|---|
| JS que se parsea antes del primer píxel | 2.320 kB | < 600 kB |
| entrar a Proyectos con Qdrant frío | bloqueado hasta 5 min | inmediato |
| suelo de descarga por limitador | 83,4 min | ≤ 41 min con el interruptor activado |
| coste del sondeo de progreso | 343,7 ms cada 1200 ms | < 5 ms |
| RSS de Qdrant en reposo | 9,9 GB | < 1,5 GB |

## 2. Arranque

### 2.1 El bundle es un solo trozo

`vite build` produce **un chunk de 2.320 kB**, del cual **1.858 kB (80 %) son
`mapbox-gl`**. `App.tsx` importa las 40 pantallas de forma estática, así que el
WebView parsea el mapa entero antes de poder pintar `Booting` — en una pantalla
que no tiene mapa.

Mapbox solo hace falta en tres sitios: `territory/MapCanvas`,
`download/DownloadMap` y `catalog/{CoverageMap,IndexMapDialog}`.

**Decisión.** `React.lazy()` + `Suspense` en esas rutas, con el *fallback* ya
existente del vocabulario visual (no una tarjeta nueva). Nada más: no se toca el
resto de imports, no se añade un gestor de rutas, no se reorganiza `App.tsx`.

`@turf/*` (728 kB en disco, mucho menos tras *tree-shaking*) viaja con
`TerritoryView` y cae en el mismo trozo diferido sin trabajo extra.

### 2.2 El portón de servicios bloquea toda la aplicación

`ServicesBoot` no deja entrar hasta que Redis **y** Qdrant responden, con
`TOPE_SONDEOS = 375` (≈ 5 min) y varios `wsl.exe` por arranque — cada uno
**1,34 s medidos en caliente**.

Pero los dos servicios los necesita **solo la cola de embebido**. Revisar
imágenes, mirar el catálogo, dibujar territorio, descargar y publicar no los
tocan. Hoy el operador espera por infraestructura que la pantalla a la que va no
va a usar.

**Decisión.** El arranque de servicios deja de ser un portón y pasa a ser una
tarea de fondo:

- `App` entra en cuanto `saludo` y `setupCompleto` resuelven.
- Los servicios se levantan detrás, y su estado se publica como un indicador en
  el carril, con el mismo vocabulario del punto naranja que ya usan «Descarga» y
  «Embebido».
- **Solo la pantalla de embebido** exige servicios vivos. Si no lo están,
  enseña el estado real y el log —lo que hoy es `LogBox`— en vez de un diálogo
  modal de fallo.
- `ServicesFailDialog` deja de ser modal a la entrada; su contenido se conserva,
  reubicado.

Esto es también lo que hace que §5 sea seguro: si Qdrant tarda, ya no cuesta la
sesión entera.

## 3. Descarga en paralelo (interruptor)

### 3.1 La asimetría

El **sondeo ya es concurrente**: `probe.rs:113` lanza un `JoinSet` sobre
orígenes × teselas. La **descarga no lo es en ningún nivel**:

```rust
// download.rs:199
for o in origenes {
    ...
    self.un_origen(o, teselas).await;   // KartaView espera a que Mapillary acabe entero
}
```

Medido sobre el índice 5, con los límites reales de cada adaptador:

| origen | imágenes | límite | suelo |
|---|---|---|---|
| mapillary | 19.419 | 8 req/s | 40,5 min |
| kartaview | 4.332 | 4 req/s | 18,1 min |
| monumentos | 1.882 | 2 req/s | 15,7 min |
| commons | 911 | 2 req/s | 7,6 min |
| panoramax + wikipedia + wms-orto | 195 | 2 req/s | 1,6 min |
| **en serie (hoy)** | | | **83,4 min** |
| **en paralelo** | | | **40,5 min** |

**2,1×, sin pedirle ni una petición más a nadie.**

### 3.2 Por qué es seguro por construcción

Esta es la parte que decide el diseño. Cada `Origen` tiene su propio `Ctx`, y
cada `Ctx` su propio `Limitador`. Correr Mapillary y KartaView a la vez **no
aumenta el ritmo que ve ninguno de los dos**: son hosts distintos con
limitadores independientes.

Y donde sí comparten infraestructura, ya está resuelto: `commons`, `wikipedia` y
`monumentos` pasan por `limitador_wikimedia()` —1 req/s global—, así que se
seguirán serializando **entre ellos** aunque el bucle los lance a la vez. La
corrección de los 429 no se pierde; el paralelismo la respeta sin saber que
existe. Lo mismo `calles::limitador_overpass` para Google y KartaView.

Dicho de otro modo: el invariante 1 de §1 no se viola porque **el paralelismo es
entre orígenes, y los limitadores son por proveedor**.

### 3.3 El interruptor

Pedido explícitamente por el operador, y correcto aunque §3.2 lo haga seguro: un
cambio que multiplica la carga de red simultánea debe poder apagarse sin
recompilar, y una descarga larga y cara no es donde se descubre una regresión.

- **Dónde**: Ajustes → Rendimiento (`RendimientoPanel`), junto a la concurrencia
  de GPU y el modo de baja prioridad, que es donde ya vive este vocabulario.
- **Cómo se guarda**: clave `descarga_paralela` en la tabla `ajustes`, igual que
  `concurrencia_gpu`. No es un secreto y no necesita cifrado.
- **Por defecto**: **activado**. §3.2 demuestra que no aumenta la carga por
  proveedor, y dejarlo apagado por defecto regalaría el 2,1× a quien no sepa que
  el interruptor existe. El interruptor está para **poder apagarlo** cuando un
  proveedor se porte mal, no para tener que encenderlo.
- **Qué controla exactamente**: cuántos orígenes avanzan a la vez.
  `false` → 1 (el comportamiento de hoy, byte por byte). `true` → todos los del
  plan, cada uno contra su propio limitador.
- **Se lee al arrancar la descarga, no en cada tesela.** Cambiarlo a mitad no
  reconfigura una descarga en curso: eso obligaría a razonar sobre un plan que
  muta, y no compra nada.

Implementación: `correr()` sustituye el `for` secuencial por un `JoinSet` —el
mismo patrón que `probe.rs` ya usa, no uno nuevo—. `Descarga` pasa a
`Arc<Descarga>` y `un_origen` toma `&self`; `progreso` ya está tras un `Mutex`,
así que la acumulación no cambia.

Lo que **no** cambia: el orden dentro de un origen sigue siendo secuencial por
tesela, la anotación sigue siendo al completar, y el presupuesto sigue siendo un
`Presupuesto` compartido. Un plan que se queda sin saldo corta igual.

### 3.4 La cola de bytes, que es el techo de verdad

`bajar_imagen` pide permiso **al mismo limitador que las consultas a la API**
(`origins/mod.rs:248`). Bajar bytes de un CDN se cobra contra la cuota de la
Graph API. Esos 40,5 min de Mapillary son casi todos bytes de
`scontent.xx.fbcdn.net`, no llamadas a `graph.mapillary.com`.

**Decisión.** `Ctx` gana un segundo limitador, `bytes`, y `bajar_imagen` lo usa
en vez de `limitador`. Su valor lo declara **cada adaptador**, no una constante
global, porque la respuesta es distinta por proveedor:

| origen | CDN separado de la API | cola de bytes |
|---|---|---|
| mapillary | sí (`scontent.*.fbcdn.net`) | 16 req/s, 8 a la vez |
| kartaview | sí (`storage*.openstreetcam.org`) | 8 req/s, 4 a la vez |
| flickr, panoramax, openaerialmap | sí | 8 req/s, 4 a la vez |
| **commons, wikipedia, monumentos** | **no** — `upload.wikimedia.org` cae bajo la misma política | **el limitador compartido, sin cambios** |
| google, mapbox | de pago, por petición | sin cambios |

Wikimedia no se toca. Es el proveedor que ya nos enseñó el coste de equivocarse
aquí, y su política cubre `upload.wikimedia.org` igual que la API.

### 3.5 Dos defectos en el mismo bucle

**Bloqueo dentro de `async`.** `origins/mod.rs:255-257` hace `fs::write` y
`image::image_dimensions` —disco y decodificación— dentro de un `async fn`. Es
el mismo fallo de Tokio que `d81bfc2` arregló en `sellar()`, y como Tauri enruta
todo el IPC por ese runtime, es parte de por qué la interfaz se atasca mientras
se baja. Va a `spawn_blocking`.

**Una transacción por imagen.** `insertar_imagen_de_red` hace un `INSERT` a la
imagen y uno por modelo, cada uno en su propio *autocommit*. Medido con el
esquema real, una tesela densa (2.910 imágenes × 6 modelos):

```
autocommit (como hoy)     1426 ms   (490 µs/imagen)
una transacción              55 ms   ( 19 µs/imagen)
```

26×. En absoluto no es mucho frente a 40 minutos de red — **pero ese 1,4 s se
pasa reteniendo el mutex global de SQLite**, que es justo lo que §4 ataca. Se
inserta la tesela entera en una transacción.

## 4. El sondeo de progreso le roba la base de datos al indexador

`Almacen(Mutex<Connection>)` es **una sola conexión para toda la aplicación**.
Con WAL, SQLite admite lectores concurrentes junto a un escritor; ese mutex tira
esa propiedad. Los 23 `setInterval` del frontend, el bucle de descarga y los 8
bucles de cola se serializan en un candado.

Y hay un consumidor que lo acapara. `indice_progreso_embebido` recorre **los 8
modelos registrados** (`cargar_registro` no filtra) haciendo dos `COUNT(*)` con
`JOIN` cada uno, sondeado cada 1200 ms desde `EmbedView` y cada 1500 ms desde
`IndexDetail`:

| índice | una llamada | % de un núcleo, y del mutex |
|---|---|---|
| 5 (26.739 img) | **343,7 ms** | **28,6 %** |
| 3 (13.781 img) | 176,8 ms | 14,7 % |
| 4 (10.346 img) | 105,4 ms | 8,8 % |

Es O(imágenes del índice) recalculado desde cero en cada tick. **No es solo un
coste de hoy: es un precipicio.** A 100k imágenes la consulta pasa de 1,2 s —más
que el intervalo—, los sondeos se encolan y el mutex queda tomado prácticamente
el 100 % del tiempo. El síntoma sería «la app se congela al indexar mucho», que
es exactamente la clase de fallo que este repo ya ha perseguido tres veces.

**Decisión, en dos partes independientes.**

**4.1 Que la cuenta no se recalcule.** `hechas`/`total` por (índice, modelo)
pasan a una tabla `progreso_embebido` mantenida incrementalmente: el mismo sitio
que ya marca un vector como `hecho` suma uno. El sondeo pasa a ser un `SELECT`
por clave primaria. Se recalcula desde cero solo en tres puntos —al crear un
índice, al cancelar un lote y al rechazar en revisión—, que son raros y ya
tocan esas filas.

Se descarta la alternativa «cachear el resultado 5 s»: mueve el problema en vez
de quitarlo, y al crecer el índice vuelve.

**4.2 Que leer no bloquee escribir.** `Almacen` pasa de `Mutex<Connection>` a un
grupo pequeño de conexiones de solo lectura más la conexión de escritura actual.
Con WAL esto es correcto sin más ceremonia. `reabrir_en` (migración de carpeta,
#55) tiene que cerrar todas, no una — es el único punto delicado y hay que
tratarlo explícitamente.

**Además**: `PRAGMA cache_size` y `temp_store = MEMORY` en `conectar()`. El
*caché* por defecto son 2 MB para una base de 34 MB. Es una línea.

Y un defecto menor del mismo bucle: `un_origen` ordena las teselas con
`sort_by_key`, que **no** cachea la clave, así que llama a `sondeo_leer` —una
consulta— O(n log n) veces. A 200 teselas son 0,02 s: nota al pie, no titular.
`sort_by_cached_key` lo arregla en un carácter y se hace de paso.

## 5. Qdrant y Redis

Aquí la investigación encontró algo que ningún cambio de código arregla.

### 5.1 Redis no es el problema

Medido arrancándolo exactamente como lo lanza la app: **350 ms hasta el primer
`PONG`, 12 MB de RSS**, AOF de 12 KB. Está instalado (`/usr/bin/redis-server`,
7.0.15). No hay nada que optimizar. La pantalla dice «levantando Redis y
Qdrant…» y **Redis no tiene culpa de la espera**.

### 5.2 Qdrant está configurado para tenerlo todo en RAM

`qdrant.rs:47` crea cada colección así:

```json
{ "vectors": { "size": dims, "distance": "Cosine" },
  "quantization_config": { "binary": { "always_ram": true } } }
```

Lo que falta importa más que lo que hay. Leído de la instalación real:

```
vectors.on_disk        : sin poner  → false
hnsw_config.on_disk    : false
optimizer memmap_threshold : None
```

Nada se mapea en memoria: los vectores en precisión completa (12288-d × 4 B) y
el grafo HNSW **se cargan enteros**. Nueve colecciones, 292.000 puntos, **9,0 GB
en disco y 9,9 GB de RSS**. Coinciden porque es literalmente todo el
almacenamiento.

Y la cuantización binaria —que ya está puesta y es lo que sirve la búsqueda—
ocupa ~32× menos: del orden de 400 MB. Es decir, **ya se paga lo caro sin
aprovechar lo barato**: se mantienen en RAM los originales que la cuantización
existe para no tener que consultar salvo al reordenar candidatos.

**Decisión.** La configuración canónica de Qdrant para este caso exacto:

```json
{ "vectors": { "size": dims, "distance": "Cosine", "on_disk": true },
  "hnsw_config": { "on_disk": true },
  "quantization_config": { "binary": { "always_ram": true } } }
```

Cuantizado en RAM (rápido), originales mapeados en disco (solo se tocan al
reordenar). Qdrant es 1.19.0 y admite las tres claves.

**Las colecciones existentes no se recrean.** Se parchean con `PATCH
/collections/{nombre}`, que Qdrant aplica en la siguiente optimización. Reindexar
292.000 vectores desde cero costaría horas de GPU que ya están pagadas. La
migración va detrás de un botón en Ajustes → Rendimiento con su aviso de que
Qdrant trabajará un rato de fondo: no se dispara sola al actualizar.

### 5.3 Los vectores están en un disco mecánico

Esta es la causa raíz, y es de instalación, no de código.

```
WSL Ubuntu VHDX : D:\WSL\Ubuntu\ext4.vhdx  (84,8 GB)
D:              : WDC WD10EZEX-00BBHA0  →  HDD, 931 GB
```

Los 9 GB de vectores viven en un **disco mecánico**, dentro de un VHDX, tras la
E/S virtualizada de WSL2. Medido dentro de WSL sobre un fichero real de Qdrant
(`matrix.dat`, 492 MB, escrito en agosto y hace mucho fuera de caché):

```
lectura de un fichero real de qdrant   :   8,6 MB/s
escritura de un fichero nuevo          : 159   MB/s
```

8,6 MB/s son lecturas dispersas en un plato girando. **A ese ritmo, cargar 9 GB
son ~17 minutos** — más que el tope de 5 minutos de `ServicesBoot`, que es por
qué ese tope existe y por qué aun así a veces no llega.

Lo que salva hoy los arranques en caliente es un accidente. El comentario de
`services.rs:231` afirma:

> *«Los dos quedan como procesos HIJOS del Indexer (nada de `--daemonize`), así
> que mueren con él y no se quedan huérfanos ocupando el puerto.»*

**Es falso cruzando la frontera de WSL.** Comprobado: con el Indexer **cerrado**
en Windows, su Qdrant llevaba **16.879 s (4,7 h) vivo**, reparentado bajo el
`SessionLeader` de WSL. Matar `wsl.exe` mata el relay, no el servicio. Que el
arranque siguiente sea rápido es porque `quien_vive()` lo adopta — no por diseño.

**Decisiones**, por orden de impacto:

1. **Mover el VHDX de WSL al SSD.** E: es un `CT240BX500SSD1` con 65 GB libres;
   el VHDX ocupa 84,8 GB pero está sobreaprovisionado (el contenido real cabe
   holgadamente tras compactar). Medido en escritura: **89 MB/s (D, HDD) contra
   331 MB/s (E, SSD)**, 3,7× — y en lecturas dispersas, que es lo que hace
   Qdrant al arrancar, la diferencia es mucho mayor porque el SSD no paga
   búsqueda de cabezal. *(C: queda descartada: 22 GB libres de 444, un 5 %, es
   justo la condición en la que NTFS se fragmenta y va lento.)*
   Esto **no es código**: es un procedimiento documentado (`wsl --export` /
   `--import`, o `Optimize-VHD`). Va a la guía de instalación, y el panel de
   Ajustes lo **detecta y avisa** —«tus vectores están en un disco mecánico»—
   en vez de dejar que el operador lo descubra por lentitud.
2. **§5.2 encima**: con `on_disk` los 9 GB dejan de leerse al arrancar; se
   paginan bajo demanda. Es lo que hace que incluso en HDD el arranque deje de
   ser un muro.
3. **§2.2 encima**: aunque tarde, ya no bloquea la aplicación.
4. **Adoptar a propósito, no por accidente.** `arrancar_wsl` ya intenta adoptar
   primero (`quien_vive`), que es lo correcto. Lo que se corrige es **el
   comentario mentiroso** y la consecuencia real: dejar dicho que los servicios
   sobreviven al cierre, y ofrecer en Ajustes un «parar servicios» explícito.
   Un huérfano que se adopta es una *función*; un huérfano que nadie sabe que
   existe es una fuga.
5. **Menos `wsl.exe`.** Cada invocación cuesta **1,34 s en caliente** y el
   arranque hace varias (`hay_en_wsl` ×2, arranque ×2, sondeos). Las
   comprobaciones de presencia se agrupan en un solo `sh -lc`. Ahorra unos 4 s;
   es lo más pequeño de esta sección y va al final por eso.

## 6. Miniaturas

Las fotos reales del operador: **media 533 KB, mediana 228 KB, p95 2,4 MB,
máxima 13 MB**, 34.966 ficheros, 19,09 GB. `ReviewGrid` apunta cada `<img>` al
**original a resolución completa** vía `convertFileSrc`. Un JPEG de 4000×3000 son
~48 MB de mapa de bits descomprimido en el WebView.

Virtualizar (`06eb7df`) acotó cuántos hay vivos a la vez, así que el desplome ya
no ocurre — **pero el coste por miniatura sigue siendo el de una foto entera**, y
el tope de 120 fichas de `revision_pendientes` es un parche con su propia deuda
anotada en el código: *«La paginación real llega si hace falta.»*

**Decisión.** Al bajar una imagen se escribe además una miniatura de lado largo
512 px junto a ella. `ReviewGrid` apunta a la miniatura; el original se abre solo
al ampliar. Con las miniaturas, el tope de 120 deja de ser necesario y la rejilla
puede pedir el lote entero.

Es un coste en el momento de bajar —una decodificación y un reescalado— que ya
se paga de todos modos: `bajar_imagen` **ya llama a `image_dimensions`** sobre
cada fichero para validar que decodifica. Se aprovecha esa pasada en vez de
añadir una.

Para las 34.966 ya bajadas: generación perezosa la primera vez que se pide, no
un trabajo de migración.

## 7. Orden

Las secciones son independientes salvo donde se dice. Por relación
impacto/riesgo:

| # | trabajo | riesgo |
|---|---|---|
| 1 | §5.3 punto 1 — mover WSL al SSD | ninguno en código; es del operador |
| 2 | §2.1 `lazy()` del mapa | bajo, puramente frontend |
| 3 | §5.2 `on_disk` + botón de migración | medio: toca datos, pero es reversible |
| 4 | §4.1 progreso incremental | medio: es una tabla nueva con tres puntos de recálculo |
| 5 | §3.1-3.3 paralelo entre orígenes + interruptor | bajo por §3.2, y apagable |
| 6 | §3.5 `spawn_blocking` + transacción por tesela | bajo |
| 7 | §2.2 desacoplar el portón de servicios | medio: toca el flujo de arranque entero |
| 8 | §3.4 cola de bytes por origen | **el más delicado**: es el único que cambia lo que ve un proveedor |
| 9 | §6 miniaturas | bajo |
| 10 | §4.2 conexiones de lectura | medio, y `reabrir_en` es el punto fino |
| 11 | §5.3 punto 5 — menos `wsl.exe` | bajo, ganancia pequeña |

§3.4 va el penúltimo a propósito: cuando llegue, todo lo demás ya estará medido y
estable, y si un proveedor responde mal se sabrá que la causa es ese cambio y no
otro.

## 8. Medido y descartado

No encargar trabajo sobre esto:

- **Sondeo ocioso de la cola**: `indices_con_pendientes` = **0,01 ms**. El índice
  parcial `vectores_pendientes` funciona.
- **El mapa**: usa fuentes GeoJSON compartidas con `setData`, no una capa por
  tesela. Está bien hecho.
- **`revision_pendientes`**: ya topado a 120; no trae 10.346 filas.
- **Colecciones de Qdrant vacías**: no hay; las nueve tienen datos.
- **Procesos Qdrant duplicados**: el de 6333 es de `lumid`, otro producto.
- **WAL y `synchronous = NORMAL`**: ya puestos y correctos.
- **Concurrencia de GPU y modo de baja prioridad**: ya existen y son
  configurables desde Ajustes.
- **Migraciones al abrir**: 18 `ALTER TABLE` que fallan, coste despreciable.
- **Redis**: 350 ms y 12 MB. No es el cuello de botella pese a nombrarse en la
  pantalla de espera.

## 9. Lo que este spec NO arregla

- **La tesela que no cabe en un release** (`03436a5`). Fuera del alcance de
  este spec; resuelto después por el suyo propio
  (`2026-09-14-cuerpo-multiparte-design.md`): el cuerpo cifrado se parte en
  varios ficheros físicos que el lado que instala reensambla.
- **La invalidación del caché de `sondeos` cuando cambia el código de un
  origen.** Sigue siendo limpieza manual de la base.
- **El tope de 8 modelos registrados.** Que `cargar_registro` no distinga
  «registrado» de «activo para este índice» es lo que hace que §4 recorra ocho.
  §4.1 hace que recorrerlos sea barato, que es suficiente; distinguir de verdad
  las dos cosas es una decisión de producto, no de rendimiento.
- **La velocidad del embebido en sí.** Depende de la GPU y del *worker* de
  Python; nada de aquí la toca.
