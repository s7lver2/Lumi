# Subsistema 5b — Recuperación en ensemble y verificadores geométricos

El 5a montó el camino entero y dijo sin rodeos que **al terminar las coordenadas serían malas**,
porque el embebedor seguía siendo el de juguete. El 5b es el ciclo que las arregla: modelos de
verdad, varios recuperadores en paralelo en vez de uno, y detrás una capa que hoy no existe —
los **verificadores geométricos compitiendo** por afinar la coordenada.

Maquetas: [`lumi-s5b-mockups.html`](lumi-s5b-mockups.html) (el camino de una consulta, los tres
niveles con nombres concretos, el arbitraje entre verificadores, el coste para el Indexer y el
filtro de licencias).

**Orden vigente:** `1 → 2 → 6 → 4 → 7a → 7b → 8 → 5 → 3 → 9`.

---

## 1. Alcance

**Dentro:**

- Los modelos elegidos, y el registro de niveles como datos.
- El embebedor real, en los dos lados: `workers/lumi_geo.py` (Station) y `workers/lumi_embed.py`
  (Indexer). Un vector solo se compara con vectores del mismo modelo, así que los dos cambian a la vez.
- Recuperación con N modelos y fusión de sus listas.
- Verificación geométrica con M verificadores compitiendo, y el afinado de la coordenada.
- Deshacer la confusión entre **nivel** y **modelo** (§3), que hoy hace que un análisis real
  devuelva cero candidatos.
- El camino de **reembeber un índice ya instalado sin volver a descargar una sola foto**.

**Fuera:**

- **Los agentes** — idioma, hora por las sombras, dimensiones del edificio, clima, estación. Van al
  **5c**. Regla ya acordada y anotada para ese ciclo: *los que dan una restricción geográfica dura
  filtran y reponderan; los descriptivos solo se le enseñan al investigador*. Los primeros exigen que
  el corpus sepa de qué país y de qué estación es cada foto, y eso es trabajo del Indexer.
- Geocodificación inversa (sigue en `FUTURO.md`).
- El panel de administración, que es el 3.
- Entrenar nada. Todos los modelos entran **congelados**, de terceros.

## 2. Los modelos

Los de recuperación **ya estaban elegidos** desde el 7a: el registro es datos y no código
(`indexer/modelos/*.json`), y arranca con `lumi-preview` (MegaLoc, 8448-d) y `lumi-2` (BoQ+DINOv2,
12288-d). Lo que el 5b hace es completar la lista y ponerle nombres concretos a las casillas de
Mini / Pro / Vision, que `ARCHITECTURE.md §4` llevaba abiertas desde el principio.

**Mezclar familias importa más que sumar modelos.** MegaLoc, SALAD, CliqueMining y BoQ son todos
DINOv2 con una agregación distinta: ven casi lo mismo y se equivocan casi en lo mismo. Por eso Pro
entra con dos *foundation* y dos CNN clásicas, no con cuatro primos hermanos.

### Recuperación

| id | Base | Dims | Licencia | Mini | Pro | Vision |
|---|---|---|---|:-:|:-:|:-:|
| `cosplace` | ResNet-18 | 512 | MIT | ● | | ● |
| `megaloc` | DINOv2-B + SALAD | 8448 | MIT | | ● | ● |
| `boq-dinov2` | DINOv2 + Bag-of-Queries | 12288 | MIT | | ● | ● |
| `eigenplaces` | ResNet-50 | 2048 | MIT | | ● | ● |
| `mixvpr` | CNN + feature mixing | 4096 | MIT | | ● | ● |
| `salad` | DINOv2-B + transporte óptimo | 8448 | MIT | | | ● |
| `cliquemining` | SALAD afinado | 8448 | MIT | | | ● |
| `anyloc` | DINOv2 + VLAD sin afinar | 49152 | MIT | | | ● |

`lumi-preview` y `lumi-2` del 7a **son** `megaloc` y `boq-dinov2`. Se conservan sus identificadores
tal cual: los llevan dentro los paquetes legacy de la v1 y renombrarlos dejaría huérfano todo lo ya
publicado. Los seis restantes son entradas nuevas del mismo registro.

AnyLoc se queda pese a poner él solo 49 152 de las 93 440 dimensiones de Vision. Es el único que no
está afinado para VPR, y eso es justo lo que le hace generalizar a escenarios donde los demás se
hunden. Vision es el nivel caro por definición.

### Verificadores geométricos

