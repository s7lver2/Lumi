# Subsistema 7a — Lumi Indexer: cimientos, territorio y orígenes locales

Aplicación Tauri independiente cuyo único propósito es indexar territorio. Produce
**paquetes de índice** sellados que el subsistema 8 publicará y el 5 abrirá para buscar.

Maquetas: [`lumi-s7a-mockups.html`](lumi-s7a-mockups.html) (arranque, catálogo, ingesta,
sellado) y [`lumi-s7-territorio-mockups.html`](lumi-s7-territorio-mockups.html) (dibujar,
deduplicación, las dos procedencias).

---

## 1. Por qué el Indexer va antes que el motor

El subsistema 5 geolocaliza recuperando candidatos de un corpus georreferenciado y
verificándolos geométricamente. Sin índice no hay candidatos que verificar. Se consideró que
el 5 fijara el formato y trabajara contra un índice de juguete construido a mano, y se
descartó: el motor habría pasado su desarrollo entero contra material de mentira, y la
primera vez que viera un índice real sería después de darlo por terminado.

El coste asumido es el simétrico: el Indexer se diseña sin que su consumidor exista todavía,
y Lumi Station sigue sin resolver ni un análisis durante dos subsistemas más.

**Orden vigente:** `1 → 2 → 6 → 4 → 7a → 7b → 8 → 5 → 3 → 9`.

## 2. Alcance

**Dentro del 7a:**

- La aplicación Tauri, su almacén local y su propio runtime de Python.
- Las tres bases de datos y su aprovisionamiento.
- El formato del paquete de índice, troceado por tesela.
- La procedencia como concepto de primera clase, en sus dos sentidos.
- El mapa (Mapbox), dibujar el área, la descomposición en teselas y **la regla de no
  indexar nunca lo mismo dos veces**, contra los índices locales y contra los publicados.
- El fichero de cobertura que un índice publicado expone, y su lectura.
- Dos orígenes de ingesta: paquetes legacy cifrados de la v1 y carpetas locales.
- Embebido, sellado y apertura de paquetes.

**Fuera del 7a, en el 7b:** los tres orígenes de red — street view, satélite y fotos
públicas geoetiquetadas. Es donde viven las claves de API, las cuotas y el coste por
petición, y no hacen falta para que el 7a produzca software que funciona solo.

**Fuera del 7a, en el 8:** buscar, navegar, publicar e instalar con interfaz. El 7a define y
lee el fichero de cobertura porque lo necesita para no duplicar trabajo; no construye el
catálogo.

**No hay entrenamiento de modelos.** «Entrenar un índice» significa poblarlo con imágenes de
varias procedencias, no ajustar pesos. El Indexer construye índices, no modelos.

## 3. La aplicación

`indexer/`, hermana de `client/` en el mismo monorepo. Tauri v2 + React + Tailwind, con los
mismos tokens. **No se vincula a ningún servidor**: no hay cuentas, ni roles, ni
invitaciones, ni sesiones. Es una herramienta de un solo operador sobre su propia máquina.

Se reutiliza de lo ya construido:

- Los tokens de `DESIGN.md` valor por valor, el patrón de iconos SVG a mano, el
  `PlanetBackground`, el carril de 44 px del subsistema 6 y el vocabulario del wizard.
- **El runner de tareas del subsistema 1**, conceptualmente: instalar torch y descargar pesos
  es el mismo problema que ya se resolvió allí — log persistente en disco, reenganche por
  offset, y cerrar la ventana no aborta nada.

No se reutiliza `lumi-proto::worker`. El contrato del subsistema 4 es «una imagen, dame una
coordenada»; aquí es «este lote de imágenes, dame sus vectores». Forzar los dos por el mismo
`enum` produciría un tipo con la mitad de los campos siempre a `None`. Se escribe un contrato
propio con la misma disciplina: JSON por líneas sobre las tuberías de un proceso hijo,
`stderr` como log sin contrato, `-u` obligatorio en el intérprete, muerte con el padre, y
todo número validado antes de tocar el almacén.

