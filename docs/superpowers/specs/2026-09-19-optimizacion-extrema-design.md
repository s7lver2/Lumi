# Optimización extrema: cliente, daemon y workers

## Resumen

Auditoría de rendimiento de arriba a abajo de los tres subsistemas de Lumi Station
(cliente Tauri/React, daemon `lumid`, workers Python), pedida por el dueño como
«sacar hasta la última gota de rendimiento». Este documento es el volcado completo:
cada medida encontrada, con su evidencia, su coste y cómo medirla.

**El punto de partida importa:** el spec [2026-09-09-rendimiento-y-precision-design.md]
(2026-09-09-rendimiento-y-precision-design.md) ya atacó este mismo problema con
mediciones del servidor real, y **está aplicado casi entero: 20 de sus 24 ítems
numerados están HECHOS** (Tandas 1 y 3 completas). Este spec no lo repite: recoge lo
que quedó vivo de aquél y lo suma a lo que aparece mirando el código con ojos nuevos.

Diagnóstico en una frase por subsistema:

- **Cliente** — bien optimizado en lo que se tocó, pero **la mitad del paquete de
  arranque es un motor de mapas que la pantalla de login no usa**, y hay dos bugs de
  rendimiento reales (marcadores del mapa, pincel de blur).
- **Daemon** — estructuralmente sano, con **un cuello único y transversal**: una sola
  `Connection` de SQLite bajo `std::sync::Mutex`, tocada 210 veces, casi siempre
  inline en `async` con 2 hilos de runtime.
- **Workers** — donde está el orden de magnitud: **81 pases de un modelo de 8B por
  análisis donde caben ~7**. Y dos defectos que hacen que los agentes probablemente
  no corran en absoluto.

**Hallazgo incómodo, el mismo patrón que en septiembre:** dos de los defectos más
graves de esta auditoría no son de rendimiento. `bitsandbytes` no se instala en
ninguna parte pero el motor VLM lo exige, y los ids de agentes de `mini`/`pro` son
los del diseño anterior al rediseño del 2026-09-17. Si ambos se confirman en la
máquina real, **los agentes no están emitiendo ni un veredicto**, y eso explica la
queja de calidad del dueño sin necesidad de culpar al modelo. Optimizar 81 pases de
un modelo que no carga, en niveles que no piden agentes, sería trabajo tirado.

---

## Parte 0 — Qué queda vivo del spec del 2026-09-09

Verificado ítem por ítem contra el código de hoy (`main`, HEAD `127aba5`).

Rastro de commits que lo respalda: `3299972` (Tanda 1: WAL, índices, SSE duplicados),
`7cc29e8` (Tanda 2: umbral por verificador, agrupación por distancia real), `9c6c282`
(Tanda 3: post-proceso fuera del bucle, telemetría deduplicada, N+1) y `420db00`
(Tanda 4, **etiquetada «parcial» por su propio autor** — y lo que quedó fuera de ese
commit es exactamente lo que aquí se marca pendiente: el batch de etiquetas y el tope de
píxeles). **El ítem 11 no tiene commit:** en su lugar entró `f961d1f`, el timeout de
agentes configurable, que es paliativo y no el cambio propuesto.

| Estado | Cuenta |
|---|---|
| HECHO | 20 |
| PARCIAL | 1 (ítem 22, batch del VLM: la máscara sí, el batch no) |
| PENDIENTE | 2 numerados (11, 23) + 5 aplazados |
| YA NO APLICA | 1 (24b, DepthAnything salió del catálogo) |

Lo aplicado y **medido** que no hay que volver a tocar: WAL + `synchronous=NORMAL`
(`store.rs:363-364`, 34× sobre la base real), los 6 índices, `OOMPolicy=continue` en
los dos instaladores, la deduplicación de los 4 SSE, NVML montado una vez + canal
`watch`, `tokio::spawn` del post-proceso de `Vectores`, los N+1 de `analyses::list` y
`admin::list_users` colapsados, `QueueRow` por SSE, el umbral de inliers por
verificador, la agrupación por distancia real (150 m), y la instrumentación de tiempos
por fase.

Lo que sigue vivo, por gravedad:

| # | Defecto | Evidencia | Va a |
|---|---|---|---|
| V1 | Persistencia de agentes y verificación **apagada por defecto** | `agentar.rs:93`, `verificar.rs:73`, `routes/rendimiento.rs:26` — los tres `== Some("1")` | §4 W4 |
| V2 | VLM **sin tope de resolución** | `lumi_motores.py:54` `AutoProcessor.from_pretrained(d)` pelado | §4 W6 |
| V3 | **Sin batch de opciones**, y el rediseño contrastivo duplicó los pases | `lumi_motores.py:126-130` | §4 W2 |
| V4 | Verificación **sin cascada**, todos × todos | `lumi_verify.py:391-407` | §7 |
| V5 | **fp32 puro** en los verificadores | cero `autocast`/`bfloat16`/`half()` en `lumi_verify.py` | §7 |
| V6 | **HTTP/1.1 sin ALPN `h2`** | `quic.rs:31` es el único `alpn_protocols` del repo | §7 |
| V7 | Una sola `Connection` bajo `Mutex` + `worker_threads = 2` | `store.rs:367`, `main.rs:96` | §3 D1 |
| V8 | Comentario falso sobre `set_float32_matmul_precision` | `lumi_verify.py:118` (el ajuste es de **proceso**, no local) | §4 W12 |

**Dependencia externa sin resolver:** el ítem V1 se aplazó en septiembre porque el
techo de memoria de WSL estaba en 8 GB (`~/.wslconfig` del dueño, fuera del repo). No
se puede verificar desde aquí. **Es la primera pregunta que hay que responder antes de
ejecutar nada de este spec.**

---

## Parte 1 — Mediciones reales de esta auditoría

Todo lo de esta sección se ejecutó de verdad el 2026-09-19 en `E:\Lumi Station`
(Windows 11, sin GPU, sin venv del proyecto). Lo que no se pudo medir está en §8.

### Cliente

| Qué | Valor |
|---|---|
| `npm run build` completo (`tsc -b && vite build`) | **22,8 s** (de los cuales `vite build` 4,97 s, 205 módulos) |
| `dist/assets/index-*.js` | **2 086,98 kB** / **574,00 kB** gzip |
| `dist/assets/mapbox-gl-*.js` (ya aislado) | 1 825,31 kB / 501,20 kB gzip |
| `dist/assets/index-*.css` | 135,41 kB / 22,62 kB gzip |
| `maplibre-gl/dist/maplibre-gl.js` minificado | **1 056 837 bytes** (276 059 gzip) |
| — como fracción del chunk de arranque | **51 % en bruto, 48 % en gzip** |
| Ficheros de fuente Inter emitidos | **28** (`.woff2` **y** `.woff`), ~430 kB |
| `npx tsc -b --noEmit` | exit 0, limpio |
| `React.lazy` / `Suspense` en `client/src` | **0 ocurrencias** |
| `await import(...)` | **2**, ambas en `mapEngine.ts:40-41` |
| `setInterval` activos | 12 |
| Ficheros con `backdrop-blur` | 20 (máx. `MapCanvas.tsx`, 4 usos) |
| Líneas totales de `client/src` | 19 042 |
| Ficheros mayores | `ImageEditorPopup.tsx` 818 · `CaseView.tsx` 730 · `MapCanvas.tsx` 635 |

Aviso literal de Vite: *«Some chunks are larger than 500 kB after minification»*. Solo
hay **dos** chunks de JS en todo el build.

### Daemon

| Qué | Valor |
|---|---|
| `cargo build --release -p lumid --timings` (incremental) | **2 m 25 s** |
| — compilar `lumid` solo | **100,42 s** |
| Binario `target/release/lumid.exe` | **21 109 248 bytes** (20,1 MiB), sin `strip`, sin LTO |
| Unidades de compilación / crates en el grafo | **360** / **273** |
| Artefactos de `aws-lc-sys` en `target/release/build/` | 4 directorios, **~48 MB** |
| `cargo test -p lumi-proto` | **17 passed, 0 failed**, 3,19 s |
| Líneas de `crates/lumid/src` | **17 086** en 71 ficheros |
| Llamadas a `.conn()` (mutex global) | **210** |
| `.prepare(` / `.prepare_cached(` | **48** / **0** |
| `query_row(` | **111** |
| Transacciones explícitas | **2** |
| `CREATE INDEX` en el esquema | **13** |
| Usos de `tower_http::` en el código | **0** (la dependencia está declarada y no se usa) |
| `[profile.release]` en el repo | **ninguno** |
| Duplicados en el grafo | `getrandom`, `rand`, `rand_core`, `chacha20`, `cpufeatures`, `hashbrown`, `thiserror`, `syn` |

### Workers