| id | Tipo | Coste | Licencia | Mini | Pro | Vision |
|---|---|---|---|:-:|:-:|:-:|
| `tiny-roma` | denso ligero | bajo | MIT | ● | | |
| `roma` | denso | 150–600 ms | MIT + Apache-2.0 (DINOv2) | | ● | ● |
| `lightglue-aliked` | disperso | 40–70 ms | Apache-2.0 + BSD-3 | | ● | ● |
| `efficient-loftr` | semi-denso | medio | Apache-2.0 | | | ● |
| `roma-v2` | denso | alto | MIT, **DINOv3 con licencia propia** | | | ● |

**Descartados por licencia, y no por calidad:** MASt3R y DUSt3R son CC BY-NC-SA 4.0 — no comercial —
y Lumi es abierta y autoalojada: el propietario del servidor tiene que poder usar su instalación
comercialmente. SuperPoint arrastra la licencia restrictiva de Magic Leap; su papel lo cubre ALIKED
con LightGlue. **`ARCHITECTURE.md §1` dice hoy que el objetivo es llevar «modelos como RoMa o M4ster»
a más precisión: esa frase hay que corregirla**, porque MASt3R no puede entrar en el producto.

**RoMa v2 entra con la licencia asumida**, decisión explícita del owner. Sus obligaciones (§11) no
son opcionales y hay que cumplirlas.

## 3. La confusión que hay que deshacer: nivel ≠ modelo

Hoy conviven dos significados en la misma palabra:

- `analyses.model` guarda **el nivel**: `"mini"`, `"pro"`, `"vision"`. Lo confirman
  `client/src/lib/models.ts` (`KNOWN_MODELS`), `limits.models`, `granted_models` y
  `queue::plan`.
- `installed_indices.modelo` guarda **el modelo de recuperación**: `"lumi-preview"`, `"lumi-2"`.

Y `queue/mod.rs` lee el primero y se lo pasa a `recuperar::hipotesis`, que lo mete en
`SELECT DISTINCT version FROM installed_indices WHERE modelo = ?1`. Es decir: **se busca un índice
instalado cuyo modelo sea `"mini"`, que no existe nunca**. Un análisis real devuelve hoy cero
candidatos, y no se ha notado porque con el embebedor de juguete las coordenadas eran malas de todas
formas y no había con qué distinguir «malas» de «ninguna».

Se arregla separando los dos conceptos y dejándolos con nombres distintos:

- **Nivel** (`nivel`): `mini` / `pro` / `vision`. Es lo que el investigador pide y lo que
  `limits::effective` concede. Es una **composición**.
- **Modelo** (`modelo`): un recuperador concreto. Es lo que identifica una colección de Qdrant y una
  capa de vectores dentro de un `.lumidx`.

`analyses.model` **no se renombra**: la columna ya existe, el cliente ya la lee, y migrarla no
compra nada. Lo que cambia es que el daemon deja de tratar su contenido como un id de modelo.

Segunda consecuencia: `installed_indices` tiene **una sola** columna `modelo`/`version`, así que un
paquete con ocho capas no se puede ni representar. Hace falta una tabla hija.

## 4. El registro de niveles, que es datos

Un directorio de ficheros JSON, uno por nivel, con la misma regla que el registro de modelos del
7a — la v1 aprendió por las malas que registrar algo editando un módulo compartido cuesta perder
una entrada entera en un release. **Un fichero malo cuesta un nivel, nunca la lista.**

```json
{
  "id": "pro",
  "nombre": "Lumi Pro",
  "recuperacion": ["megaloc", "boq-dinov2", "eigenplaces", "mixvpr"],
  "geometricos": ["roma", "lightglue-aliked"],
  "cae_a": "mini"
}
```

`cae_a` es la degradación de §8. `mini` lo tiene a `null`: por debajo no hay nada.

El registro de **modelos** gana los campos que la verificación necesita y que hoy no tiene: `familia`
(`foundation` / `cnn`) y `licencia`. La familia no es adorno — es lo que permite avisar de que un
nivel se ha quedado con cuatro modelos de la misma familia y que su ensemble ya no aporta diversidad.

Los verificadores llevan su propio registro, igual de datos: `id`, `nombre`, `tipo`, `pesos_url`,
`sha256`, `licencia`.

## 5. El embebedor real

`workers/lumi_geo.py` sustituye `_cargar` y `_vector`; `workers/lumi_embed.py` sustituye `_cargar` y
`_embeber`. Es exactamente lo que ambos ficheros llevan prometido en su cabecera desde el 7a. El
contrato de `lumi-proto::worker` **no se toca**: sigue siendo JSON por líneas, los vectores siguen
sin salir por stdout, y las imágenes siguen viajando como rutas.

