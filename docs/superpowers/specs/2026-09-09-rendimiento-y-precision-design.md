# Rendimiento y precisión: por qué la app va lenta, por qué los agentes nunca corren y por qué la catedral da 1,7 km

## Resumen

Tres síntomas que el dueño reportó por separado resultan estar encadenados:

1. «Los agentes siguen sin ejecutarse.»
2. «La app a veces va muy lenta y las solicitudes tardan en cargar.»
3. «Una imagen de la catedral de León da un radio de 1,7 km, que es más o menos
   el área de todo el dataset.»

Este documento recoge el diagnóstico —**medido sobre el servidor en producción, no
inferido**— y el plan de arreglo. Cada afirmación lleva su evidencia.

El hallazgo que une los tres: **ningún análisis de la historia de este servidor ha
terminado antes de 124 segundos, y no porque el trabajo cueste eso.** El trabajo real
son ~35 s; el resto es esperar a un `timeout` de agentes que nunca iban a contestar.

---

## Parte 0 — Las medidas

Todo lo de abajo está tomado del servidor real (`pc-gamer`, WSL2, RTX 4070 SUPER),
no de leer código.

### 0.1 Duración real de un análisis

```
mini: n=26  min=124s  media=174s  max=393s
pro:  n=10  min=8s    media=204s  max=429s
```

El análisis #51 (la catedral) es el caso instrumentado:

| Momento | Reloj | Desde el encolado |
|---|---|---|
| Encolado | 13:23:49 | 0 s |
| Verificación geométrica terminada | 13:24:24 | **35 s** |
| `timeout` de agentes | 13:26:54 | **185 s** |
| Análisis marcado `hecho` | 13:26:54 | 186 s |

**El resultado estaba listo a los 35 s y se sirvió a los 186.** El suelo de 124 s de
todos los `mini` de la tabla es exactamente `LIMITE = 120s` de `agentar.rs:22` más el
resto del trabajo. Cada análisis de este servidor ha pagado ese `timeout` completo.

### 0.2 Coste de una escritura en la base

Pragmas reales del servidor en vivo:

| Pragma | Valor | Consecuencia |
|---|---|---|
| `journal_mode` | `delete` | journal de rollback: 3–4 `fsync` por commit, lock exclusivo de toda la BD |
| `synchronous` | `2` (FULL) | `fsync` en cada commit |

El filesystem de WSL2 da **~102 ms por `fsync`** (`200×4 KB oflag=dsync` → 20,5 s).

Banco de pruebas sobre una **copia** de la base real, 50 transacciones sueltas:

```
HOY (delete + FULL) : 50 commits en 7835 ms  ->  156.700 us/commit
WAL + NORMAL        : 50 commits en  232 ms  ->    4.640 us/commit
```

**34× de diferencia.** Y hay una sola conexión para toda la app
(`store.rs:280`, `pub struct Store(Mutex<Connection>)`), así que esos 157 ms
**congelan el daemon entero**, no solo a quien escribe.

Con la app en reposo, `/v1/health` responde en 7–8 ms. El problema no es el volumen
(2,6 MB de base, 36 análisis, 15.005 imágenes de referencia): es la contención.

### 0.3 Coste de la telemetría

`Nvml::init()` + `Shutdown` medido en esta GPU: **mediana 8,3 ms, máximo 29,7 ms**.
Se paga en `telemetry.rs:9`, **una vez por muestra**, y hay una muestra **por segundo
y por cliente conectado** (`routes/telemetry.rs:35`). Junto con
`Disks::new_with_refreshed_list()` (`telemetry.rs:52`) y 5 tomas del mutex del store.

### 0.4 Verificación geométrica: qué pasa de verdad

```
13:24:24  verificación geométrica: 12 candidatos, 1 verificadores, 12 veredictos,
          máximo 78 inliers (umbral 200), salida Ok(Some(0))
```

`analysis_agents` tiene **0 filas** en toda la historia de la base. Ningún agente ha
emitido nunca un veredicto.