| Qué | Valor |
|---|---|
| `import torch` en frío | **7,64 s** (torch 2.3.1+cpu) |
| `import torch` en caliente | 4,84 / 4,81 / 5,24 s |
| Intérprete Python vacío | 0,14–0,16 s |
| SHA-256, caché caliente | **787 MB/s** |
| Ficheros de `workers/` | 16 scripts, **2 602 líneas** |
| Agentes reales en el registro | **8** |
| De ellos en modo `eleccion` / opciones totales | 7 / **40** |
| Candidatos que llegan a verificación | **12** (`A_VERIFICAR`) |
| `bitsandbytes` en todo el repo | **0 coincidencias** |
| Desajuste de ids agentes↔niveles | **confirmado** en `mini.json` y `pro.json` |

**Derivado del código (no medido):** en nivel `vision`, **81 pases del VLM por
análisis** (40 con imagen + 40 sin imagen + 1 `generate`), **160 llamadas al
`AutoProcessor`** y **8 decodificaciones PIL de la misma foto**.

---

## Parte 2 — Cliente

### C1. `maplibre-gl` entero en el chunk de arranque — **ALTO / coste bajo**

`client/src/work/mapEngine.ts:1` lo importa de forma estática, y ese import se propaga
`MapCanvas.tsx:6` → `CaseView.tsx:24` → `App.tsx:31`. `mapbox-gl` **sí** está partido
con `await import()` (`mapEngine.ts:40`) y vive en su propio chunk; `maplibre-gl` no.

Resultado medido: **el motor de mapas completo está dentro de `index-*.js`**, que se
parsea y compila antes del primer pintado — en la pantalla de login, en el wizard, en
el panel de administración y en el selector de proyectos, donde no hay ningún mapa.
Son 1 057 kB de los 2 087 kB del arranque. En una app de escritorio el fichero está en
disco, así que el coste no es de red: es **parse + compile de ~1 MB de JS en el hilo
principal de WebView2**.

**Medida:** `React.lazy(() => import("./MapCanvas"))` dentro de `CaseView`, con un
`<Suspense>` que reutilice el `radial-gradient` que ya pinta `MapCanvas.tsx:574`. El
import estático de `maplibregl` puede quedarse tal cual: al colgar de un módulo
dinámico, Rolldown ya lo saca a su propio chunk.

**Riesgo:** medio-bajo pero real. `MapCanvas` es frágil con el tamaño del contenedor
(ver su comentario en `:576-585` sobre el mapa negro) y montarlo un tick más tarde
cambia cuándo mide su caja. El `ResizeObserver` (`:295`) y el vigía de lienzo 0×0
(`:238`) son justo la red para esto.

**Medir:** `npm run build` antes/después; en runtime, `performance.mark` en `main.tsx`
contra el primer `useEffect` de `App`.

### C2. Panel de administración y TipTap en el arranque — **ALTO / coste bajo**

Dos costes apilados:

- `AdminPanel.tsx:1-23` importa las 20 vistas de administración estáticamente, y
  `App.tsx:16` importa `AdminPanel`. Un investigador no-admin nunca abre ninguna y paga
  su parse.
- Peor: `ui/NotificationsPopover.tsx:230` importa `AvisoEditor` (TipTap) **para
  renderizar un aviso en solo lectura**, y `NotificationsPopover` cuelga de `TitleBar`,
  que se monta para todo el mundo, siempre (`App.tsx:393`). Es un editor WYSIWYG
  completo cargado en arranque para pintar texto que nadie va a editar.

**Medida:** (1) `React.lazy` sobre `AdminPanel` en `App.tsx:466`; (2) `React.lazy`
sobre `AvisoEditor`. La opción correcta pero más cara es un render de solo lectura del
JSON de TipTap (es un árbol `{type, content, marks}`, ~40 líneas para los nodos que
`StarterKit` produce) y reservar TipTap para `editable={true}`.

**Esperado:** entre C1 y C2, el chunk de arranque debería bajar de 2 087 kB a un orden
de 500-700 kB. *[ESTIMADO]*

### C3. El mapa recrea TODOS sus marcadores en cada render de `CaseView` — **ALTO / coste muy bajo**

`MapCanvas.tsx:342-370` tiene `onMarker` en las dependencias del efecto, y
`CaseView.tsx:548` lo pasa como lambda anónima creada en el JSX. Su identidad cambia en
cada render de `CaseView`, así que el efecto entero se vuelve a ejecutar: quita cada
marcador del DOM (`:345`), construye un `HTMLElement` nuevo por marcador con `cssText`
completo (`:131`), crea un `gl.Marker`, registra un `click` nuevo (`:350`), corre
`repartirSolapados` (`:362`) y desregistra/reregistra el listener de `move`
(`:368-369`).

Y `CaseView` re-renderiza mucho: **cada evento `progreso` del SSE** llama a
`setProgresoFase` (`CaseView.tsx:244`) — exactamente el evento que el daemon emite
repetidamente mientras un análisis avanza, que es justo cuando el mapa está animando el
globo y el usuario está mirando.

`markers` y `flyTo` **sí** están memoizados (`:468`, `:512`), lo que demuestra que la
intención era evitar esto. `onMarker` es el que se coló y anula la memoización de los
otros dos, porque el efecto depende de los tres.

**Medida:** guardar `onMarker` en un `useRef` dentro de `MapCanvas` y sacarlo de las
dependencias (patrón «callback ref»). Se prefiere sobre el `useCallback` en el llamante
porque hace a `MapCanvas` inmune a este error para siempre — que es el fallo que ya se
cometió una vez.

**Síntoma que arregla:** microtirones del mapa durante un análisis, y el parpadeo de
los marcadores (cada recreación los devuelve a `offset [0,0]` hasta que
`repartirSolapados` vuelve a correr).

### C4. El pincel de blur difumina la imagen ENTERA en cada `pointermove` — **ALTO / coste bajo**

`ImageEditorPopup.tsx:265-285` (`aplicarBlurEn`), llamada desde `:333` en
`onPointerMove`. Por cada evento de puntero (~60/s tras el coalescing de Chromium):
crea un `<canvas>` a la **resolución nativa** de la foto, le aplica
`filter: blur(radio)` sobre la imagen completa, y luego recorta a un círculo de `radio`
px. El canvas temporal se descarta cada vez.

Es decir: se desenfoca una foto de 12-24 MP completa ~60 veces por segundo para pintar
un círculo de 24 px. **Es la fuente de jank más cara del cliente por evento.**

**Medida:** crear el offscreen y difuminarlo **una sola vez** al empezar el trazo;
cada `pointermove` pasa a ser solo `clip()` + `drawImage(off)`, un blit. Efecto
secundario positivo: hoy cada pincelada difumina lo ya difuminado, así que la
intensidad depende de lo despacio que muevas el ratón — un artefacto, no una intención.

**Cuidado:** invalidar el cacheado tras `aplicarRecorte`, `girar`, `aplicarTono` y
`deshacer`/`rehacer`.

### C5. Historial del editor: 20 snapshots PNG síncronos — **MEDIO-ALTO / coste trivial**

`ImageEditorPopup.tsx:112` y `:178`, con `PROFUNDIDAD_HISTORIAL = 20` (`:7`). Cada
snapshot codifica **en PNG sin pérdida, en el hilo principal y de forma síncrona**, la
foto entera, y la guarda como string base64.

El comentario `ponytail` de `:21-27` ya reconoce el problema y propone deltas. **Apunta
a la salida equivocada:** el problema dominante no es el tamaño del snapshot, es el
formato y la sincronía.

**Medida (una línea):** `toDataURL("image/jpeg", 0.92)`. Es el mismo formato y calidad
con el que el editor **ya** exporta el resultado final (`:565`), así que no se pierde
nada que el flujo no fuera a perder igual, y el string es entre 5× y 15× más pequeño y
mucho más rápido de codificar. JPEG no tiene canal alfa; el editor trabaja sobre fotos
opacas, así que no aplica.

### C6. `avisos` viaja en cada muestra de telemetría — **MEDIO / transversal**

Este es el mismo defecto visto desde los dos lados, y por eso va junto:

- **Cliente:** `lib/api.ts:112-121` — `Sample.avisos: AvisoInfo[]` con
  `contenido: unknown` (documento TipTap completo). `NotificationsPopover.tsx:60` hace
  `useServer((s) => s.sample?.avisos ?? SIN_AVISOS)`, que devuelve un **array nuevo cada
  segundo** (objeto `sample` nuevo ⇒ propiedad nueva), así que el popover re-renderiza
  una vez por segundo sin que haya cambiado nada. `App.tsx:91-99` documenta haberse
  defendido exactamente de esto con selectores primitivos; aquí el selector devuelve un
  array y no puede.
- **Daemon:** `telemetry.rs:94-149` — `avisos_para` trae **todos** los avisos y para
  cada uno con `destino == "personas"` llama a `incluye_a` (`:140-149`), **otra consulta
  con su propio `conn()`**: N+1 clásico. Además hace `serde_json::from_str` del documento
  Tiptap por aviso (`:113`). Todo eso **una vez por segundo y por cliente conectado**,
  bajo el mutex global.

Los avisos los crea un admin y cambian una vez cada días. Se retransmiten 86 400 veces
al día.