### Linux primero

**Redis no publica binarios oficiales para Windows.** El proyecto lo mantiene para Linux y
macOS; en Windows la vía son terceros (Memurai) o WSL. `ARCHITECTURE.md` §7 ya establece que
Linux nativo es el camino primario para el servidor, y el Indexer se acoge a lo mismo: corre
nativo en Linux, y en Windows se instala dentro de WSL. Empaquetar Memurai metería una
dependencia de terceros con su propia licencia en un proyecto de código abierto.

La pantalla de aprovisionamiento dice esto en su sitio, no en un manual.

### La clave de Mapbox

El mapa usa Mapbox, el mismo proveedor que ya soporta el subsistema 6. La diferencia es que
aquí **no hay daemon que haga de proxy**: la clave la introduce el operador y vive en su
máquina, cifrada con la maestra local. Es aceptable porque es su clave, su equipo y su cuota
— a diferencia de Lumi Station, donde el motor `mapbox` reparte la clave del propietario a
todos los clientes y por eso lleva su aviso.

## 4. Las tres bases de datos

| Base | Qué guarda |
|---|---|
| **SQLite** | Catálogo de índices, imágenes con coordenadas y procedencia, lotes de ingesta, estado por imagen, cobertura por tesela, ajustes cifrados. Un fichero, WAL. |
| **Redis** | La cola de lotes, el progreso en vivo y los contadores de cobertura mientras se calculan. |
| **Qdrant** | Los vectores. Una colección por `(modelo, versión)`, HNSW con cuantización binaria y reescalado. |

Los dos servicios escuchan **solo en `127.0.0.1`**, con `protected-mode` activo. No se
exponen a la red bajo ninguna configuración.

**Redis es el timbre y el estado caliente; SQLite es la verdad.** Es la lección que la v1
dejó escrita sobre su propia cola: el estado durable de cada trabajo vive en su tabla, y la
cola solo avisa de que hay algo que hacer. Si Redis se vacía se pierde la barra de progreso y
nada más — la cola se reconstruye leyendo qué imágenes siguen sin vector.

Qdrant es la conclusión a la que llegó la v1 después de estrellarse: `pgvector` tiene un tope
duro de 2000 dimensiones para HNSW e ivfflat, MegaLoc son 8448 y Lumi 2 son 12288, así que la
v1 acabó haciendo escaneo coseno secuencial sobre la tabla entera.

## 5. El paquete de índice

Un directorio sellado. **Es el formato de transporte y de archivo; Qdrant es el almacén de
trabajo.** El Indexer escribe a Qdrant mientras indexa y sella un paquete al terminar; abrir
un paquete es importarlo a Qdrant. Un directorio de Qdrant es un formato atado a su versión,
no un formato de archivo.

```
madrid-centro-v1.lumidx/
  manifiesto.json          qué es, procedencias, porcentajes, versión de formato
  indice.db                SQLite: imágenes, coordenadas, quadkeys, lotes, procedencia
  cobertura.json           las teselas que este índice cubre, con el hash de su fragmento
  fragmentos/
    03113322013021/            un fragmento por tesela z14
      lumi-preview-1.0.b1      binario, 1 bit por dimensión — sobre lo que se busca
      lumi-preview-1.0.i8      int8 escalar — lo que reescala el binario
      lumi-2-1.0.b1            un par de ficheros por modelo que el índice traiga
      lumi-2-1.0.i8
      imagenes/                a la resolución que consume el verificador
    03113322013022/
    …
  extra/
    lumi-2-1.0.f32         float32 completo, opcional, para recuperación exacta
  SHA256SUMS
```

### Troceado por tesela y direccionado por contenido

**Una sola granularidad en todo el sistema: la tesela z14.** Es la unidad del fragmento, la
de la cobertura y la del porcentaje por territorio. Mezclar dos niveles de zoom obligaría a
traducir entre ellos en cada consulta y a explicar cuál manda en cada sitio.