---

## Parte 1 — Por qué los agentes nunca corren

### Diagnóstico

Los agentes **sí arrancan**: el log muestra que llegan a importar `transformers`.
Mueren en el `timeout`:

```
crates/lumid/src/agentar.rs:22
pub const LIMITE: Duration = Duration::from_secs(120);
```

La causa es que corren en frío **en cada análisis**. `agentar.rs:50` consulta un
ajuste que por defecto es falso:

```rust
let persistente_activo = store.get_meta("agentes_persistente").as_deref() == Some("1");
```

Con la clave ausente se toma el camino `correr()` (`agentar.rs:104-112`), que lanza un
`python3` nuevo, y ese proceso muere al terminar. `lumi_agentes.py` cachea los motores
en `_motores` (`lumi_agentes.py:63-77`), pero el caché muere con el proceso.

`mini` pide 4 agentes; `pro`, 10; `vision`, los 12 del registro. Cada uno carga su
motor desde cero: Qwen3-VL desde dos shards `.safetensors` (`lumi_motores.py:73-78`),
PaddleOCR, Depth Anything V2. **Solo la carga se come los 120 s.**

El mismo defecto afecta a la verificación (`verificar.rs:60`,
`verificacion_persistente`). El embebedor es el único de los tres que sí es
persistente siempre (`queue/mod.rs:446-460`) — y es el único que no da problemas.

### Por qué esto también es el bug de rendimiento

La verificación y los agentes corren en paralelo (`tokio::join!`, `queue/mod.rs:710`),
así que el análisis no termina hasta que **el más lento** acaba. Como los agentes
siempre agotan sus 120 s, **el `timeout` es el camino crítico de todos los análisis**.

Arreglar los agentes recorta el tiempo de análisis de ~180 s a ~40 s. Es el mismo
cambio.

### Arreglo

1. **Invertir el defecto de persistencia.** Que la clave ausente signifique
   *activado* en máquinas con GPU: `!= Some("0")` en vez de `== Some("1")`, en
   `agentar.rs:50` y `verificar.rs:60`, más el defecto de `routes/rendimiento.rs:22`.
   El mecanismo (`persistente.rs`) ya está escrito, probado y relanza si el hijo muere.
2. **Subir `LIMITE` a 300 s** solo para el primer arranque, o mejor: distinguir
   «tiempo de carga» de «tiempo de respuesta» y aplicar el `timeout` únicamente al
   segundo.
3. **Pasar `LUMI_DEVICE` a los agentes.** Hoy `agentar.rs:87` solo pasa
   `LUMI_REGISTRO_AGENTES` y `LUMI_PESOS`; `lumi_agentes.py:47-54` decide por su
   cuenta y siempre acaba en `cuda:0`. La verificación sí lo recibe
   (`verificar.rs:177`). En una caja multi-GPU, un análisis en `cuda:1` manda sus
   agentes a molestar a `cuda:0`.

**Coste de VRAM:** con persistencia activada, RoMa + DINOv2-L + Qwen3-VL +
PaddleOCR + DepthAnything quedan residentes junto a los 4–8 modelos del embebedor.
Este es el riesgo real del cambio y va acompañado de la política de VRAM de la
Parte 4.

---

## Parte 2 — Por qué la catedral da 1,7 km

### Diagnóstico

El análisis #51 (`mini`) dio centroide `42.59892,-5.57714`, radio **1924 m**,
confianza 3.0, sin respaldo geométrico. La catedral **sí está en el índice**: hay 24
imágenes de referencia a menos de 150 m de ella, de 15.005 totales.

Son dos fallos encadenados:

**(a) La verificación geométrica no salvó a nadie.** Máximo 78 inliers contra
`UMBRAL_INLIERS = 200` (`lumi-index/src/arbitro.rs:47`). `arbitrar()` devuelve `None`
para todos, así que `queue/mod.rs:768` toma el camino de respaldo: usar los 12
candidatos crudos, sin filtrar.