**Medida ponytail (solo cliente):** en `store.ts`, que `setSample` conserve la
referencia del array anterior si el contenido es igual (comparar `length` + mayor `id`).
Con eso el selector deja de disparar.
**Medida correcta (protocolo, toca `lumi-proto`):** sacar `avisos` de `Sample` y darles
su propio evento, o un `avisos_version: u64` que el cliente use para pedir `/v1/avisos`
cuando suba. En el daemon, resolverlos **una vez al abrir la conexión SSE** —igual que
ya se hace con `visto_por` (`routes/telemetry.rs:16`)— y refrescar solo con el
`broadcast` que ya existe (`App.admin_eventos`).

**Cuidado:** la memoria del proyecto ya registra un bug en esta zona («los avisos
vuelven a no leído al reiniciar»), así que merece cuidado extra.

### C7. `/v1/hello` sondeado cada 3 s en paralelo al SSE — **MEDIO / coste bajo**

`App.tsx:214-255`: un `invoke("request")` → TLS anclado → `GET /v1/hello` **cada 3
segundos durante toda la sesión** (1 200/hora por cliente). Su propósito es detectar
«el servidor sigue vivo» y leer `locked` e `inactivity_timeout_s`. Pero el SSE de
telemetría ya prueba exactamente eso cada segundo, con más resolución y sin handshake,
y `App.tsx:114-117` ya lo escucha. **Los dos mecanismos miden lo mismo.**

**Ponytail (dos líneas):** subir el intervalo de 3 s a 10 s y resetear el contador de
fallos con cada `telemetry` recibido. `KICK_AFTER_MS` ya es de 2 minutos, así que
detectar una caída hasta 7 s más tarde no cambia nada para el usuario.
**Correcta:** añadir `locked` e `inactivity_timeout_s` a `Sample` y dejar el sondeo solo
como reserva cuando el SSE esté caído — el evento `telemetry-down` de `main.rs:792` es
la señal exacta. Toca `lumi-proto`.

### C8. Resto del cliente, por orden

| # | Hallazgo | Evidencia | Impacto | Coste |
|---|---|---|---|---|
| C9 | `backdrop-blur-xl` permanentes sobre fondos casi opacos. El del `Drawer` está activo incluso con el cajón fuera de pantalla. `rgba(16,18,21,.92)` es ya casi opaco: el blur detrás de un 92 % de opacidad es invisible y cuesta lo mismo | `index.css:55-60`, 20 ficheros con `backdrop-blur` | Medio (GPU integrada, ventanas grandes) | Bajo — **pero es cambio visual, requiere ojo del dueño y DESIGN.md manda** |
| C10 | `MediaDrawer` monta su rejilla de miniaturas aunque el cajón esté cerrado; sin `loading="lazy"` | `CaseView.tsx:604-626`, `Drawer.tsx:25-34`, `MediaDrawer.tsx:297-320` | Medio-bajo | Bajo |
| C11 | Subsets de Inter: 28 ficheros emitidos, `.woff2` **y** `.woff`. WebView2 y webkit2gtk soportan woff2 desde siempre | `index.css:6-7` | Bajo en runtime, medio en tamaño del instalador | Trivial — riesgo cosmético si algún dato trae cirílico/griego |
| C12 | `Thumb` del `Dock` sin `React.memo`; seis props recreadas por render en `CaseView` | `Dock.tsx:68-73`, `:93`, `CaseView.tsx:638-646` | Bajo-medio | Bajo — memoizar `Dock` entero no serviría mientras `summary` sea un literal nuevo por render |

---

## Parte 3 — Daemon (`lumid`)

### D1. SQLite se usa desde `async` sin `spawn_blocking` — **ALTO / el de más superficie**

`store.rs:326`, `:370-372` (`Store(Mutex<Connection>)`, `conn()`) y sus **210**
llamantes. `conn()` devuelve un `MutexGuard` de `std::sync::Mutex`, así que **toda
consulta corre inline en el hilo del runtime**, y el runtime tiene **2 hilos fijados a
mano** (`main.rs:96`).

Dos consecuencias que se suman:

1. Mientras un handler espera el mutex o ejecuta la consulta, ese hilo de Tokio no
   atiende **ninguna** otra tarea. Con 2 hilos, dos consultas simultáneas lentas paran
   el daemon entero — incluido el bucle de la cola y los SSE.
2. Un `MutexGuard` de `std::sync` no es `Send`, así que el compilador ya impide
   sostenerlo a través de un `.await` (ver `routes/admin.rs:419-422`, donde tuvieron que
   reordenar por esto). Eso protege del interbloqueo pero **no** del bloqueo del
   executor, que es el problema real.

El propio código reconoce el peligro dos veces (`routes/auth.rs:103-110`: «podía dejar
sin hilos libres a todo el runtime»), pero la solución aplicada fue acotar el *scope*
del guard, no sacar la consulta del executor.

**Medida:** mantener SQLite y el mutex (ponytail: el volumen es bajo, un pool sería
complejidad sin causa) pero **envolver el acceso** en un helper
`Store::leer<T>(&self, f) -> T` con `tokio::task::spawn_blocking`. Migrar por tandas,
empezando por los caminos calientes: los dos middlewares (D2), `require_session`,
`guard_case`, `images::serve`. **Paso 0 gratis:** subir `worker_threads` de 2 a
`num_cpus` — el 2 viene de una VM de 2 CPUs, y una caja con GPU tiene más núcleos.

**Riesgo:** `spawn_blocking` obliga a `'static`, así que algún handler necesitará clonar
ids antes de entrar.

**Medir:** compilar con `--features console` (ya existe, `Cargo.toml:47`) y mirar el
*poll time* máximo por tarea en tokio-console. Sin dependencias: el latido de
`main.rs:197-212` ya imprime el retraso frente a 2 s —
`journalctl -u lumid | grep latido` y comparar el percentil de `retraso` bajo carga.

### D2. Los middlewares globales hacen 3 consultas en CADA petición — **ALTO / coste bajo**

`mantenimiento.rs:152-177` y `zero_trust.rs:133-165`, colgados de todo el router en
`main.rs:412-414`. Por **cada** petición HTTP, antes de llegar al handler:

- `zero_trust_gate` → `denylist(&app)` → `prepare()` + `SELECT ip FROM ip_denylist
  ORDER BY added_at` (`zero_trust.rs:43-50`). **Esto pasa siempre, con Zero Trust
  apagado.** Y el SQL se construye con `format!` en cada llamada, así que ni siquiera
  puede cachearse el statement.
- `zero_trust_gate` → `get_meta("zero_trust")` → otro `SELECT`.
- `mantenimiento_gate` → `get_meta("mantenimiento")` → otro `SELECT`.

Son 3 adquisiciones del mutex global **antes** de que el handler empiece, para leer tres
valores que cambian una vez al mes. Después, el handler típico vuelve a pagar:
`guard_case` (`routes/cases.rs:16-23`) son **3 consultas más**.

Camino real de `GET /v1/images/:id/thumb`: **6 round-trips a SQLite bajo el mismo mutex
global** para servir un JPEG de 320 px que ya está en disco. Y la galería y el mapa
disparan decenas de esas peticiones seguidas.

**Medida:** cachear los tres flags detrás de un `ArcSwap`/`RwLock` (o un
`tokio::sync::watch`) invalidado desde sus cuatro escritores conocidos
(`mantenimiento::set_activo`, `zero_trust::set_zero_trust`, `security::add_deny`…).
**Que la caché viva en el mismo módulo que los setters**, no en `App` directamente: si
se olvida invalidar en uno, el modo mantenimiento no se aplica hasta reiniciar.

**Medir:** `hyperfine`/`ab` contra `/v1/hello` (pasa por ambos middlewares y no hace
casi nada más) con 1 y con 50 conexiones concurrentes. La diferencia entre ambas
concurrencias **es** la serialización del mutex.

### D3. Sin `[profile.release]` en todo el repo — **MEDIO-ALTO / coste bajo**

No existe ninguna sección `[profile.release]` ni en el workspace, ni en
`crates/lumid/Cargo.toml`, ni en un `.cargo/config.toml` (verificado). Por defecto:
`lto = false`, `codegen-units = 16`, `strip = "none"`. Con `codegen-units = 16` y sin
LTO, el optimizador nunca ve más de 1/16 del crate a la vez: no hay inlining entre
unidades ni devirtualización a través de los límites de crate. Para un binario con 273
crates en el grafo, es dinero de rendimiento tirado en la acera.

**Medida:** un perfil **aparte**, no tocar `release`:

```toml
[profile.dist]
inherits = "release"
lto = "thin"
codegen-units = 1
strip = "symbols"
```

y que `tools/build.py build` lo use para empaquetar, dejando `release` limpio para el
día a día (hoy el incremental ya son 2 m 25 s; `lto` + `cgu=1` lo doblaría o más, y eso
choca de frente con el ciclo de desarrollo).

