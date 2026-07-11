# Este proyecto es una prueba de concepto (PoC)

Este documento explica qué significa eso acá: qué se validó, dónde está el
techo real del diseño actual (escala), qué problemas trae depender de Google
Maps Platform para los datos, y qué números concretos respaldan todo esto —
con un script (`scripts/benchmark.py`) para que cualquiera pueda reproducirlos
o extenderlos contra su propio hardware.

## 1. Qué se está probando

La pregunta central del PoC: **¿alcanza con modelos de retrieval y
verificación ya entrenados (sin fine-tuning propio) para geolocalizar una
foto de calle contra un índice pequeño, generado por uno mismo?**

```
Imagen query
   │
   ▼
Retrieval (Lumi Preview → MegaLoc congelado, descriptor 8448-d)
   │
   ▼
Búsqueda por similitud coseno (pgvector, exacta) + clustering espacial
   │
   ▼
Top-k candidatos por región, con lat/lng/heading/pano_id
   │
   ▼ (solo bajo demanda, al pulsar "Refinar")
Verificación geométrica: Laila (RoMa congelado)
   │
   ▼
Coordenadas + score de confianza
```

Las capturas del `README.md` corresponden a una corrida real sobre ~0.2 km²
en León (España): 1280 imágenes indexadas, una búsqueda con 64 candidatos
sin verificar agrupados en regiones, y un resultado principal al 56% de
similitud. Esa corrida es también la base de las proyecciones de la
sección 3: es el único punto de datos real que tenemos sobre densidad de
imágenes por km² en una ciudad europea de tamaño medio.

Lo que el PoC **no** intenta demostrar es que este diseño escale sin
cambios más allá de esa clase de área — al contrario, la sección siguiente
es explícitamente sobre dónde se rompe.

## 2. Problemas de escala del diseño actual

El pipeline se construyó a propósito para un área de prueba de pocos km²
(spec: ~5 km² de MVP). Varias piezas que funcionan bien a esa escala tienen
un techo conocido y ya documentado en el propio código:

### 2.1 El servicio de inferencia hace OOM con batches grandes

`apps/worker/src/jobs/index-area.ts` procesa las imágenes de un área en
chunks fijos de **16** imágenes por llamada a `/embed`, no porque 16 sea un
número óptimo de throughput, sino porque un área de 89 puntos de captura
(356 imágenes a 4 headings) enviada en un solo batch **hizo crashear el
servicio de inferencia corriendo en CPU** con un error de asignación de
memoria de ~6.375 GB (`"not enough memory: you tried to allocate
6375342080 bytes"`). El chunking es un parche funcional, no una solución de
throughput: cuantos más chunks, más llamadas HTTP secuenciales, más lento
el indexado total — es un trade-off directo entre "no crashear" y
"terminar rápido", y hoy está resuelto a favor de lo primero.

Esto escala mal en dos direcciones a la vez:
- **Áreas grandes** generan más chunks secuenciales (el worker no los
  paraleliza), así que el tiempo de indexado crece linealmente con el nº de
  imágenes, no se beneficia de tener más CPU/GPU disponible salvo que se
  cambie esta lógica.
- **Sin GPU**, cada chunk es sustancialmente más lento (ver sección 4,
  benchmark `embed`), y el límite de memoria que causó el OOM original
  aparece incluso antes.

### 2.2 No hay ANN — la búsqueda es coseno exacto sobre toda la tabla

El diseño usa `pgvector` sin índice HNSW/IVFFlat: para cada búsqueda se
compara el descriptor de la query contra **todas** las filas indexadas. Es
una decisión consciente para el volumen del PoC (miles de filas, no
millones) — a esa escala una búsqueda exacta ya es cuestión de
milisegundos y añadir un índice aproximado sería complejidad sin beneficio
medible todavía.