**(b) Con 12 candidatos crudos, `en_grupos()` los funde en uno solo.**
`lumi-index/src/agrupar.rs:52` agrupa por **adyacencia de tesela z14** con
transitividad y vecindad-8. Una tesela z14 a latitud 42,6° mide **1,80 km**. En un
corpus urbano denso —15.005 imágenes, todas en León— *cualquier* conjunto de
candidatos repartidos por la ciudad forma **una sola isla**.

Un grupo → el centroide es la media ponderada de los 12 → el radio es la dispersión
de los 12 → 1924 m. Y un solo grupo significa además que `confianza()` no tiene con
qué comparar, que es el bug del 10,0× que ya se topó a 3,0.

**El candidato correcto probablemente estaba ahí, y se promedió con 11 equivocados.**

### El principio que se viola

Cuando el sistema no sabe, **inventa un promedio** en vez de decir «tengo 12 sitios
posibles». En una herramienta forense eso es lo contrario de lo que debe hacer.

### Arreglo

1. **El respaldo no debe fundir.** En `queue/mod.rs:768`, cuando `vivos` está vacío
   (ningún candidato verificado), cada candidato debe ser **su propia hipótesis**, no
   entrar en el agrupador. El investigador ve 12 alternativas sin verificar, que es la
   verdad, en lugar de un círculo de 2 km que no significa nada.
2. **Agrupar por distancia real, no por vecindad de tesela.** `en_grupos()` debe usar
   un radio en metros (~150 m) o teselas z17 (~225 m). El comentario de cabecera de
   `agrupar.rs:4-7` defiende z14 con el argumento de que «dos fotos en teselas
   contiguas están en el mismo sitio por definición del formato» — eso es cierto para
   la *cobertura* del formato, pero falso como criterio de *identidad de lugar*: 1,8 km
   no es «el mismo sitio» en ninguna lectura razonable.
3. **Revisar `UMBRAL_INLIERS`.** El umbral 200 se calibró contra 16 pares reales
   (`arbitro.rs:29-46`, positivos 126–2920, negativos 55–143). Con `tiny-roma` sobre
   la catedral el máximo es 78: por debajo incluso de los negativos medidos. Eso
   sugiere que el problema no es el umbral sino **la recuperación** — que el top-12 de
   `cosplace` no trae la catedral. Hay que distinguirlo antes de tocar el umbral, y
   bajarlo sin distinguir sería introducir falsos positivos.

### Cómo distinguir (experimento, antes de tocar nada)

Encolar la misma foto en `pro` (4 recuperadores en vez de 1, 2 verificadores reales
en vez de 1) y mirar si el top-12 trae alguna de las 24 imágenes de referencia de la
catedral. Si las trae → el fallo es de `tiny-roma`/umbral. Si no → el fallo es de
recuperación y ningún arreglo de verificación lo va a salvar.

---

## Parte 3 — Por qué la app va lenta

Tres capas, cada una multiplicando a la siguiente.

### 3.1 Base de datos (la raíz)

Ver §0.2. **157 ms por escritura, serializados para toda la app.**

- `store.rs:283-310` configura únicamente `busy_timeout` y `foreign_keys = OFF`.
  Nunca se activa WAL.
- `store.rs:280` — una sola `Connection` bajo `Mutex`.
- **Faltan 6 índices.** El peor: `reference_images(quadkey, lat, lng)`, usado en
  `queue/mod.rs:949-952` con `WHERE quadkey=? AND lat=? AND lng=?` — hoy son **hasta
  12 escaneos completos de 15.005 filas por análisis**. Faltan también
  `analyses(state)` (lo consulta cada muestra de telemetría),
  `analyses(requested_by)`, `images(uploader_id)`, `project_members(user_id)`,
  `sessions(user_id)`.