**`panic = "abort"`: NO.** Hoy un `panic` en un handler de axum mata esa petición y el
servidor sigue; con `abort` mata el daemon entero. Con systemd reiniciándolo *puede* ser
aceptable, pero no es gratis y merece decisión explícita del dueño. Recomendación:
`lto` y `strip` sí, `panic = "abort"` no.

### D4. `aws-lc-rs` se compila entero y no se usa — **ALTO en compilación, CERO en runtime**

`crates/lumid/Cargo.toml:21` declara `rustls = "0.23"` **con features por defecto**, lo
que activa el proveedor criptográfico `aws-lc-rs` → `aws-lc-sys`, una biblioteca
C/ensamblador que se compila con `cmake` + `cc` desde su `build.rs`. Pero `main.rs:103`
instala explícitamente `rustls::crypto::ring::default_provider()`: **todo ese código se
compila, se enlaza y no se ejecuta nunca**. Medido: 4 directorios en
`target/release/build/`, **~48 MB** de artefactos.

**Medida:** `rustls = { version = "0.23", default-features = false, features = ["ring",
"std", "tls12", "logging"] }`, y comprobar uno a uno que `axum-server`, `reqwest` y
`quinn` no lo reactiven por unificación de features
(`cargo tree -p lumid -i aws-lc-rs -e features`). **Validación final:** `cargo tree -p
lumid -i aws-lc-rs` debe decir «no encontrado», y el daemon debe arrancar de verdad —
si alguna dependencia lo necesitaba, el arranque del TLS entra en pánico, que es justo
lo que documenta `main.rs:98-102`.

### D5. N+1 en el reparto de la cola: 4 consultas por usuario cada 2 s — **MEDIO-ALTO / coste bajo**

`queue/mod.rs:1669-1710` (`duenos`), llamado desde `:1449` (`repartir_ahora`) y `:399`
(`foto`). `duenos()` itera los usuarios con trabajo pendiente y por **cada uno** llama a
`limits::effective`, que es `global()` + `overrides()`, y cada uno es un `prepare()` +
`query_map()` con su propio `conn()`. Más las 2 consultas explícitas de `duenos`:
**4 round-trips por usuario, por reparto**. Y `repartir_ahora` corre como mínimo cada
2 s (`TICK_S`, `:24`).

`global()` **no depende del usuario**. El repo ya identificó este patrón y lo arregló en
`routes::admin::list_users` (comentario de `limits.rs:98-102`, `overrides_de_todos`),
pero **no se aplicó aquí**, que es el camino caliente de verdad.

Además `notificar_posiciones` (`:1418-1430`) llama a `plan::posicion` por candidato, y
`posicion` reordena la lista **entera** cada vez: **O(n² log n) por tick**. Con 200
pendientes son 200 ordenaciones de 200 elementos cada 2 s. (Solo con
`progreso_detallado_activo` — y ese flag se consulta con un `get_meta` en cada tick.)

**Medida:** (1) leer `global` y `overrides_de_todos` **una vez** fuera del bucle,
aplicando con `limits::apply` (ya es `pub(crate)` exactamente para esto): pasa de 4·N a
2 + 1·N. (2) Un solo `SELECT ... GROUP BY requested_by` en vez del `COUNT(*)` por
usuario. (3) En `notificar_posiciones`, llamar a `plan::ordenados` una vez y recorrer
con `.enumerate()`.

`plan.rs` tiene tests que fijan la política (`la_politica_de_reparto`,
`la_posicion_sigue_el_mismo_orden_que_repartir`), así que estos tres cambios están
protegidos.

### D6. Tres índices SQLite ausentes — **MEDIO hoy, ALTO a futuro / coste trivial**

| Índice ausente | Consulta que lo necesita |
|---|---|
| `analysis_images(image_id)` | `routes/media.rs:206`, `routes/images.rs:503`, `:517` — la PK `(analysis_id, image_id)` **no sirve de prefijo** para filtrar por el segundo campo |
| `analyses(created_at)` o `(requested_by, created_at)` | `routes/admin.rs:453`, `routes/auth.rs:398`, `:405` |
| `media_folders(case_id)`, `media_folders(project_id)` | `routes/media.rs:64`, `:66` |

El propio `store.rs:104-106` documenta exactamente este razonamiento para
`project_members` y crea el índice; aquí se olvidó. `analisis_desincronizados` lo llama
el panel Media, potencialmente una vez por imagen visible.

Con un servidor recién instalado no se nota; en una instalación con meses de análisis
el escaneo crece linealmente y, **como corre bajo el mutex global, el coste lo pagan
todas las peticiones, no solo esta**.

**Medir:** `EXPLAIN QUERY PLAN` contra una `lumi.db` real — debe pasar de
`SCAN analysis_images` a `SEARCH ... USING INDEX`.

### D7. `reqwest::Client` nuevo por tesela de mapa — **ALTO en latencia del mapa / coste bajo**

`routes/map.rs:161-166` (`outbound`), llamado en `:348`, `:387`, `:481` y `:529`. El
propio comentario de `:158-160` ya lo admite: *«ponytail: el techo es un mapa muy usado;
ahí conviene un cliente compartido en `App`»*. **Ese techo ya se alcanzó**: el mapa es
la pantalla principal de la vista de trabajo.

Cada `Client::builder().build()` crea un pool de conexiones nuevo, un `ClientConfig` de
rustls nuevo y un resolutor DNS nuevo. Como el pool muere con el cliente, **no hay
keep-alive posible**: cada tesela que no esté en caché paga un handshake TLS completo
(≈100-300 ms contra `api.mapbox.com`). Un solo desplazamiento del mapa pide **decenas**
de teselas.

Lo mismo en `qdrant.rs:36-43`, instanciado por análisis en `recuperar.rs:47` — ahí el
destino es loopback sin TLS, así que el coste es mucho menor, pero sigue sin reutilizar
conexiones entre las varias consultas de un mismo análisis.

**Medida:** un `reqwest::Client` en `App` (es `Clone` y barato, internamente un `Arc`), o
un `static OnceLock<Client>` en `map.rs`. Es literalmente el arreglo que el comentario
del código ya recomienda.

### D8. `GET /v1/projects` agrega las tablas `images` y `cases` enteras — **MEDIO / coste bajo**

`routes/projects.rs:70-100`. Las dos subconsultas derivadas de `:77-83` **no llevan
filtro**: SQLite materializa el agregado de **todas** las imágenes de **todos** los
proyectos del servidor, incluidos los de otros usuarios, y solo después hace el
`LEFT JOIN` que se queda con los del usuario. Es la primera pantalla tras el login, y
escala con el tamaño **total** del servidor, no con el del usuario — justo lo que no
debe pasar.

**Medida:** empujar el filtro dentro de las subconsultas, correlacionándolas con
`project_members WHERE user_id = ?1 AND status = 'accepted'`. El índice
`project_members_by_user` ya existe (`store.rs:106`). Verificar con `EXPLAIN QUERY PLAN`
que SQLite no materializa igual.

### D9. Resto del daemon, por orden

| # | Hallazgo | Evidencia | Impacto | Coste |
|---|---|---|---|---|
| D10 | `sobrescribir` decodifica y hashea la imagen **inline** en el hilo async, a diferencia de `upload` y `upscale` que sí usan `spawn_blocking` y lo documentan. Además adquiere `conn()` **tres veces** para una operación atómica | `routes/media.rs:250` → `routes/images.rs:73`, `:87`, `:79/:94/:101` | Medio (alto cuando ocurre: cuelga medio daemon 1-3 s) | Muy bajo, 3 líneas |
| D11 | Faltan PRAGMAs: `cache_size` sigue en el defecto de **2 MB** con `reference_images` de millones de filas; `mmap_size` en 0; `temp_store` en disco para los `GROUP BY` de D8 | `store.rs:347-364` | Medio; **alto en `reference_images`**, que está en el camino crítico de cada inferencia | Trivial — **pero `mmap_size` no rinde igual en WSL2: medirlo en el host del dueño, no asumirlo** |
| D12 | **0 usos de `prepare_cached`** en todo el daemon frente a 48 `prepare` y 111 `query_row`. Para un `SELECT` por PK, el `prepare` cuesta más que la ejecución. El caso peor es `zero_trust.rs:45`, que además interpola el nombre de tabla con `format!` (y eso es una inyección latente, aunque hoy los llamantes sean literales) | `routes/images.rs:141`, `limits.rs:29`, `telemetry.rs:103`, `zero_trust.rs:45` | Bajo-medio, pero pega donde el mutex es el cuello: menos tiempo con el guard agarrado | Trivial, misma firma |
| D13 | `find_python()` lanza un `std::process::Command::output()` **síncrono** desde el bucle async de la cola | `queue/mod.rs:68-81` ← `:471`, `:236`; mismo patrón en `queue/worker.rs:263-265` | Bajo-medio — pero coincide con el peor momento: acaba de caerse una GPU | Muy bajo — **cachear solo el fallback**, no `interprete_python` (el comentario de `:50-56` explica por qué se recalcula: el venv puede instalarse en caliente) |
| D14 | N+1 en `recuperar::candidatos`: 12 `query_row` en el camino crítico de la inferencia, con el guard sostenido durante los 12 | `recuperar.rs:90-113` | Bajo en latencia absoluta, medio en p99 del resto de la API | Bajo — conservar el orden RRF con un `HashMap` |
| D15 | Sin compresión HTTP y **sin `ETag`**. Peor: la imagen completa se marca `immutable` pero **sí se reescribe** (`sobrescribir_bytes`) — tras un «Sobrescribir» el cliente sigue enseñando la vieja durante un año. Eso es **un bug de caché**, no solo rendimiento | `Cargo.toml:23` (tower-http declarado y sin usar), `routes/images.rs:563-569`, `map.rs:504-511` | Medio sobre WAN, bajo en LAN; el `ETag` es corrección | Bajo — **pero hay que excluir los 6 endpoints SSE y las rutas de bytes ya comprimidos (JPEG/PNG/PBF)**, y ahí está el riesgo real |
| D16 | `foto()` (`GET /v1/queue`) hace N+1 **con el mutex de `estado` agarrado**: un admin abriendo la página de Cola para a la cola de verdad mientras se pinta. Anidar el mutex de SQLite dentro del de `estado` es además un orden de adquisición peligroso | `queue/mod.rs:358-436`, N+1 en `:380` dentro del `lock()` de `:370` | Bajo-medio — sube por el riesgo de corrección, no por la latencia | Bajo |