Un cambio sí hace falta, y es aditivo. Hoy `Job.modelo` es un `String` y `Msg::Vectores` lleva un
`dims` y un `fichero`. Con N recuperadores por análisis:

- `Job` gana `modelos: Vec<String>`. `modelo` se conserva con `#[serde(default)]` y significa lo de
  siempre, un solo modelo — un trabajador viejo sigue siendo válido, que es la regla que ya rige
  `alternativas` en `Msg::Resultado`.
- `Msg::Vectores` gana `modelo: String`. El trabajador manda **una línea por modelo**, no una con
  todo dentro: si el tercero de ocho revienta, los dos primeros ya están escritos y el fallo dice
  cuál fue.

Los pesos se descargan con el runner que ya existe, con su log y su reanudación, y **se verifica su
sha256** antes de cargarlos — la misma postura que el aprovisionamiento de Qdrant del subsistema 1:
si el hash no coincide no hay «instalar de todas formas».

## 6. Recuperación en ensemble, y cómo se fusionan las listas

`recuperar::hipotesis` pasa de recibir `modelo: &str` a recibir el nivel, resolverlo contra el
registro, y consultar **una colección de Qdrant por modelo**. Salen N listas ordenadas de vecinos.

Se fusionan con **Reciprocal Rank Fusion**: cada candidato suma `1 / (k + rango)` por cada lista en
la que aparece, con `k = 60`. Se elige RRF y no un promedio de similitudes por una razón concreta:
las similitudes coseno de MegaLoc y de CosPlace **no están en la misma escala** y no hay forma
honesta de normalizarlas sin un conjunto de calibración que no tenemos. El rango sí es comparable
entre modelos, y RRF premia exactamente lo que interesa aquí — que varios modelos independientes
señalen el mismo sitio.

De la lista fusionada salen los candidatos que pasan a verificación. `VECINOS` (hoy 64, constante con
nombre en `recuperar.rs`, con un comentario que decía que «el 5b lo revisará con datos delante») se
convierte en dos números distintos: cuántos se piden **por modelo** (64, se mantiene) y cuántos
sobreviven a la fusión y llegan al verificador (**12**, porque verificar es caro y la fusión ya ha
hecho su trabajo si algo tenía que subir).

## 7. La competencia entre verificadores

Cada verificador recibe la imagen de consulta y una foto candidata, y devuelve
**correspondencias que sobreviven a RANSAC** más una coordenada afinada. El árbitro **no es un peso
aprendido: es el número de inliers.** Esa es la decisión de diseño central de este ciclo, y se elige
así porque es la única señal que no hay que entrenar, que significa lo mismo para un matcher denso y
para uno disperso, y que un investigador puede entender sin creerse un número mágico.

Reglas:

1. Por cada candidato, los M verificadores del nivel corren y **gana el de más inliers**. No se
   promedian las coordenadas: promediar dos respuestas cuando una es correcta y la otra es basura da
   una tercera respuesta que no es ninguna de las dos.
2. Un candidato cuyo mejor verificador no llegue al umbral **se cae**. Si se caen todos, el análisis
   **devuelve las hipótesis de recuperación sin afinar y lo dice**. No se inventa coordenada, y
   tampoco se contesta con silencio: negarse esconde información que el investigador puede usar, que
   es el mismo razonamiento por el que el 5a eligió hipótesis múltiples sobre negarse.
3. Los inliers del ganador entran en el peso de la hipótesis. Una zona respaldada por cuatrocientas
   correspondencias no pesa lo mismo que una respaldada por treinta, aunque la recuperación las
   trajera empatadas.

Que un verificador disperso saque nueve inliers donde uno denso saca cuatrocientos doce no es un
fallo del ensemble: es para lo que sirve tenerlos de familias distintas. Un matcher con detector se
hunde en fachadas repetitivas y sin textura, y uno denso no. Cuatro verificadores de la misma
familia se habrían equivocado cuatro veces igual.

**Umbral:** 25 inliers. Es un número puesto a ojo y hay que decirlo — no hay conjunto de validación
todavía. Va como constante con nombre y comentario en el código, no como ajuste de configuración:
un ajuste invita a que cada instalación tenga el suyo y a que dos servidores den respuestas
distintas al mismo caso, que en una herramienta forense es lo último que se quiere. Cuando el 5c
traiga métricas, se revisa.

## 8. Cuando al índice le faltan capas

Un índice publicado solo trae las capas de vectores con las que se construyó. Pedir Vision sobre un
índice que solo trae las cuatro de Pro no puede resolverse ignorándolo.