- **Cero `spawn_blocking` alrededor de un acceso a base** en todo `routes/**` (hay 37
  usos, todos para NVML/Argon2/imágenes). Con `worker_threads = 2`
  (`main.rs:80`), una sola operación bloqueante consume el 50 % del ejecutor. El
  comentario de `main.rs:76-79` afirma que «el trabajo que de verdad bloquea corre en
  el pool de `spawn_blocking`» — **esa premisa hoy es falsa**, porque el trabajo que
  de verdad bloquea es la base.
- **N+1 en los handlers calientes:** `routes/analyses.rs:118-122` hace 3 consultas por
  análisis (un caso de 40 análisis = 121 consultas y 121 `prepare()` con el mutex
  agarrado); `routes/admin.rs:141-151` hace 151 tomas del mutex para listar 50
  usuarios. El patrón correcto ya existe en el repo, en `routes/projects.rs:70-99`,
  documentando este mismo problema.

**Evidencia negativa útil:** no hay ningún `std::sync::Mutex` retenido a través de un
`await`. El compilador lo impide (`MutexGuard` no es `Send`). Ese frente está limpio.

### 3.2 El bucle de la cola se para entero

`queue/mod.rs:585-599`:

```rust
loop {
    tokio::select! { Some(ev) = rx_ev.recv() => self.aplicar(ev).await, ... }
    self.revisar();
    self.repartir_ahora();
}
```

`aplicar()` con un `Evento::Vectores` hace `recuperar::candidatos().await` (red contra
Qdrant) y `tokio::join!(verificar, agentar)` **inline**: hoy, 186 segundos. Durante
todo ese rato el bucle no llama a `revisar()` ni `repartir_ahora()` y **no consume
`rx_ev`**: los eventos de progreso de otros trabajadores se encolan sin atender, y una
GPU libre no recibe trabajo.

Es el síntoma «la barra de progreso se queda parada».

**Arreglo:** `tokio::spawn` del post-proceso. El `soltar()` del trabajador ya se hace
antes (`queue/mod.rs:698`); falta que el bucle también quede libre.

### 3.3 Telemetría: coste multiplicado por cliente y por sesión

- **En el servidor:** `sample()` reinicializa NVML (8,3 ms), reenumera discos y toca la
  base 5 veces — **por muestra, por cliente, cada segundo**.
- **En el cliente:** los SSE se abren duplicados y no se cierran nunca. En
  `client/src-tauri/src/main.rs`, `start_telemetry` (:527), `start_queue_events`
  (:624), `start_indices_events` (:667) y `start_admin_events` (:720) hacen
  `tokio::spawn` **sin abortar el handle anterior**. El único que se deduplica es
  `start_logs_stream` (:64, :763, :794), que sí guarda `logs_task`. Los otros tres
  llevan además `loop { … }` de reconexión infinita, así que una tarea vieja no muere
  sola.

  `announcePresence()` (`lib/bridge.ts:26-32`) se llama desde cuatro sitios
  (`App.tsx:140`, `LoginForm.tsx:62`, `ChangePasswordForm.tsx:35`,
  `AdminStep.tsx:39`): cerrar sesión y volver a entrar duplica telemetría y cola.
  `startAdminEvents` (`AdminEventToast.tsx:32`) se llama en cada montaje del panel:
  entrar y salir de Administración N veces = N conexiones vivas.

**Este es el mecanismo exacto del "a veces".** Empeora cuanto más rato lleva la sesión
abierta y cuántas más veces has entrado y salido del panel. Cada conexión duplicada
añade un `sample()` por segundo en el servidor —con sus 5 tomas del mutex que cuesta
157 ms por escritura— y un `setSample` por segundo en el cliente.

### 3.4 El cliente repinta entero una vez por segundo

`App.tsx:89` — `useServer((s) => s.sample)` en el componente raíz, y **ningún hijo está
memoizado**. Cada muestra de telemetría repinta `TitleBar`, `PlanetBackground`,
`CaseView`, `AdminPanel`, `MapCanvas`… La única lectura real de `sample` en `App` es
`sample?.maintenance` (línea 321).