Cada fragmento se nombra por su `sha256`. De esto cuelgan cuatro
propiedades que el formato monolítico de la v1 no podía tener:

- **Descarga parcial.** Te llevas solo las teselas que te interesan. El v1 obligaba a bajar
  el paquete entero para leer un byte, porque estaba cifrado como un bloque.
- **Publicación incremental.** Republicar sube solo los fragmentos cuyo hash cambió.
- **Herencia comprobable.** Un fragmento heredado de otro índice conserva su hash, así que su
  autoría es verificable y no una declaración de buena fe. Quitar la atribución rompería
  `SHA256SUMS`. Esta propiedad es la que hace posible la sección 7.
- **Deduplicación entre paquetes.** El mismo panorama en dos índices es el mismo hash.

El cifrado del subsistema 8 será **por fragmento**, con su propio nonce, y no del blob
entero: es lo que permite descargar y descifrar una pieza.

### Los vectores viajan cuantizados

Con `lumi-2` a 12288 dimensiones y 200 000 imágenes:

| Forma | Bytes/imagen | Total |
|---|---|---|
| float32 | 49 152 | ~9.8 GB |
| int8 escalar | 12 288 | ~2.5 GB |
| binaria | 1 536 | ~0.3 GB |

El paquete lleva binario e int8 dentro de los fragmentos, y el float32 como extra opcional.
Qdrant ya busca con cuantización binaria y reescala contra vectores de más precisión: es su
configuración normal, no un apaño.

### Las imágenes del índice no son prueba

La regla de `ARCHITECTURE.md` de no recomprimir ni tocar el EXIF protege la cadena de
custodia de **la foto que investiga el usuario** en Lumi Station. Las imágenes de un índice
son material de referencia: un caso no se defiende enseñando el panorama de Mapillary, se
defiende enseñando la coincidencia. Se guardan por tanto a la resolución que el verificador
geométrico consume y en un formato moderno, no al tamaño con el que se descargaron.

La regla **sí se aplica** a la ingesta desde carpeta local: el fichero del operador se abre
en solo lectura y su original nunca se reescribe.

### Compresión

Zstd para `indice.db`, `manifiesto.json` y `cobertura.json`. Las imágenes y los vectores
cuantizados se almacenan en crudo: el v1 metía JPEGs dentro de un zip y pagaba CPU por no
ganar nada.

## 6. La procedencia, en sus dos sentidos

Hay dos preguntas distintas, y la v1 no tenía sitio para ninguna de las dos:

- **De dónde salió el píxel** — procedencia de las imágenes.
- **Quién pagó por indexarlo** — procedencia del trabajo.

### Procedencia de las imágenes

Tres cosas, donde la v1 tenía una columna de texto libre:

**El lote de ingesta** (`lotes`): una fila por cada vez que entra material — qué clase de
ingesta fue, de dónde exactamente, cuándo, y con qué versión del Indexer. Cada imagen apunta
a su lote. Esto es la cadena de custodia y sale gratis: no hace falta inventar un campo «cómo
llegó esto aquí», es la fila padre.

**El tipo de imagen**: `calle`, `cenital`, `suelta`. Cerrado, tres valores. Determina contra
qué verifica bien — una cenital y una foto de turista no se parecen aunque miren el mismo
sitio.

**La fuente**: quién la dio (`mapillary`, `google`, `flickr`, `carpeta:<nombre>`,
`desconocida`), con su atribución exigible y su licencia al lado. La v1 tenía el riesgo de
términos de servicio de Google documentado en prosa y sin ningún sitio en los datos donde
anotarlo.