**Se cae al nivel que sí cabe, automáticamente, y se dice.** Se recorre `cae_a` hasta encontrar un
nivel cuyos recuperadores estén todos presentes en el índice. El análisis se guarda con el nivel que
**realmente corrió**, no con el pedido, y el cliente muestra el descenso con su motivo — que es el
patrón de la matriz de capacidades del subsistema 1: nada se esconde, todo lleva su causa legible.

Si ni siquiera `mini` cabe, el análisis falla con un motivo claro: ese índice no sirve para
consultar, solo para almacenar.

Con varios índices instalados, el nivel efectivo es el mejor que **algún** índice soporte, y solo se
consultan los índices que soportan ese nivel. Consultar unos índices con ocho capas y otros con
cuatro produciría listas fusionadas con pesos incomparables.

## 9. Quién elige el nivel

**Ya está construido y no hay que diseñarlo, solo respetarlo.** `limits.models` guarda qué niveles
tiene concedidos un usuario, `granted_models` los otorga al aprobar la solicitud, `ModelPicker` los
enseña, y `limits::effective` es la única forma legítima de leerlos. Eso es literalmente «el
propietario fija el techo, el investigador elige debajo».

Lo que el 5b añade: `KNOWN_MODELS` en el cliente pasa a describir los tres niveles de verdad — hoy
`ModelPicker` solo conoce `mini` y para `pro` y `vision` enseña «modelo habilitado por el servidor»,
que era honesto cuando no había ficha y deja de serlo ahora que sí la hay. Cada nivel muestra de qué
se compone: cuántos recuperadores, cuántos verificadores, y qué coste tiene pedirlo.

## 10. Lo que esto le pide al Indexer

Un vector **es** el modelo: no hay conversión entre uno y otro. Consultar con ocho recuperadores
exige que el corpus traiga esas ocho capas, y quien las produce es el Indexer. El formato `.lumidx`
ya lo soporta —un fichero por modelo dentro de cada fragmento— así que **el paquete no se toca**; lo
que cambia es cuánto cuesta construirlo.

| Nivel | Dims por imagen | Vectores int8, corpus de 9 000 fotos | Pases de embebido |
|---|---|---|---|
| Mini | 512 | 4,4 MiB | 1× |
| Pro | 26 880 | 231 MiB | 4× |
| Vision | 93 440 | 802 MiB | 8× |

Las imágenes no se multiplican: siguen siendo los mismos gigabytes. Los vectores pasan de 74 MiB a
802 MiB en el caso peor.

### Reembeber sin descargar

El corpus de hoy está hecho con el embebedor de juguete y **se tira entero**. Decisión del owner, con
una condición explícita: *la primera y la última vez*. Así que el 5b deja montado el camino que lo
garantiza — **añadir una capa de modelo a un índice que ya está en disco tiene que ser un pase de
GPU, no una campaña de descarga.**

Reutiliza lo que el ciclo de versiones ya construyó: las imágenes están en `imagenes/`, la fila de
cada una está en `indice.db`, y `liberar_tesela` demostró que se puede tocar el estado de una tesela
sin perder su fila. Reembeber es recorrer las imágenes de un índice, pedir el vector del modelo que
falta, y escribir un fragmento nuevo. No toca la red, no toca el presupuesto, y no cuenta contra el
reclamo de territorio porque no se está indexando nada nuevo.

## 11. Licencias y seguridad

- **Ninguna firma se salta**, ni al instalar el índice ni al descargar pesos. Los pesos se verifican
  por sha256 contra el registro.
- **DINOv3, por RoMa v2, impone dos obligaciones que hay que cumplir**, no anotar y olvidar:
  1. Mostrar «Built with DINOv3» de forma prominente. **Va en la sección de modelos de la web del
     subsistema 9**, decisión del owner; la licencia admite expresamente web o documentación del
     producto, así que no entra en la interfaz de Station.
  2. Entregar el acuerdo de Meta junto con los materiales. **`lumi install` tiene que escribir la
     licencia de DINOv3 al lado de los pesos** al descargarlos.
- Su política de uso aceptable prohíbe usos militares, nucleares, de armas y de **espionaje**. Se
  planteó al owner que una herramienta forense de geolocalización autoalojada es precisamente el
  perfil que esa cláusula mira, y **el owner decidió asumirlo a sabiendas**. Queda escrito aquí para
  que la decisión tenga dueño y fecha, no para reabrirla.
- **Este repositorio no tiene fichero `LICENSE`**, aunque `PRODUCT.md` dice «de código abierto». Con
  dependencias de licencia mixta entrando, esto deja de ser un descuido menor. No se resuelve en esta
  spec —no es trabajo de este subsistema— pero se anota en `FUTURO.md` como bloqueante antes de
  publicar la web del 9.