Multiplicadores que lo encarecen:
- `#root` entero dentro de un `transform: scale()` hasta 1.65 (`index.css:53-55`) más
  42 usos de `backdrop-blur`: cada render se rasteriza al tamaño ampliado.
- `PlanetBackground` sigue animando debajo del mapa (`App.tsx:303`), donde
  `MapCanvas` pinta encima un fondo **opaco** (`MapCanvas.tsx:454-455`). Cinco
  `radial-gradient` apilados girando en bucle de 70 s que no se ven.
- El globo hace `jumpTo` a 60 fps mientras hay un análisis corriendo
  (`MapCanvas.tsx:385-390`), pidiendo teselas nuevas sin parar — justo cuando el
  usuario más espera respuestas del servidor.

### 3.5 Miniaturas y teselas ahogan a la API

Todo lo visual pasa por el esquema `lumi://` (`client/src-tauri/src/main.rs:806-865`)
usando **el mismo cliente reqwest** que la API (`main.rs:498`). Y `lumid` **no negocia
HTTP/2** (el único `alpn_protocols` del repo es el de QUIC, `quic.rs:31`): HTTP/1.1
puro, una conexión TCP+TLS nueva por petición concurrente.

`work/Dock.tsx:109` monta un `<img>` por imagen del caso **sin virtualización ni
límite**: un caso de 200 imágenes son 200 peticiones concurrentes al montar. Y la
respuesta del esquema (`main.rs:851-860`) no pone `Cache-Control` ni `ETag`, así que
el webview no cachea nada entre montajes.

Esto es literalmente «las solicitudes tardan bastante en cargar»: un `api.get()`
disparado mientras se pinta el Dock se pone a la cola detrás de decenas de handshakes.

### 3.6 Sondeos solapados en el panel de administración

| Fichero:línea | Intervalo | Endpoint |
|---|---|---|
| `admin/QueueRow.tsx:25` | **2 s** | `GET /v1/queue` |
| `admin/ModelToasts.tsx:24` | 3 s | `GET /v1/admin/model-task` |
| `App.tsx:188` | 3 s | `GET /v1/hello` |
| `admin/AdminPanel.tsx:50` | 4 s | `GET /v1/admin/actualizacion` |
| `admin/DoctorView.tsx:101` | 10 s | `GET /v1/admin/telemetry/salud` |

`QueueRow` sondea `/v1/queue` cada 2 s **aunque ese dato ya llegue por SSE**
(`ColaView.tsx:38-42` escucha `ColaCambio`). Y `AdminPanel.tsx:57` pide
`/v1/admin/resumen` que `ResumenView.tsx:100` **vuelve a pedir**.

---

## Parte 4 — Acelerar los modelos

### 4.1 El VLM re-procesa la misma imagen una vez por etiqueta

`lumi_motores.py:96-102`:

```python
for etiqueta in etiquetas:
    entrada = self.proc(text=[texto + etiqueta], images=[img], return_tensors="pt")
    salida = self.red(**entrada, labels=entrada["input_ids"])
```

Cada etiqueta re-corre el preprocesado **y la torre de visión completa** de Qwen3-VL
sobre los mismos píxeles. En `pro` son ~54 forwards donde caben ~9. Además
`Image.open` se repite por agente (`lumi_motores.py:88`): la misma foto se decodifica
9–12 veces.

**Arreglo barato y sin riesgo:** apilar las N etiquetas de un agente en un solo batch
(`text=[texto+e for e in etiquetas], images=[img]*N`). Mismos logits, mismo resultado,
un lanzamiento en vez de N.

**Bonus de corrección:** `labels=entrada["input_ids"]` calcula la NLL **media sobre
toda la secuencia**, tokens de imagen y de prompt incluidos. La confianza que sale de
ahí está diluida y **penaliza sistemáticamente las etiquetas largas**. Enmascarar el
prompt a `-100` es más rápido *y* más correcto.

### 4.2 Qwen3-VL sin tope de resolución