**`desconocida` es un valor de primera clase.** Los paquetes legacy de la v1 no llevan
procedencia dentro: su manifiesto exporta `panoId`, `heading`, `lat`, `lng`,
`streetViewDate`, embeddings y poco más — las columnas `provider` y `attribution` existían en
su base de datos pero no se exportaban. El Indexer no la adivina. La pide al importar, y si
el operador no la sabe queda como desconocida **y sale en los porcentajes**. Un índice que es
31 % de origen desconocido tiene que decirlo. Si el operador la declara, queda anotado que la
declaró él y no el material.

### Los dos porcentajes

- **Por imágenes**: recuento de filas por tipo y por fuente. Suma 100 %.
- **Por territorio**: quadkeys distintos a z14 que aporta cada origen, sobre los quadkeys
  distintos del índice. **Puede sumar más de 100 %**, porque dos orígenes pueden cubrir la
  misma tesela, y el manifiesto lo dice explícitamente en vez de normalizar.

Se muestran juntos porque juntos dicen algo que ninguno dice solo: «11 % de las imágenes son
cenitales, y cubren el 68 % del territorio» significa que en dos tercios del área solo hay
vista de pájaro, y que ahí la herramienta va a ir peor. Con un solo número eso queda
invisible.

### Procedencia del trabajo

Por tesela, y **suma 100 %**, porque una tesela la indexó exactamente uno. Tres orígenes
posibles: indexado en este equipo, heredado de otro índice local, o heredado de un índice
publicado por un tercero. En el último caso la atribución del autor viaja dentro del
fragmento y no se puede quitar sin romper `SHA256SUMS`.

## 7. Territorio y no indexar nunca lo mismo dos veces

### La regla

Antes de indexar nada, el área dibujada se descompone en teselas y cada una se clasifica en
tres estados:

| Estado | Significa | Qué se hace |
|---|---|---|
| **Ya en tus índices** | la tesela existe en un `.lumidx` de este equipo | se referencia el mismo fragmento; ni descarga ni GPU |
| **Publicada en el catálogo** | algún índice publicado la cubre | se descarga su fragmento, con su atribución |
| **Sin indexar** | no existe en ningún sitio conocido | es lo único que cuesta cuota y GPU |

**Si no queda ninguna tesela sin indexar, no se puede indexar.** No es un botón
deshabilitado por prudencia: literalmente no hay trabajo que hacer, y lo que se ofrece en su
lugar es instalar lo que ya existe. La salida honesta para material desfasado es pedir una
recaptura por tesela; lo que no existe es un «rehacerlo porque sí».

### El orden importa

El plan ejecuta primero lo heredado y después lo nuevo. Si el trabajo se interrumpe a la
mitad, lo que ya existía está dentro y lo que falta sigue siendo exactamente el conjunto de
teselas sin indexar. Al revés, una interrupción deja teselas nuevas sueltas sin el contexto
que las rodea.

### El fichero de cobertura

Un índice publicado expone un `cobertura.json` pequeño y separado del paquete:

```json
{
  "version": 1,
  "indice": "marta/lumi-costa",
  "sellado_en": "2026-07-28T11:04:00Z",
  "atribucion": { "autor": "marta", "url": "…", "licencia": "CC BY-SA 4.0" },
  "teselas": [
    { "quadkey": "03113322013021", "sha256": "3f9a…", "bytes": 18234112, "imagenes": 412 }
  ]
}
```

Es lo único del subsistema 8 que el 7a construye, y no es trabajo adelantado: el 8 lo va a
necesitar exactamente así. El 7a lo escribe al sellar y lo lee al planificar. Buscar,
navegar, publicar e instalar con interfaz siguen siendo del 8.

La cobertura local se calcula del mismo modo, leyendo el `cobertura.json` de cada paquete
instalado — un solo camino de código para los dos casos.

### Consecuencia sobre una decisión anterior

Durante el diseño se eligió el paquete autocontenido y se descartó explícitamente la variante
«con un registro de cobertura aparte». **Esa decisión queda revertida.** Lo que se pide ahora
es más fuerte que aquel registro: no es avisar de que ya tienes algo, es que la cobertura del
territorio es planetaria y compartida, y repetirla tira cuota del proveedor y horas de GPU
para llegar al mismo sitio. La reversión es posible sin rehacer el formato precisamente
porque el paquete pasó a estar troceado y direccionado por contenido.