---

## Parte 4 — Workers

### W1. `labels=` materializa el tensor de logits completo en cada pase — **ALTO**

`lumi_motores.py:101-106`. Pasar `labels` a un modelo de `transformers` hace que el
`lm_head` se aplique a **todas** las posiciones de la secuencia y que la pérdida se
calcule sobre el vocabulario entero, con el upcast a fp32 de `CrossEntropyLoss`. Con
Qwen3-VL (vocab ≈ 151 936) y una secuencia que con imagen se va a 1 000-2 000 tokens, el
tensor de logits solo son `1500 × 151936 × 2 B ≈ 456 MB` en fp16, más su copia fp32
(≈912 MB). Eso se asigna y se libera **80 veces por análisis**, y de todo ese trabajo
solo interesan los 2-8 últimos tokens.

Es, con diferencia, el mayor desperdicio del pipeline: tiempo de GEMM del `lm_head`,
ancho de banda de memoria, y picos de VRAM que son **justo los que obligaron a cuantizar
a 4 bits «para que quepa»**.

**Medida:** sustituir `labels=` por `logits_to_keep=n_verbalizador + 1` (soportado por
Qwen2/2.5/3-VL) y calcular la suma de log-probabilidades a mano con `log_softmax` sobre
esas pocas posiciones. El número resultante es el mismo que hoy, sin el rodeo por
`loss × n`.

**Riesgo bajo pero no nulo:** hay que comprobar el alineamiento de índices (los logits
de la posición `t` predicen el token `t+1`).

**Medir:** `torch.cuda.max_memory_allocated()` alrededor de un `_log_verosimilitud` y
`perf_counter` sobre los 80 pases, antes y después. Confirmar que las confianzas de un
lote de control no cambian más allá del ruido de fp16.

### W2. 40 pases con imagen que deberían ser 7 — **ALTO**

`lumi_motores.py:126-130` → `:88-102`. Para un agente con K opciones, el prompt y la
imagen son **idénticos** en las K llamadas; lo único que cambia es el sufijo. Hoy cada
opción llama dos veces al `AutoProcessor` con la imagen (preprocesado completo, dos
veces) y hace un forward **entero, torre de visión incluida**.

Para `escritura` (10 opciones) son 20 preprocesados y 10 pases completos de la torre de
visión sobre el mismo JPEG. Sumando los 7 agentes de elección: **40 ejecuciones de la
torre de visión sobre la misma foto**.

**Medida, dos niveles:**
- *Ponytail*: un forward del prefijo por agente con `use_cache=True`, guardar
  `past_key_values`, y puntuar cada verbalizador como continuación desde esa caché.
  7 prefijos + 40 sufijos cortos: la torre de visión corre **7 veces en vez de 40**.
  `n_prefijo` también se calcula una vez por agente, no una por opción.
- *Completo*: codificar la imagen **una sola vez por orden** (los 8 agentes miran la
  misma foto) y reutilizar los `image_embeds`. La torre corre **1 vez por análisis**.

**Riesgo:** el ponytail es medio (cuidar el recorte de la caché entre opciones). El
completo toca `pixel_values`/`image_grid_thw` a mano y es frágil entre versiones de
`transformers` — **no hacerlo hasta tener W1 y el ponytail de W2 medidos.**

### W3. Los 40 pases «sin imagen» son constantes y se recalculan — **ALTO / ~10 líneas**

`lumi_motores.py:129`. `texto_sin_imagen` depende solo de `agente["pregunta"]` y
`verbalizador` solo de la ficha: **no dependen de la imagen en absoluto**. Son 40
forwards por análisis cuyo resultado es idéntico en todos los análisis de la vida de la
instalación, mientras no se edite el JSON del agente.

**Medida:** cachear en memoria del proceso (`(agente_id, opcion_id) -> float`) y, si se
quiere, persistir junto a los pesos con clave `sha256(pregunta+verbalizador+motor_id)`.
Invalidación trivial: el hash cambia si cambia el texto. **Es el arreglo más barato y
menos arriesgado de los tres.** Interacción a cuidar: la caché de floats debe sobrevivir
al desalojo del motor por `purgar_inactivos`.

### W4. Agentes y verificación NO persistentes por defecto — **ALTO / decisión, no código**

`agentar.rs:93`, `verificar.rs:73`, `routes/rendimiento.rs:26`. En configuración de
fábrica, cada análisis lanza un `python3` nuevo que paga intérprete + `import torch`
(**7,64 s en frío medidos**) + `import transformers` + lectura de los `.safetensors` del
8B + construcción del modelo + SHA-256 de los pesos (W5). El propio `agentar.rs:24-37`
lo documenta: «un VLM en frío sin el modo persistente se come casi todo el valor por
defecto solo en cargar» — es decir, **casi los 120 s de timeout**.

Es el ítem V1: el mecanismo existe, está probado y `ac7d5d8` arregló su último fallo.
Lo que falta es una decisión.

**Medida:** que el defecto deje de ser un booleano ciego y se derive de la memoria
disponible al arrancar (el daemon ya sabe leer hardware, subsistema 3c), o como mínimo
que el asistente lo active explícitamente cuando la caja tenga VRAM de sobra.

**Orden:** con W1 aplicado el pico de VRAM baja, así que este defecto se revisa
**después** de W1, no antes. Y **requiere confirmar el techo de memoria de WSL primero.**

### W5. SHA-256 completo de los pesos en cada carga — **MEDIO-ALTO / ~20 líneas**

`lumi_pesos.py:194-207`, llamado desde tres sitios. Cada vez que se construye un
verificador o un embebedor se lee el fichero de pesos entero y se hashea. En `pro` son
`roma` + `dinov2-vitl14` + `lightglue-aliked` + `aliked-n16`; el backbone DINOv2-ViT-L14
solo ronda 1,2 GB. Como los procesos de verificación **no son persistentes por defecto**
(W4), se paga en **cada análisis**.

Medido aquí: **787 MB/s** con caché caliente → ~2,5 s por análisis para ~2 GB de pesos,
en el mejor caso. Desde disco frío, bastante más.

**Medida:** un sello `pesos/<id>/.verificado` con `(sha256_esperado, mtime, size)`. Si
coincide, se salta el rehasheo. **No se relaja la postura «sin sha256 no se carga»:** se
deja de repetir una comprobación cuyo resultado ya se conoce para ese inodo exacto.
Mitigación del escenario que la regla protege (peso sustituido con mtime forjado):
incluir `st_ctime` y revalidar completo cada N días.

### W6. Sin tope de resolución, sin `attn_implementation`, sin `inference_mode` — **MEDIO-ALTO**

`lumi_motores.py:54-67`, `:101`. Tres cosas distintas:

- **Sin `min_pixels`/`max_pixels`**, el procesador de Qwen-VL escala dinámicamente y
  puede generar **varios miles de tokens de imagen por pase**. El comentario de `:59-62`
  reconoce que «leer carteles obliga a subir la resolución», pero ese tope no está
  fijado en ningún sitio: es el que salga del `preprocessor_config.json` de HuggingFace.
  Es **la palanca más directa sobre el coste por pase y hoy no se controla**. Es el ítem
  V2, y es el único punto del pipeline sin techo (verificación tiene `LADO_MAX`, el
  embebedor 322).
- **Sin `attn_implementation` explícito** se depende del defecto de la versión de
  `transformers` instalada; en un prellenado de 1 000+ tokens de imagen esa diferencia
  es grande.
- `torch.no_grad()` en vez de `torch.inference_mode()`: diferencia pequeña pero gratis
  (`lumi_pesos.py:367` y `lumi_verify.py:285` ya usan `inference_mode`; aquí no).