`lumi_motores.py:75` — `AutoProcessor.from_pretrained(d)` sin `min_pixels`/`max_pixels`.
Resolución dinámica: una foto de 12 MP se convierte en miles de tokens visuales, y ese
coste se paga 54 veces. El resto del pipeline sí tiene tope (`LADO_MAX = 640` en
verificación, 322 en el embebedor); los agentes son el único sitio sin él.

Riesgo bajo para agentes de escena; medio para `matricula` y `senalizacion`. El texto
ya lo cubre PaddleOCR, no el VLM.

### 4.3 La imagen de consulta se redimensiona 24 veces

`lumi_verify.py:236` y `:270` — dentro del doble bucle de `_verificar` (`:315-325`), la
**misma** foto de consulta se abre, convierte a RGB y reescala con LANCZOS una vez por
(candidato × verificador): 24 veces en `pro`, 48 en `vision`.

Peor: `_inliers_disperso` (`:278-282`) vuelve a extraer los keypoints ALIKED de la
consulta en cada uno de los 12 candidatos. Esos keypoints no dependen del candidato.

**Riesgo nulo.** Es cachear un valor idéntico por construcción.

### 4.4 Verificación en cascada

Hoy `lumi_verify.py:315-325` corre **todos** los verificadores sobre **todos** los
candidatos: en `pro`, `roma` (denso, caro) sobre los 12 y `lightglue-aliked` (disperso,
barato) sobre los 12.

Correr primero el barato sobre los 12 y el caro solo sobre los mejores recortaría
mucho. **Pero no con `UMBRAL_INLIERS` como puerta** —eso descartaría al candidato que
LightGlue no ve y RoMa sí, que es justo donde el denso gana (cambio de estación, obra,
noche)— sino con un top-K por ranking del barato.

El registro ya declara el coste: `tipo: "denso"/"disperso"/"semi-denso"` en
`registros/verificadores/*.json`.

Esto merece su propio diseño y su propia validación. **No entra en la primera tanda.**

### 4.5 Afinado fino

- **fp32 puro en los verificadores.** No hay `autocast` ni `half()` en ningún punto de
  `lumi_verify.py`, mientras que el embebedor sí lo hace (`lumi_pesos.py:232`).
  Riesgo medio-alto: RoMa alimenta `findFundamentalMat` con
  `ransacReprojThreshold=0.2` (¡0,2 px!, `lumi_verify.py:249`). Probar **bfloat16** (no
  fp16) y validar contra los cuatro números de control que ya están en el docstring de
  `_inliers` (`:224-229`). Si se mantienen, seguro; si no, se descarta.
- **`torch.cuda.empty_cache()` por par** (`lumi_verify.py:329-340`): 24 veces en `pro`.
  Sincroniza el dispositivo y devuelve los bloques al driver, convirtiendo cada
  iteración en un arranque frío del asignador. Dejarlo solo al final, más un
  `except OutOfMemoryError` que reintente una vez.
- **Depth Anything V2 en fp32** (`lumi_motores.py:190`) mientras el VLM va en fp16
  (`:76-77`). Asimetría que parece olvido. Importa por VRAM, no por tiempo.
- **`lumi_geo.py` no limita los hilos de torch**, aunque `lumi_embed.py:96-105` sí lo
  hace y su comentario dice que sin eso «el pc va fatal». Con tres procesos Python
  simultáneos, cada uno cogiendo todos los núcleos, esto muerde al daemon y al cliente.
- **`set_float32_matmul_precision("highest")`** (`lumi_verify.py:110`) es de **proceso**,
  no local a RoMa: el comentario de `:107-109` afirma un aislamiento que no existe. No
  degrada nada hoy (es el defecto de PyTorch), pero con persistencia activada queda
  puesto para siempre. **Corregir al menos el comentario.**