## 8. Los dos orígenes del 7a

### Paquete legacy cifrado de la v1

Formato conocido: assets `bundle.zip.enc` y `metadata.json.enc` de una release de GitHub,
AES-256-GCM con `iv || authTag || ciphertext` y una clave de 32 bytes incrustada en la app.
Esa clave **es ofuscación frente a quien navegue el repositorio sin la aplicación, no un
límite de seguridad**: es extraíble de un proyecto de código abierto por cualquiera que mire.
El límite real de confianza es la validación de abajo.

La tubería de importación, en un directorio de staging, con cualquier fallo tirando el
directorio entero sin escribir nada:

1. Topes de tamaño comprimido, descomprimido y número de ficheros, **antes** de descomprimir.
2. Descifrado y verificación del `authTag`.
3. Validación estricta del manifiesto campo a campo — no un cast.
4. Lista blanca sobre todo nombre que acabe formando una ruta, rechazando `..` en cualquier
   posición. En la v1 esto era escritura de fichero arbitraria.
5. Cada fichero tiene que decodificar como imagen de verdad; la extensión no basta.
6. Solo entonces: copiar al índice e importar.

Los vectores vienen dentro. Si el modelo del manifiesto coincide con uno instalado se
importan tal cual y no se gasta GPU. Si no coincide, las imágenes entran **sin vector** y se
encolan para embeber — el mismo mecanismo que la v1 tuvo que inventar a posteriori, aquí
desde el principio.

### Carpeta local

El operador apunta a un directorio. Las coordenadas salen del EXIF, y si no las trae, de un
CSV o JSON hermano. Declara tipo, fuente y licencia del lote una vez, para todo.

El fichero original se abre en solo lectura y **no se reescribe, ni se recomprime, ni se le
quita el EXIF**.

## 9. Con qué se embebe

Un registro de modelos que es **datos, no código**: un directorio de ficheros JSON, uno por
modelo. La v1 aprendió esto por las malas — registrar un modelo significaba editar un módulo
compartido, y así se perdió una entrada entera en un release. Un fichero malo cuesta un
modelo, nunca la lista.

Arranca con `lumi-preview` (MegaLoc, 8448-d) y `lumi-2` (BoQ+DINOv2, 12288-d). No por
nostalgia: son los que llevan dentro los paquetes legacy, y no soportarlos dejaría huérfano
todo lo ya publicado. Un índice puede llevar vectores de varios modelos a la vez —un fichero
por modelo dentro de cada fragmento— que es justo lo que hace falta para que el subsistema 5
elija después sin reindexar nada.

Los pesos se descargan con el runner, con su log y su reanudación, igual que el runtime.

## 10. El motor de ingesta

Un **trabajador Python persistente**, proceso hijo con tuberías. Carga el modelo una vez y lo
cambia bajo demanda, con su línea de `listo` — sin ella, «está cargando pesos» y «se ha
colgado» se ven exactamente igual, que es el error que costó una tarde en el subsistema 4.

### Dos clases de fallo, y no se tratan igual

**«Esta imagen no se puede embeber»** —corrupta, sin coordenadas utilizables, por encima del
tope de entrada— es un **resultado**: se anota el motivo en la fila, se salta y se sigue. No
se reintenta, porque reintentarla solo quema GPU. La lista de saltadas es visible y
exportable como CSV.

**Que el proceso se muera** es una **avería**: el lote vuelve a la cola una vez, con un
contador que impide el bucle infinito.

### Cerrar la ventana