**Cuidado:** el tope de píxeles es un cambio de una línea **con consecuencia directa en
calidad**. Hay que barrerlo (3-4 puntos: 256·28·28, 640·28·28, 1280·28·28) contra el
acierto de `escritura`/`toponimos`, no adivinarlo. Y debe ser **parámetro del registro
del motor**, no una constante hardcodeada — es exactamente la clase de valor que el
dueño ya señaló como problema.

### W7. La imagen se decodifica 8 veces por orden — **BAJO-MEDIO / ~5 líneas**

`lumi_motores.py:120` y `:145`: `Image.open(ruta).convert("RGB")` dentro de
`responder`/`transcribir`, es decir **una vez por agente**. `lumi_verify.py` ya resolvió
exactamente este problema con `cache_redim` (`:230-248`), pero esa lección no se
trasladó al trabajador de agentes.

**Medida:** decodificar una vez en `_procesar` y pasar el objeto `Image`. Viene incluido
si se aplica W2-completo.

### W8. `verificar::afinar` drena `stderr` hasta EOF antes de leer `stdout` — **riesgo de cuelgue**

`verificar.rs:116-121`. `read_to_string` sobre `stderr` no vuelve hasta que el hijo
cierra ese descriptor, es decir **hasta que muere**. Mientras tanto nadie lee `stdout`.
Si el trabajador escribe más de lo que cabe en el búfer de la tubería (64 KB típicos en
Linux) se bloquea escribiendo en `stdout` mientras el padre espera en `stderr`:
**interbloqueo**.

Con 12 candidatos × 2 verificadores son 24 líneas cortas, así que hoy no se alcanza —
pero es una bomba de relojería, y aun sin ella elimina cualquier solapamiento entre el
trabajo del hijo y el procesado del padre.

**Los otros dos puentes del repo ya lo hacen bien:** `Persistente::drenar_stderr`
(`persistente.rs:39-49`) y `agentar::correr` (`agentar.rs:241-248`). Este es el único
que no. **Copiar el patrón: ~10 líneas, riesgo nulo.** Un análisis colgado es peor que
un análisis lento.

### W9. Resto de los workers, por orden

| # | Hallazgo | Evidencia | Impacto | Coste |
|---|---|---|---|---|
| W10 | Qdrant se consulta **en serie**: un `await` por (modelo × versión), 8 viajes secuenciales en `vision`. Además el vector viaja como **JSON de texto** (~400 KB por consulta para `lumi-2`) | `recuperar.rs:52-83`, `qdrant.rs:117` | Bajo-medio; se nota si Qdrant está en otra máquina o en WSL | Bajo — `join_all` **conservando el orden de `listas`**, que sí afecta al RRF |
| W11 | El proceso persistente **serializa TODAS las peticiones** bajo un `Mutex`: dos análisis en dos GPUs distintas van en fila india. Y el proceso hereda `LUMI_DEVICE` del primer lanzamiento, así que un análisis en `cuda:1` manda sus agentes al `cuda:0` — el mismo bug que `agentar.rs:206-211` ya arregló para el modo NO persistente | `persistente.rs:110`, `:51-61`, `:12-21` | **Alto en caja multi-GPU** (el escenario «Lumi Vision»), nulo con una sola | Medio — la salida ya está escrita en el comentario: un `Persistente` **por dispositivo** |
| W12 | El comentario de `set_float32_matmul_precision("highest")` afirma un aislamiento que no existe: el ajuste es **de proceso**, y con persistencia activada queda puesto para siempre | `lumi_verify.py:118` | Ninguno hoy (es el defecto de PyTorch) | Trivial — **corregir al menos el comentario** (ítem V8, pedido ya en septiembre) |
| W13 | Vectores por fichero temporal con `struct.pack("<%df", *v)`: desempaqueta hasta 12 288 floats como argumentos posicionales, precedido de un `.tolist()` que ya los convirtió en objetos Python. Tres copias donde basta `t.numpy().astype('<f4').tobytes()` | `lumi_geo.py:122-126`, `lumi_pesos.py:370` | Bajo | Trivial — **sin romper el contrato de `vectores` con el Indexer** |
| W14 | `_prep()` reconstruye el `transforms.Compose` en cada lote, y el preprocesado es secuencial en CPU mientras la GPU espera | `lumi_pesos.py:311-317`, `:345-354` | Bajo en Station (1 imagen), **medio en el Indexer** (lotes de 16, millones de imágenes) | El `Compose` es trivial; el `DataLoader` choca con `_limitar_hilos` y tiene riesgo real de volver a «el pc va fatal» |
| W15 | Los registros JSON se releen y reparsean en cada orden; `_ficha` hace un barrido lineal del directorio con parseo completo | `lumi_agentes.py:38-52`, `lumi_pesos.py:165-175` | Bajo (unidades de ms) | **NO HACERLO** — releer 8 JSON de 1 KB no es un problema, y cachearlo rompe el «editar un JSON y nadie recompila nada» que `lumi_agentes.py:4-8` defiende como propiedad de diseño |

---

## Parte 5 — Correcciones que bloquean la optimización

Estas tres no son rendimiento. Van primero porque **optimizar un sistema que no hace lo
que cree hacer es trabajo tirado**.

### B1. `bitsandbytes` no se instala en ninguna parte, pero el motor VLM lo exige

`registros/motores/qwen3-vl.json` declara `"cuantizacion": "4bit"`, y
`lumi_motores.py:57-64` construye un `BitsAndBytesConfig`. Pero `grep -r bitsandbytes`
sobre **todo el repo** da **cero coincidencias**, y el único sitio que crea el venv
(`crates/lumid/src/tasks.rs:83-150`) instala torch, torchvision, romatch,
local-corr-lumi, safetensors, lightglue, transformers y accelerate — **y nada más**.

`BitsAndBytesConfig` se importa bien (es de `transformers`), pero `from_pretrained` con
`quantization_config` lanza `ImportError` en cuanto intenta cuantizar.
`lumi_agentes._motor` captura la excepción, escribe «motor vlm fuera: …» en stderr y
marca `_motores["vlm"] = None` **para toda la vida del proceso**.

**Consecuencia: 0 veredictos de agentes, siempre**, en cualquier caja donde no se
instalara `bitsandbytes` a mano.

**Dos caminos, y conviene elegir a la vez que W1:**
- añadir `bitsandbytes` al script del venv (`tasks.rs`), o
- **quitar la cuantización** y cargar en fp16. Con W1 aplicado, el 8B en fp16 son ~16 GB
  de pesos, que NO caben en una 4070 SUPER de 12 GB; el 4B en fp16 (~8 GB) sí. La
  disyuntiva real es **8B-4bit** (más lento por token: NF4 desempaqueta en cada GEMM)
  frente a **4B-fp16** (más rápido, menos capaz). **Medirlo antes de decidir**, en vez de
  heredar el 4-bit por inercia. `bitsandbytes` en Windows/WSL es además una fuente
  conocida de dolor, y el fp16 evita esa dependencia entera.

### B2. Los ids de agentes de `mini` y `pro` no existen: solo `vision` corre agentes

`registros/niveles/mini.json` y `pro.json` listan
`texto-en-escena`, `indicios-viales`, `condiciones-ambientales`, `hora-sombras`,
`escena`, `dimensiones` — los ids del diseño **anterior** al rediseño del 2026-09-17
(el propio docstring de `lumi_agentes.py:10-14` lo confirma). Los reales son
`escritura`, `hora-solar`, `lado-conduccion`, `matricula`, `meteorologia`,
`senalizacion`, `toponimos`, `vegetacion`.

`lumi_agentes.py:146` los filtra **en silencio**:
`pedidos = [fichas[i] for i in orden.get("agentes", []) if i in fichas]` → `pedidos`
queda vacío y el trabajador no escribe ni un `Msg::Agente`. `vision` tiene la lista
vacía, que significa «todos», así que es el único nivel que sí corre los 8.

**De rendimiento es engañosamente «positivo»:** `mini` y `pro` lanzan un proceso Python,
cargan (o intentan cargar) el VLM y no hacen nada con él. **De producto es ALTO:** dos de
los tres niveles no tienen agentes, y no lo dicen.

**Medida:** actualizar los ids. Y que `agentes_de` registre un aviso cuando un id pedido
no exista en el registro, en vez de que el filtro de Python lo trague — mismo espíritu
que el `reason` de la matriz de capacidades, que es la regla del proyecto: *nada se
desactiva en silencio*.

**Orden:** arreglar W1/W2/W3 **antes**, porque al arreglar esto `mini` y `pro` empezarán
a pagar el coste real de los agentes.

### B3. `lumi_upscale.py` llama a `cargar_motor` con la firma equivocada

`lumi_upscale.py:57` — `cargar_motor("upscalador", PESOS, disp)` frente a
`lumi_motores.py:188` — `cargar_motor(clase, motor_id, pesos_dir, dispositivo,
cuantizacion=None)`. Faltan argumentos: `motor_id` recibe `PESOS`, `pesos_dir` recibe el
dispositivo, `dispositivo` no recibe nada → `TypeError`, capturado en `:58` y degradado
a «motor upscalador fuera».