## 12. Datos y ficheros

En SQLite del daemon:

- **Nueva** `installed_index_layers` — `(paquete, modelo, version)`, clave primaria compuesta,
  `paquete` referencia `installed_indices`. Es lo que permite que un índice declare sus ocho capas.
  Las columnas `modelo`/`version` de `installed_indices` se quedan para no romper lo instalado, y
  pasan a significar la capa principal.
- `analyses` gana `nivel_efectivo TEXT` — el nivel que realmente corrió tras la degradación de §8.
  Nulo significa «el pedido», que es lo normal.
- `analysis_hypotheses` gana `inliers INTEGER` y `verificador TEXT`: de qué verificador salió la
  coordenada afinada y con cuánto respaldo. Es evidencia, no telemetría — un investigador tiene
  derecho a saber qué la produjo.

En disco: `{DATA}/pesos/<modelo|verificador>/`, con la licencia al lado cuando la haya.

En Qdrant: sigue siendo una colección por `(modelo, versión)`. Con ocho modelos son ocho colecciones,
que es exactamente para lo que estaba pensado.

## 13. Alternativas consideradas

- **Ocho recuperadores de la familia DINOv2** (MegaLoc, SALAD, CliqueMining, BoQ y variantes).
  Descartado: ven lo mismo y fallan igual. Ocho veces el coste de indexado para muy poca señal nueva.
- **Promediar las coordenadas de los verificadores** en vez de que gane uno. Descartado en §7:
  promediar una respuesta buena con una mala produce una tercera que no es ninguna.
- **Umbral de inliers configurable por servidor.** Descartado: dos instalaciones darían respuestas
  distintas al mismo caso. En una herramienta forense eso es un defecto, no flexibilidad.
- **Negarse cuando ningún verificador pasa el umbral.** Descartado por coherencia con el 5a: se
  devuelven las hipótesis de recuperación sin afinar, diciendo que no se verificaron.
- **Normalizar similitudes coseno entre modelos en vez de RRF.** Descartado: exige calibración que no
  existe, y una normalización inventada es peor que un rango honesto.
- **Que Vision se niegue si al índice le faltan capas.** Se consideró en serio, por la línea de «no
  hay instalar de todas formas». Descartado por decisión del owner a favor de la degradación
  automática: aquí no se está saltando una verificación de seguridad, se está usando menos material
  del disponible, y el resultado dice con qué corrió.
- **AnyLoc con PCA a 4096 dims.** Descartado por ahora: fijar la matriz PCA como parte del modelo es
  otra pieza que puede desincronizarse entre Indexer y Station, y el ahorro no compensa esa clase de
  fallo. Anotado en `FUTURO.md` por si el tamaño molesta con corpus grandes.
- **Entrenar o afinar algo.** Fuera del ciclo por completo. Todo entra congelado.

## 14. Pruebas

Convención del proyecto: no hay tests salvo para lógica no trivial. Aquí califican tres cosas, todas
funciones puras que van a `lumi-index` con `cargo test`, como `coverage.rs` y `agrupar.rs`:

- **La fusión RRF** sobre N listas ordenadas. Un candidato en el puesto 3 de cinco listas tiene que
  ganar a uno en el puesto 1 de una sola.
- **La degradación de nivel** dado un nivel pedido y el conjunto de capas de un índice. Incluye el
  caso de que no quepa ni `mini`.
- **El arbitraje**: dada una lista de veredictos por verificador, cuál gana, cuáles se caen por
  umbral, y qué pasa cuando se caen todos.

Lo que toca GPU, red o Qdrant no se prueba con tests: se ejecuta.

## 15. Consecuencias fuera del 5b

- `ARCHITECTURE.md §1`: quitar M4ster de la frase de objetivos — no puede entrar por licencia.
- `ARCHITECTURE.md §4`: la tabla de los tres modelos gana su composición real, y la fila de Mini deja
  de decir «un solo verificador geométrico» como si fuera toda su definición.
- `ARCHITECTURE.md §5`: el subsistema 5 pasa a terminado salvo el 5c, que se añade a la tabla.
- `CLAUDE.md`: la nota de «el embebedor sigue siendo el de juguete» deja de ser cierta y hay que
  quitarla, no dejarla contradictoria.
- `PRODUCT.md`: los tres niveles se describen por lo que llevan dentro, que es lo que el investigador
  está eligiendo cuando elige.
- `FUTURO.md`: entran el fichero `LICENSE` que falta, AnyLoc con PCA, y el 5c con su regla de agentes.