El problema es que esto **no tiene un plan de migración automático**: no
hay un umbral en el código que active HNSW cuando el índice crece, así que
si alguien indexa muchas áreas (o una ciudad completa) sin revisar esto a
mano, la latencia de búsqueda escala linealmente con el tamaño del índice
sin ningún aviso. La sección 4 (`index-scale`) da una forma de medir en qué
punto esto deja de ser aceptable para tu caso de uso.

### 2.3 El coste y el tiempo escalan mucho más rápido de lo intuitivo

Usando la densidad real observada en la corrida de León (1280 imágenes /
0.2 km² ≈ **6400 imágenes/km²**) y el precio real que usa el sistema
(`STREET_VIEW_PRICE_PER_IMAGE_USD = $0.007`, default de
`packages/shared-types/src/settings.ts`):

| Área (km²) | Imágenes | Coste (USD) | Chunks de embed | ¿Supera budget mensual default ($50)? | ¿Supera límite de área default (5 km²)? |
|---|---|---|---|---|---|
| 0.2 | 1 280 | $8.96 | 80 | No | No |
| 1 | 6 400 | $44.80 | 400 | No | No |
| 5 | 32 000 | $224.00 | 2 000 | **Sí** | No |
| 20 | 128 000 | $896.00 | 8 000 | **Sí** | **Sí** |
| 100 | 640 000 | $4 480.00 | 40 000 | **Sí** | **Sí** |

*(Tabla generada con `python scripts/benchmark.py cost-model`, reproducible
por cualquiera — ver sección 4.1.)*

Dos cosas saltan a la vista:

1. **El propio límite por defecto del sistema (`MAX_AREA_KM2 = 5`) ya
   proyecta un coste que excede el presupuesto mensual por defecto
   (`MAX_MONTHLY_BUDGET_USD = $50`)** con la densidad de puntos real
   observada. En la práctica, indexar un área al límite permitido por
   defecto agota de entrada el presupuesto de varios meses en una sola
   corrida, algo que solo se descubre si se lee el guard de presupuesto en
   el código o se choca contra el `BudgetExceededError` en producción.
2. Ni el coste ni el tiempo de indexado escalan de forma manejable más allá
   de un puñado de km² sin: (a) subir el `MAX_MONTHLY_BUDGET_USD` a mano,
   (b) paralelizar el embedding (sección 2.1), y (c) resolver el ANN
   (sección 2.2) antes de que la tabla de imágenes indexadas crezca sin
   límite.

### 2.4 Concurrencia de descarga acotada, no paralelismo real de principio a fin

`MAX_CONCURRENT_REQUESTS` (default: 10) limita cuántas descargas de Street
View corren en paralelo, pero es la única etapa paralelizada del pipeline:
el embedding (2.1) es secuencial por chunk, y la verificación geométrica
(bajo demanda) también corre candidato por candidato. El resultado neto es
que el tiempo total de indexado de un área no se reduce mucho aunque le des
más cómputo a la máquina, salvo que se toquen esas partes del worker.

## 3. Problemas de recolección de datos desde Google Maps

Más allá de la arquitectura, la fuente de datos en sí tiene limitaciones
que no desaparecen con más ingeniería:

### 3.1 Términos de Servicio — no es una zona gris

El pipeline descarga imágenes de la **Google Street View Static API** y las
persiste (metadata + descriptor de embedding) para reutilizarlas en
búsquedas futuras. Los Términos de Servicio de Google Maps Platform
prohíben explícitamente el **bulk-download**, el **cacheo** de imágenes
fuera del contexto de un mapa de Google, y la **indexación** de ese
contenido para un uso distinto al servicio original. A la escala de este
PoC (un área de prueba de menos de 1 km²) el riesgo práctico de que esto
genere un conflicto es bajo, pero es, formalmente, **una violación de esos
Términos — no una zona gris**. Escalar la recolección de datos (sección 2.3)
no reduce este riesgo; lo aumenta, porque hay más contenido cacheado y más
tráfico hacia la API con un patrón de uso (bulk download sistemático) que
es precisamente lo que el ToS prohíbe.

### 3.2 Rate limiting y dependencia de infraestructura compartida de terceros