Hoy queda tapado porque `real-esrgan.json` no trae peso (`Upscalador.procesar` lanza a
propósito), así que el fallo se confunde con esa carencia declarada. **Se activará justo
el día que alguien rellene `fichero_url`/`sha256`.**

---

## Parte 6 — Lo que ya está bien: no tocar

Escrito explícitamente para que nadie gaste una vuelta ni «optimice» hacia atrás.

**Daemon:**
- WAL + `synchronous=NORMAL` (`store.rs:363-364`), puesto y **medido** (34×).
- Argon2id en `spawn_blocking` con el guard soltado antes (`routes/auth.rs:126`, `:141`,
  `:285`, `:292`).
- `procesar_imagen` en `spawn_blocking` en `upload` y `upscale` (la excepción es
  `sobrescribir`, D10).
- SSE de telemetría desmultiplicado con un `watch` (no `broadcast`: a cada conexión solo
  le interesa la última muestra) y NVML montado una vez.
- `Evento::Vectores` en `tokio::spawn` para no parar el bucle.
- `analyses::list` des-N+1-ado — es el patrón que falta aplicar en `queue::foto` y
  `queue::duenos`.
- `export_pdf` con tectonic en `spawn_blocking`.
- **El progreso NO se persiste** (`queue/mod.rs:674-676`). Es la decisión correcta y la
  documenta ARCHITECTURE.md. No convertir eso en escrituras.
- **La «doorbell» en SQLite sin Redis.** Correcta y deliberada. Nada de lo propuesto aquí
  necesita Redis.

**Cliente:**
- Selectores de zustand en `App.tsx:89-99`: estrechos y primitivos, con el razonamiento
  escrito.
- `mapbox-gl` con `await import()`: ya partido, ya es su propio chunk.
- Miniaturas pregeneradas a 320 px en el servidor: el cliente nunca pide la foto
  completa para una lista.
- El giro del globo (`MapCanvas.tsx:465-499`): ya bajado a 20 peticiones/s con `easeTo`
  lineal para que el compositor interpole. Mejor que la solución obvia.
- `PlanetBackground` no se monta en `case`.
- `AsciiWavesBackground` a ~11 fps respetando «reducir movimiento»; `WavesBackground` no
  se monta siquiera con esa preferencia activa, en vez de congelarse a mitad de bucle.
- **Animaciones:** todo lo que se anima en bucle usa `transform`/`opacity`. Los
  `transition-[width]` que hay son **barras de progreso** de 3-6 px de alto, una vez por
  dato, no en bucle. Convertirlos a `scaleX` sería **peor** (deforma bordes redondeados)
  por ganancia nula. **No cambiar.**
- **Sin virtualización:** correcto para los tamaños de lista de este producto (decenas a
  bajos cientos). No meter una librería de virtualización sin necesidad.
- **`repartirSolapados` (`MapCanvas.tsx:71-106`): absuelto.** Se evaluó expresamente. `n`
  está entre 1 y ~10 por el filtro `soloElMostrado` (`CaseView.tsx:475-481`); el BFS es
  100 `Math.hypot` en el peor caso, y `m.project()` se llama n veces, no n² — bien sacado
  del bucle. El problema real de ese bloque no es el cálculo: es **cuándo se re-registra
  el listener** (C3).
- `ServerPill` y `Franja` se suscriben al store entero y repintan cada segundo: es su
  trabajo, muestran telemetría en vivo, y son hojas pequeñas. No es un hallazgo.

**Workers:**
- `cache_redim` / `cache_feats_consulta` por tanda (`lumi_verify.py:389-401`).
- `_limitar_hilos()` en los cinco `main()`.
- Caché de **fallos** en `_cargar` (`lumi_verify.py:160-177`).
- `empty_cache()` una vez por trabajo, fuera del doble bucle, con el porqué comentado.
- `LUMI_DEVICE` pasado a los agentes en los dos caminos.
- La máscara `-100` del prefijo con la corrección de suma vs media
  (`lumi_motores.py:77-106`): el sesgo contra etiquetas largas quedó cerrado.
- El venv ya usa **`uv`**, no pip (el pendiente «migrar de pip a uv» ya está hecho en
  Station; queda revisar si el Indexer sigue con pip).
- PaddleOCR y Depth Anything salieron del catálogo en el rediseño: es un adelgazamiento
  real que ya se hizo.

---

## Parte 7 — Fuera de alcance, con diseño propio

No entran en este spec porque cambian semántica o transporte y merecen su propia
validación:

- **Verificación en cascada** (ítem V4). `lumi_verify.py:391-407` sigue corriendo todos
  × todos: `roma` denso sobre los 12 candidatos. El spec de septiembre concluyó que en
  `pro` el camino crítico **no** son los agentes sino la verificación (~15 s/par medidos,
  `roma` cerca de 27 s/par), y ese número no ha cambiado. **Con las Tandas 1-3 ya
  aplicadas, es probablemente la mayor palanca de tiempo que queda en `pro`.** Pero la
  puerta **no puede ser `UMBRAL_INLIERS`** —descartaría al candidato que LightGlue no ve
  y RoMa sí, que es justo donde el denso gana— sino un top-K por ranking del barato. El
  campo `tipo` (`denso`/`disperso`/`semi-denso`) ya está en las fichas y nadie lo lee
  para planificar.
- **bfloat16 en los verificadores** (V5). Cero `autocast`/`bfloat16`/`half()` en
  `lumi_verify.py` mientras el embebedor sí lo hace. Riesgo medio-alto: RoMa alimenta
  `findFundamentalMat` con `ransacReprojThreshold=0.2`. Validar contra los cuatro números
  de control del docstring de `_inliers`; si se mantienen, seguro; si no, se descarta.
- **Pool de conexiones SQLite** (V7). El prerrequisito (WAL) ya está. Hoy el volumen no
  lo justifica; D1 (`spawn_blocking`) ataca el mismo problema con mucha menos
  complejidad. Revisar solo si D1 resulta insuficiente.
- **ALPN `h2`** (V6). Multiplexa y elimina de raíz la ráfaga de handshakes, pero toca el
  transporte. El semáforo de 8 y el cliente aparte ya acotaron el daño.
- **`torch.compile` / TensorRT / ONNX.** Descartados con motivo en el spec de septiembre
  (formas variables, kernel Triton propio de RoMa, resolución dinámica de Qwen3-VL, y la
  cadena de sha256/licencia que estructura el proyecto). Solo reconsiderar `torch.compile`
  **después** de medir W1+W2, y aun así es el que más riesgo y más arranque añade.
- **El `transform: scale()` de `#root`** (`index.css:55-60`). `index.css:38-54` documenta
  que `zoom` ya se probó y se descartó por razones sólidas, y DESIGN.md manda sobre lo
  visual. **No proponer nada aquí sin hablar con el dueño.** Lo accionable y barato es
  solo C9 (auditar los `backdrop-blur-xl` permanentes).

---

## Parte 8 — Mediciones pendientes

### En la máquina con GPU (WSL/Linux), por lo que más decisión desbloquean

Todas sobre el mismo lote de fotos de control, guardando la salida para comparar calidad
además de tiempo.

1. **Confirmar que los agentes corren.** Una foto por nivel; leer del log
   `agentes: N pedidos, M veredictos, persistente=…, X.Xs` (`agentar.rs:142`). **Si
   `M == 0`, B1/B2 antes que cualquier optimización.**
2. **`import transformers` y carga completa del 8B**, en frío y en caliente, con el venv
   real. Es el número que decide W4.
3. **Perfil de un solo `_log_verosimilitud`** con `torch.profiler`/`torch.cuda.Event`:
   cuánto se va en la torre de visión, cuánto en el prellenado y cuánto en
   `lm_head`+pérdida. **Este es el número que ordena W1 frente a W2.**
4. **`max_memory_allocated()`** con `labels=` vs `logits_to_keep`. Cuantifica W1 en VRAM.
5. **Cuántos tokens de imagen produce hoy el procesador** (`input_ids.shape`,
   `image_grid_thw`) con una foto real. Sin ese número, W6 es a ciegas.
6. **Barrido de `max_pixels`** (3-4 puntos) contra acierto de `escritura`/`toponimos`.
   Esa curva **es** la decisión.
7. **8B-4bit vs 4B-fp16**: tokens/s en los pases y acierto en el lote de control. Decide B1.
8. **SHA-256 sobre los pesos reales de `pro`**, disco frío y caliente. Decide W5.
9. **Tiempo de `recuperar::candidatos`** (hoy sin instrumentar, a diferencia de
   `verificar::afinar` y `agentar::preguntar`). Decide W10.
10. **Dos análisis simultáneos en dos GPUs** con persistencia activada: confirma la
    serialización de W11 y la fuga de `LUMI_DEVICE`.