- **Un verificador que falla se reintenta 12 veces** (`lumi_verify.py:317-328`):
  `_cargar` solo cachea los éxitos. Un fallo posterior al hash provocaría 12 SHA-256
  completos de un fichero de GB. Cachear también los fallos, como ya hace
  `lumi_agentes._motor` (`lumi_agentes.py:66-77`).

### 4.6 Descartado, con motivo

- **`torch.compile`**: las entradas de verificación tienen forma variable
  (`_redimensionar` conserva la relación de aspecto, `lumi_verify.py:194-202`) →
  recompilación por forma. En el embebedor las formas sí son fijas, pero son 4–8
  forwards por análisis: no amortiza.
- **TensorRT/ONNX**: RoMa con kernel Triton propio y Qwen3-VL con resolución dinámica
  no son exportables sin romper la cadena de sha256/licencia que estructura el
  proyecto. Fuera de `ponytail` por un margen amplio.
- **`channels_last`**: solo ayudaría a los backbones convolucionales, y los caros son
  todos ViT.
- **Bajar `VECINOS`/`A_VERIFICAR`**: `VECINOS = 64` es una consulta HNSW, milisegundos.
  Bajar `A_VERIFICAR` es perder recall directamente; la cascada (§4.4) consigue el
  mismo ahorro sin perderlo.
- **Caché de embeddings de referencia**: ya existe por diseño (los vectores viven
  precalculados en los `.lumidx`).

---

## Parte 5 — Hallazgo 0: no hay forma de medir nada de esto

No existe una sola instrumentación de tiempo por fase. `verificar.rs:136-144` registra
*cuántos* veredictos y el máximo de inliers, pero no cuánto tardó. `agentar.rs` no
registra tiempo ninguno.

La consecuencia práctica es real y está en el repo ahora mismo: `lumi_verify.py:124-125`
dice «27 s por par, medido» y `docs/superpowers/specs/2026-08-13-motor-5b-design.md:76`
dice «150–600 ms» para el mismo verificador. **Dos órdenes de magnitud de
contradicción, y nadie puede resolverla sin cronometrar a mano.**

Los datos de §0.1 acotan la respuesta por arriba —un `pro` entero tarda 204 s de
media, así que 12 pares no pueden costar 27 s cada uno— pero no la cierran.

**Antes de tocar los modelos**: tres `Instant::now()`/`elapsed()` en `verificar::afinar`,
`agentar::preguntar` y alrededor del `Evento::Vectores` de `queue/mod.rs:649`, volcados
al `tracing::info!` que ya existe en cada sitio. Media hora, y convierte todas las
estimaciones de la Parte 4 en números.

Existe además un instrumento ya construido y hoy silenciado: el **latido** de
`main.rs:177-192`, que mide la deriva de planificación del ejecutor. Su categoría de log
está en `error` por defecto (`logging.rs:48`). Ponerla en `info` desde Doctor → Logs y
mirar el campo `retraso` mientras se reproduce la lentitud da la medida objetiva de si
el ejecutor pasa hambre. Su comentario dice `// ponytail: quitar una vez cazado` — **no
procede quitarlo todavía; es el instrumento de medida del arreglo.**

---

## Plan de ejecución

Ordenado por relación impacto/riesgo, no por tema. Cada tanda es un commit.

### Tanda 1 — Casi gratis, impacto alto

| # | Cambio | Fichero | Esfuerzo |
|---|---|---|---|
| 1 | WAL + `synchronous=NORMAL` | `store.rs:301` | 2 líneas |
| 2 | Los 6 índices que faltan | `store.rs` (`SCHEMA`) | 6 líneas |
| 3 | Invertir el defecto de persistencia de agentes y verificación | `agentar.rs:50`, `verificar.rs:60`, `rendimiento.rs:22` | 3 líneas |
| 4 | Deduplicar los 4 SSE (patrón `logs_task`) | `client/src-tauri/src/main.rs` | copiar 4 veces |
| 5 | Estrechar el selector de `sample` | `App.tsx:89` | 1 línea |
| 6 | Instrumentar tiempos por fase (Hallazgo 0) | `verificar.rs`, `agentar.rs`, `queue/mod.rs` | media hora |