El paso de sampling de calles no llama a Google, sino a la instancia
pública de **Overpass API** (`overpass-api.de`) para obtener la geometría
de OpenStreetMap. Es infraestructura compartida y gratuita, y en la
práctica del desarrollo de este proyecto se confirmaron en vivo tanto
errores 5xx transitorios por sobrecarga como **respuestas 429** cuando el
worker reintentaba un indexado poco después de una request previa. El
código ya implementa backoff exponencial y respeta el header `Retry-After`
en los 429 — pero esto significa que, a mayor escala (más áreas indexadas
más seguido), el proyecto pasa a depender de la buena voluntad de un
servicio público de terceros sin SLA, no de infraestructura propia. La ruta
de escalado natural (una instancia propia de Overpass, o un mirror local
de OSM) no está implementada.

### 3.3 Cobertura y calidad de imagen no garantizadas

Ni todos los puntos muestreados a lo largo de una calle tienen cobertura de
Street View, ni la que existe es necesariamente reciente: la Static API
devuelve la panorámica más cercana disponible a esas coordenadas, que puede
tener años de antigüedad respecto al estado real de la calle. El worker ya
contempla el caso de "puntos fallidos" dentro de un job de indexado
(algunos puntos no tienen imagen disponible), pero no hay ninguna
verificación de qué tan vieja es la imagen que sí se descarga — un
desajuste temporal entre el índice y la realidad actual de la calle es una
fuente de error que ningún ajuste del modelo de retrieval puede corregir.

### 3.4 Dedupe por `pano_id`, no por contenido

El sistema evita re-descargar imágenes ya indexadas comparando `pano_id` +
heading contra lo ya existente en la base — esto previene gasto duplicado
cuando dos áreas se solapan, pero no detecta que dos `pano_id` distintos
puedan corresponder a la misma escena real (por ejemplo, capturas
consecutivas de Google separadas por poca distancia). A mayor escala de
indexado, esto se traduce en redundancia dentro del propio índice que
infla el coste y el tamaño de la tabla sin aportar cobertura real nueva.

## 4. Benchmarks

Todos los números de esta sección se generan con
[`scripts/benchmark.py`](../scripts/benchmark.py), incluido en este repo.
Se dividen en dos grupos, porque solo uno de ellos se puede calcular sin
hardware ni servicios corriendo.

### 4.1 Proyección de coste/tiempo (determinista, ya calculada arriba)

La tabla de la sección 2.3 sale directamente de:

```bash
python scripts/benchmark.py cost-model --area-km2 0.2 1 5 20 100
```

Esto no mide nada en vivo: reproduce en Python puro las mismas fórmulas que
usan `packages/geo-sampling/src/cost.ts` y `packages/api-usage/src/budget.ts`,
con los defaults reales del sistema (`$0.007`/imagen, chunks de 16,
`MAX_CONCURRENT_REQUESTS=10`) y la densidad de imágenes/km² observada en la
corrida real de León. Es determinista y reproducible por cualquiera sin
necesitar GPU, Postgres, ni una API key de Google — por eso es el único
grupo de números que este documento puede afirmar con confianza total.

Dos parámetros de esa proyección **sí dependen de tu hardware/red real** y
el script los deja como flags explícitos en vez de asumir un valor:
`--embed-seconds-per-chunk` (cuánto tarda tu servicio de inferencia en
procesar un chunk de 16 imágenes) y `--sv-request-seconds` (cuánto tarda en
promedio una descarga de Street View en tu conexión). Los benchmarks de la
sección 4.2 existen justamente para medir el primero.

### 4.2 Benchmarks de rendimiento (requieren tu propio entorno)

Estos números **no están rellenados en este documento a propósito**: no
hay una GPU, un servicio de inferencia corriendo, ni una base con pgvector
disponibles en el entorno donde se redactó este documento, y no tiene
sentido inventar cifras de latencia que dependen enteramente de tu
hardware. Corré esto contra tu propio stack (`services/inference` +
Postgres) y pegá los resultados acá:

```bash
# Throughput de embedding — reproduce en tu máquina el escenario de OOM
# documentado en 2.1 (batch de 356 imágenes) y mide dónde está tu propio
# techo antes de llegar ahí.
python scripts/benchmark.py embed \
  --url http://localhost:8000 \
  --batch-sizes 1 4 8 16 32 64 128 256 356

# Latencia de verificación geométrica (Laila/RoMa) a distinto nº de candidatos
python scripts/benchmark.py verify \
  --url http://localhost:8000 \
  --candidates 1 5 10 25 50 100

# Latencia de búsqueda coseno exacta en pgvector, a distintos tamaños de
# índice — esto es lo que responde "¿hasta qué volumen aguanta la sección
# 2.2 antes de necesitar HNSW/IVFFlat?"
python scripts/benchmark.py index-scale \
  --dsn postgresql://netryx:changeme@localhost:5432/netryx_dev \
  --sizes 1000 10000 50000 100000 500000 1000000

# Corre todo lo anterior + el modelo de coste, y genera un .md listo para
# pegar acá
python scripts/benchmark.py all \
  --url http://localhost:8000 \
  --dsn postgresql://netryx:changeme@localhost:5432/netryx_dev \
  --out benchmark-results.md
```

Plantilla para pegar los resultados una vez corridos (formato que produce
el propio script):

**Throughput de embedding (`/embed`)**

| Batch size | OK/repeats | Media (ms) | p95 (ms) | Imágenes/seg | Error |
|---|---|---|---|---|---|
| 1 | | | | | |
| 16 | | | | | |
| 64 | | | | | |
| 256 | | | | | |
| 356 | | | | | |

**Latencia de verificación (`/verify`)**

| Nº candidatos | OK/repeats | Media (ms) | p95 (ms) | ms/candidato | Error |
|---|---|---|---|---|---|
| 1 | | | | | |
| 10 | | | | | |
| 50 | | | | | |
| 100 | | | | | |

**Escala del índice (pgvector, coseno exacto)**

| Filas en el índice | Media (ms) | p95 (ms) |
|---|---|---|
| 1 000 | | |
| 10 000 | | |
| 100 000 | | |
| 1 000 000 | | |

Con la fila de `embed` de tu hardware real, volvé a la sección 4.1 y pasale
ese valor a `--embed-seconds-per-chunk` para que la proyección de tiempo de
indexado (no solo de coste) sea específica de tu entorno.

## 5. Modelos usados y su procedencia

| Rol en el producto | Modelo base | Licencia / estado | Qué hace |
|---|---|---|---|
| **Lumi Preview** (retrieval) | [MegaLoc](https://github.com/gmberton/MegaLoc) | MIT, pesos congelados | Descriptor de 8448 dimensiones, L2-normalizado, por imagen. |
| **Laila** (verificación) | RoMa | pesos congelados | Matcher geométrico ligero sobre el top-k del retrieval, sin reconstrucción 3D densa. |

## 6. Qué significa "funciona" en este PoC

El pipeline end-to-end corre completo y produce resultados coherentes sobre
datos reales, como muestran las capturas del README. Eso es lo que este PoC
buscaba demostrar.

Lo que **no** se afirma:

- Que el % de similitud obtenido en las corridas de prueba sea
  representativo de la precisión del sistema en general.
- Que el sistema esté listo para operar sobre áreas grandes sin resolver
  primero las secciones 2.1–2.4 (batching secuencial, ANN, paralelismo,
  presupuesto).
- Que la recolección de datos vía Street View esté validada legalmente para
  un uso más allá de una prueba personal y acotada — ver sección 3.1.

## 7. Referencias

- Spec completa del fork y todas las decisiones de arquitectura: `docs/`.
- Proyecto original del que este es fork:
  [Netryx Astra V2](https://github.com/sparkyniner/Netryx-Astra-V2-Geolocation-Tool).
- Script de benchmarks: [`scripts/benchmark.py`](../scripts/benchmark.py).