El Indexer es una app de escritorio autónoma: su proceso *es* el motor, no hay daemon detrás.
Se minimiza a la bandeja y sigue trabajando; cerrarlo de verdad para el trabajo pero no lo
pierde, porque el estado por imagen está en SQLite y reabrir retoma donde iba. Es la solución
simple que funciona. La alternativa —un sidecar que sobreviva a la app— es un proceso
huérfano con la VRAM ocupada esperando a que alguien lo mate.

## 11. Sellar y abrir

**Sellar** vuelca los vectores de Qdrant a los ficheros de cada fragmento en el orden exacto
que declara `indice.db`, calcula los porcentajes de las dos procedencias, escribe el
manifiesto y el `cobertura.json`, y firma todo en `SHA256SUMS`. Y hace lo que hizo el script
de migración de la v1, que es la parte que importa: **cuenta filas contra vectores y se niega
a declarar éxito si no cuadran.** Un paquete sellado a medias es peor que ninguno, porque
parece bueno.

Sellar es irreversible: un paquete sellado no se sigue llenando.

**Abrir** verifica `SHA256SUMS` antes de tocar nada y luego importa a Qdrant. Si un fichero
no cuadra, el paquete no se abre — no se abre «con avisos».

## 12. Seguridad

- La clave de Mapbox y cualquier otro secreto, cifrados en local con una maestra del equipo.
- Redis y Qdrant solo en `127.0.0.1`, con `protected-mode`.
- Todo lo que entra de fuera —paquete legacy, fragmento heredado del catálogo— pasa por la
  tubería de validación de §8 en un directorio de staging. Un fragmento descargado se
  verifica contra el `sha256` que declaraba el `cobertura.json` **antes** de integrarse.
- La clave incrustada de los paquetes legacy es ofuscación, y está documentada como tal aquí
  y en el código. Nunca se confunde un paquete descifrado con un paquete de confianza.

## 13. Pruebas

Por convención del proyecto, una comprobación ejecutable donde la lógica no es trivial y
ninguna en lo mecánico. Seis:

1. El validador de manifiesto legacy rechaza rutas hacia arriba, tamaño desbordado y un
   fichero que no decodifica como imagen.
2. El cálculo de los dos porcentajes de imágenes, incluido el caso de que el territorial pase
   de 100 %.
3. El viaje de ida y vuelta de un fragmento de vectores conservando el orden de `indice.db`.
4. El descifrado de un paquete legacy real.
5. Un lote a medias reanuda sin repetir lo hecho.
6. La clasificación de teselas: un área totalmente cubierta devuelve cero teselas nuevas, y
   una parcialmente cubierta devuelve exactamente el complemento.

## 14. Fuera de alcance, a `FUTURO.md`

- **Imágenes retenidas para evaluación ciega.** La v1 tenía `index_holdout_images`. Su sitio
  natural es el subsistema 5, que es quien las usa para medirse.
- **Reducción de dimensión aprendida** (proyección o truncado matryoshka) por encima de la
  cuantización. La cuantización ya da el grueso del ahorro.
- **Ajuste fino del modelo de recuperación** sobre el material de un territorio. El formato
  del paquete se diseña para que un día quepan pesos sin romper los índices publicados.
- **Recaptura por tesela** cuando el material existente está desfasado. La regla de no
  reindexar necesita esta salida, y se anota como el trabajo que la completa.

## 15. Consecuencias fuera del 7a

Estas nacen aquí pero son trabajo sobre otras piezas, y no se cuelan en este plan:

- **Migrar la cola del subsistema 4 a Redis**, y añadir Redis y Qdrant al aprovisionamiento
  del servidor. La cola actual está terminada y funcionando sobre SQLite en proceso; esto es
  trabajo sobre algo ya cerrado y probado.
- **El subsistema 8 hereda el formato v2**: cifrado por fragmento, subida incremental que
  solo publica los hashes cambiados, dos niveles de instalación (ligero y completo) e
  instalación que ya sirve antes de terminar de descargar.
- **El subsistema 5 abre paquetes `.lumidx`** e importa a su propio Qdrant, y elige qué
  modelo usar entre los que el paquete traiga.