Esperado: análisis de ~180 s → ~40 s; escrituras de 157 ms → 4,6 ms; fin del
crecimiento de coste con la duración de la sesión.

### Tanda 2 — Corrección de resultados

| # | Cambio | Fichero |
|---|---|---|
| 7 | Sin verificación, cada candidato es su propia hipótesis (no fundir) | `queue/mod.rs:768` |
| 8 | Agrupar por distancia real (~150 m), no por vecindad z14 | `agrupar.rs:52` |
| 9 | Experimento: la misma foto en `pro`, ver si el top-12 trae la catedral | — |

### Tanda 3 — Rendimiento estructural

| # | Cambio | Fichero |
|---|---|---|
| 10 | `tokio::spawn` del post-proceso de `Vectores` | `queue/mod.rs:649` |
| 11 | NVML una vez + telemetría en un broadcast único | `telemetry.rs:9`, `routes/telemetry.rs` |
| 12 | Cliente reqwest aparte + semáforo para `lumi://`, más `Cache-Control` | `client/src-tauri/src/main.rs:806` |
| 13 | Colapsar los N+1 de `analyses::list` y `admin::list_users` | `routes/analyses.rs:118`, `routes/admin.rs:141` |
| 14 | `QueueRow` por SSE en vez de sondeo; quitar el `/resumen` duplicado | `admin/QueueRow.tsx:25`, `ResumenView.tsx:100` |
| 15 | No montar `PlanetBackground` en `mode === "case"`; globo a 20 fps | `App.tsx:303`, `MapCanvas.tsx:385` |

### Tanda 4 — Modelos (después de la instrumentación)

| # | Cambio | Fichero |
|---|---|---|
| 16 | Cachear `_redimensionar` y los keypoints de la consulta | `lumi_verify.py:236`, `:278` |
| 17 | `_limitar_hilos()` en los cuatro `main()` | `lumi_pesos.py`, los cuatro workers |
| 18 | Cachear también los fallos de `_cargar` | `lumi_verify.py:317` |
| 19 | `LUMI_DEVICE` a los agentes | `agentar.rs:87`, `lumi_agentes.py:47` |
| 20 | Batch de etiquetas del VLM + máscara del prompt | `lumi_motores.py:96` |
| 21 | Tope de píxeles del VLM | `lumi_motores.py:75` |
| 22 | `empty_cache()` una vez por trabajo; `torch_dtype` en DepthAnything | `lumi_verify.py:329`, `lumi_motores.py:190` |

### Fuera de esta tanda, con diseño propio

- **Verificación en cascada** (§4.4) — la mayor ganancia potencial, pero cambia la
  semántica del arbitraje. Necesita validación contra los pares de control.
- **bfloat16 en los verificadores** (§4.5) — validar contra los cuatro números del
  docstring de `_inliers` antes de aceptarlo.
- **Pool de conexiones SQLite** — el prerrequisito es WAL (Tanda 1 #1). Solo cuando el
  volumen lo justifique; hoy 2,6 MB y 36 análisis no lo justifican.
- **ALPN `h2` en `lumid`** — multiplexa y elimina de raíz el problema de §3.5, pero
  toca el transporte.
- **Un proceso persistente por dispositivo** — la salida que el propio
  `persistente.rs:19-21` ya apunta para cuando haya varias GPUs.

---

## Nota sobre el orden

La Tanda 1 tiene una propiedad que la separa del resto: **son seis cambios de una o
dos líneas cada uno, todos reversibles, y entre los seis está el 80 % de la ganancia.**
Nada de la Tanda 1 cambia una decisión de diseño; solo corrige defectos que no
sobrevivieron al contacto con datos reales.

La Tanda 2 sí cambia una decisión de diseño (la agrupación por tesela z14), y por eso
va acompañada del experimento #9: sin saber si la recuperación trae la catedral, no se
puede saber si el arreglo de agrupación basta.