11. **Un verificador que escupa >64 KB por stderr**: confirma o descarta W8.
12. **`hyperfine`/`ab` contra `/v1/hello`** con 1 y con 50 conexiones. La diferencia
    entre ambas concurrencias **es** la serialización del mutex (D1, D2, D12).
13. **`EXPLAIN QUERY PLAN`** de las tres consultas de D6 contra una `lumi.db` real.
14. **`mmap_size` en el host real** (D11): no rinde igual en WSL2 ni en discos de red.

### En el repo, antes de atacar el bundle

- **Desglose real de `index-*.js` por dependencia.** `rollup-plugin-visualizer` no está
  instalado y no se instaló. Los tamaños de §1 permiten atribuir con confianza el trozo
  de `maplibre-gl` (comparable al chunk aislado de `mapbox-gl`), pero **no** repartir con
  precisión los ~1 030 kB restantes entre React, TipTap/ProseMirror y código propio.
  Cómo: `npm i -D rollup-plugin-visualizer`, añadirlo a `plugins` con
  `{ gzipSize: true, brotliSize: true }`, un `npm run build`, leer el treemap. Es una
  dependencia de desarrollo y un fichero que se borra después. **Merece la pena una vez
  antes de C1 y C2, para no optimizar a ciegas.**
- **`cargo clean && time cargo build --release -p lumid`** antes y después de D4: aquí no
  se pudo forzar la recompilación de `aws-lc-sys` sin ensuciar el registro de Cargo.
- **Tamaño del binario de `client/src-tauri`**, no compilado en esta auditoría.
  *[ESPECULACIÓN sin verificar]*: `Cargo.toml:32` pide `tokio = { features = ["full"] }`
  y `reqwest` con `rustls-tls-manual-roots` **y** `rustls-tls-native-roots` a la vez;
  recortar `tokio` a lo que de verdad se usa es el recorte de binario clásico.

---

## Plan de ejecución

Ordenado por relación impacto/riesgo. Cada tanda es un commit.

### Tanda 0 — Responder dos preguntas antes de tocar nada

| # | Qué | Por qué |
|---|---|---|
| 0a | ¿Se subió ya el techo de memoria de WSL? (`~/.wslconfig`) | De ello depende W4, que es el ítem de más impacto pendiente desde septiembre |
| 0b | Correr un análisis por nivel y leer `agentes: N pedidos, M veredictos` | Si `M == 0`, B1/B2 van primero y todo lo demás espera |

### Tanda 1 — Correcciones que desbloquean (B1, B2, W8, B3)

No son rendimiento, pero sin ellas el resto no significa nada.

| # | Cambio | Fichero |
|---|---|---|
| 1 | Decidir 8B-4bit (+`bitsandbytes` en el venv) o 4B-fp16, **con la medida 7 de §8** | `tasks.rs:83-150`, `registros/motores/qwen3-vl.json` |
| 2 | Ids de agentes correctos en `mini`/`pro`, + aviso cuando un id pedido no exista | `registros/niveles/{mini,pro}.json`, `agentes_de` |
| 3 | `stderr` drenado en tarea aparte, copiando el patrón de los otros dos puentes | `verificar.rs:116-121` |
| 4 | Firma de `cargar_motor` en el upscaler | `lumi_upscale.py:57` |

### Tanda 2 — Casi gratis, impacto alto

| # | Cambio | Fichero | Esfuerzo |
|---|---|---|---|
| 5 | `onMarker` a `useRef` en `MapCanvas` | `MapCanvas.tsx:342-370` | 5 líneas |
| 6 | Offscreen del pincel de blur cacheado por trazo | `ImageEditorPopup.tsx:265-285` | bajo |
| 7 | Historial del editor a JPEG 0.92 | `ImageEditorPopup.tsx:112`, `:178` | 1 argumento |
| 8 | Los 3 índices SQLite ausentes | `store.rs` (`SCHEMA`) | 3 líneas |
| 9 | `reqwest::Client` compartido para teselas y Qdrant | `map.rs:161`, `qdrant.rs:36` | bajo |
| 10 | `sobrescribir` a `spawn_blocking` + agrupar los 3 `conn()` | `media.rs:250`, `images.rs:79/94/101` | 3 líneas |
| 11 | Caché de los pases «sin imagen» del VLM | `lumi_motores.py:129` | ~10 líneas |
| 12 | Una sola decodificación PIL por orden de agentes | `lumi_motores.py:120`, `:145` | ~5 líneas |
| 13 | Corregir el comentario de `set_float32_matmul_precision` | `lumi_verify.py:118` | 1 comentario |

### Tanda 3 — Bundle del cliente

| # | Cambio | Fichero |
|---|---|---|
| 14 | Medir con `rollup-plugin-visualizer` (§8) **antes** de los dos siguientes | `vite.config.ts`, temporal |
| 15 | `React.lazy` sobre `MapCanvas` | `CaseView.tsx` |
| 16 | `React.lazy` sobre `AdminPanel` y `AvisoEditor` | `App.tsx:466`, `NotificationsPopover.tsx:230` |
| 17 | Subsets de Inter solo `latin`/`latin-ext`, solo `woff2` | `index.css:6-7` |

Esperado: chunk de arranque de 2 087 kB → 500-700 kB. *[ESTIMADO]*

### Tanda 4 — Daemon estructural

| # | Cambio | Fichero |
|---|---|---|
| 18 | Cachear los 3 flags de los middlewares (caché en el módulo de los setters) | `mantenimiento.rs`, `zero_trust.rs` |
| 19 | N+1 de `duenos` + `notificar_posiciones` O(n²) | `queue/mod.rs:1669`, `:1418` |
| 20 | `prepare_cached` en los caminos calientes; SQL literal en `zero_trust.rs:45` | varios |
| 21 | PRAGMAs `cache_size`/`temp_store` (+`mmap_size` **solo tras medir en el host**) | `store.rs` |
| 22 | `[profile.dist]` con `lto="thin"` + `strip`, **sin** `panic="abort"` | `Cargo.toml` del workspace, `tools/build.py` |
| 23 | `rustls` con `default-features = false` + `ring` | `crates/lumid/Cargo.toml:21` |
| 24 | Filtro dentro de las subconsultas de `/v1/projects` | `routes/projects.rs:70-100` |
| 25 | `worker_threads` a `num_cpus` | `main.rs:96` |
| 26 | `Store::leer` con `spawn_blocking`, **por tandas**, empezando por middlewares y `guard_case` | `store.rs` + llamantes |

### Tanda 5 — El orden de magnitud del VLM

Después de las medidas 3, 4, 5 y 6 de §8, no antes.

| # | Cambio | Fichero |
|---|---|---|
| 27 | `logits_to_keep` + `log_softmax` a mano en vez de `labels=` | `lumi_motores.py:101-106` |
| 28 | Caché de prefijo por agente (`past_key_values`) | `lumi_motores.py:126-130` |
| 29 | `max_pixels` **como parámetro del registro del motor**, con el barrido detrás | `lumi_motores.py:54`, `registros/motores/*.json` |
| 30 | `attn_implementation` explícito + `inference_mode` | `lumi_motores.py:55-67`, `:101` |
| 31 | Sello `.verificado` junto a los pesos | `lumi_pesos.py:194-207` |
| 32 | Revisar el defecto de persistencia, **ya con números y con el techo de WSL resuelto** | `agentar.rs:93`, `verificar.rs:73`, `rendimiento.rs:26` |

### Tanda 6 — Oportunista

C6 (avisos fuera del `Sample`), C7 (`/v1/hello` a 10 s), C9 (blur permanentes), C10
(`loading="lazy"` + `Drawer` cerrado), C12 (`React.memo` en `Thumb`), D14 (N+1 de
`recuperar`), D15 (compresión + `ETag`, con la lista de exclusiones), D16 (`foto()` fuera
del lock), W10 (Qdrant en paralelo), W11 (un `Persistente` por dispositivo), W13
(`tobytes()`), W14 (`Compose` en `__init__`).

---

## Nota sobre el orden

La propiedad que separa a la Tanda 2 del resto es la misma que tenía la Tanda 1 de
septiembre: **son trece cambios de una a diez líneas, todos reversibles, y ninguno
cambia una decisión de diseño.** Solo corrigen defectos que no sobrevivieron al contacto
con el código real.

La Tanda 1 va antes porque **B1 y B2 juntos explican «los agentes no dan buenos
resultados» sin necesidad de invocar la calidad del modelo**: en `mini` y `pro` no corre
ninguno, y en `vision` el motor falla al cargar si falta `bitsandbytes`. Antes de tocar
prompts, umbrales o pesos, hay que confirmar que los agentes están corriendo de verdad.

Y la Tanda 5 va al final a propósito. Es donde está el orden de magnitud —81 pases donde
caben 7— pero también donde cada decisión depende de un número que hoy no tenemos. El
spec de septiembre ya dejó escrita la lección: *«antes de tocar los modelos, instrumentar»*.
Aquí la instrumentación ya existe; lo que falta es correrla.
