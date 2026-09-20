# Optimización extrema (cliente, daemon, workers) — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aplicar las medidas de rendimiento que siguen vigentes en
`docs/superpowers/specs/2026-09-19-optimizacion-extrema-design.md` tras su fe de
erratas del 2026-09-20 (que retiró todo lo que dependía de los agentes, borrados en la
Fase 0 de Darkroom), en el orden renumerado que esa misma fe de erratas fija.

**Architecture:** No hay diseño nuevo — son ~35 correcciones independientes de
rendimiento/corrección sobre código existente (cliente Tauri/React, daemon `lumid`,
workers Python), agrupadas en 6 tandas donde cada tanda es autocontenida y termina en
su propio commit. El propio spec ya trae, para cada ítem, la evidencia exacta, el
código a tocar y la medida — este plan no repite ese texto letra por letra: **cada
tarea manda a leer la sección exacta del spec antes de tocar el fichero**, y añade solo
lo que el spec no podía saber cuando se escribió: los números de línea reales de HOY
(varios ficheros del daemon se movieron en la Fase 0 de Darkroom, un día después de
que se escribiera el spec).

**Tech Stack:** Rust (`crates/lumid`), TypeScript/React (`client/`), Python (`workers/`).

## Global Constraints

- **Cada tanda es un commit**, en el orden exacto de este plan (Tanda 1 reducida →
  Tanda 2 → Tanda 3 → Tanda 4 → Tanda 5 reducida → Tanda 6) — es el orden que la propia
  fe de erratas del spec fija tras retirar los ítems de agentes.
- **Antes de tocar un fichero, `grep` su estado real** — varios de los números de línea
  del spec quedaron desplazados por la Fase 0 de Darkroom (`store.rs`, `queue/mod.rs`,
  `routes/media.rs`, `routes/images.rs`, `routes/projects.rs`, `routes/analyses.rs`,
  `recuperar.rs` se editaron ese día). Este plan ya trae los números verificados el
  2026-09-20 para los puntos más sensibles; si algo no cuadra, el texto del spec
  (nombres de función, razonamiento) es la fuente de verdad, no el número de línea.
- **No tocar nada de la Parte 6 del spec** ("lo que ya está bien: no tocar"), ni nada de
  la Parte 7 ("fuera de alcance, con diseño propio") — ninguno de los dos entra en este
  plan.
- **`panic = "abort"` NO se activa** (D3) — el spec lo descarta explícitamente y pide
  decisión del dueño; este plan tampoco lo activa.
- **C9 (blur permanente) NO se toca sin el dueño** — es cambio visual y DESIGN.md manda;
  queda fuera de este plan (no está en ninguna tanda de la Parte 8 tampoco).
- **D11 (`mmap_size`) se aplica solo si el propio Step de la Tarea 4 confirma en el host
  real que no perjudica** — el spec advierte que no rinde igual en WSL2.
- Idioma español en comentarios, commits y mensajes de UI, siguiendo la convención del
  repo.
- Compilar tras cada tarea: `cargo build` (Rust) y `npx tsc -b --noEmit` (cliente) antes
  de cada commit.

---

### Task 1: Tanda 1 reducida — M1 downgradeado, W8, B3, sello `.verificado` (W5)

**Files:**
- Modify: `workers/lumi_pesos.py` — `quizas_purgar_por_presion` (hoy `:56-88`, firma
  `(cache, usos, activo)`) y sus tres llamantes (`workers/lumi_geo.py:71`,
  `workers/lumi_verify.py:186`, `workers/lumi_upscale.py:54`)
- Modify: `crates/lumid/src/verificar.rs` — el bloque que drena `stderr` con
  `read_to_string` antes de leer `stdout` (confirmado hoy en
  `crates/lumid/src/verificar.rs:115-118`, dentro de la función que lanza el proceso de
  verificación)
- Modify: `workers/lumi_upscale.py:57` — la llamada a `cargar_motor`
- Modify: `workers/lumi_pesos.py` (`_verificar`/zona de sha256, la función que hashea el
  fichero de pesos completo) — sello `.verificado`

**Interfaces:**
- Consumes: nada de tareas anteriores (es la primera de este plan)
- Produces: `quizas_purgar_por_presion(cache, usos, activo, necesita_mb)` — los tres
  llamantes existentes (`lumi_geo.py`, `lumi_verify.py`, `lumi_upscale.py`) deben pasar
  ahora un cuarto argumento con el tamaño estimado (en MB) del modelo que están a punto
  de cargar.

- [ ] **Step 1: Leer la sección M1 completa del spec**

```bash
grep -n "^### M1\." -A 40 "docs/superpowers/specs/2026-09-19-optimizacion-extrema-design.md" | head -45
```

Confirmar la medida: cambiar la firma de `quizas_purgar_por_presion` para que reciba
`necesita_mb` y desaloje si `libre < necesita_mb + margen`, en vez de comparar contra la
constante fija `UMBRAL_MEMORIA_LIBRE_MB = 512`.

- [ ] **Step 2: Implementar la nueva firma en `lumi_pesos.py`**

Leer el cuerpo actual:

```bash
grep -n "def quizas_purgar_por_presion\|UMBRAL_MEMORIA_LIBRE_MB" workers/lumi_pesos.py
sed -n '30,90p' workers/lumi_pesos.py
```

Cambiar la firma de:

```python
def quizas_purgar_por_presion(cache, usos, activo):
```

a:

```python
def quizas_purgar_por_presion(cache, usos, activo, necesita_mb=0):
```

y el cuerpo que hoy compara `libre >= UMBRAL_MEMORIA_LIBRE_MB` pasa a comparar
`libre >= necesita_mb + UMBRAL_MEMORIA_LIBRE_MB` (la constante se queda como el margen
de seguridad, no como el umbral entero). Mantener `necesita_mb=0` como valor por
defecto para que un llamante que no sepa el tamaño (no debería quedar ninguno tras el
Step 3, pero por si acaso) se comporte igual que hoy.

- [ ] **Step 3: Actualizar los tres llamantes para pasar el tamaño del modelo entrante**

```bash
grep -n "quizas_purgar_por_presion(" workers/lumi_geo.py workers/lumi_verify.py workers/lumi_upscale.py
```

En cada uno de los tres sitios, el tamaño del modelo entrante es el fichero de pesos que
se está a punto de cargar — el mismo que `lumi_pesos._verificar`/el hashado de sha256 va
a leer de todos modos, así que `os.path.getsize()` sobre ese mismo fichero (o la suma de
los ficheros del directorio del modelo si son varios — mirar cómo cada llamante localiza
su directorio de pesos, con `glob.glob`, antes de decidir si es un fichero o varios) da
el número gratis, tal como pide el spec. Calcular `necesita_mb = tamaño_bytes / (1024 *
1024)` justo antes de la llamada existente y pasarlo como cuarto argumento.

- [ ] **Step 4: Leer la sección W8 completa del spec**

```bash
grep -n "^### W8\." -A 20 "docs/superpowers/specs/2026-09-19-optimizacion-extrema-design.md"
```

- [ ] **Step 5: Arreglar el drenado de `stderr` en `verificar.rs`**

Leer el bloque real de hoy (ya verificado, pero confirmar antes de editar por si algo
más se movió):

```bash
sed -n '95,135p' crates/lumid/src/verificar.rs
```

El patrón a copiar es el de `persistente.rs::drenar_stderr` (una tarea `tokio::spawn`
aparte que lee `stderr` línea a línea con `tracing::warn!`, sin bloquear el resto):

```bash
sed -n '35,48p' crates/lumid/src/persistente.rs
```

Sustituir el bloque de `verificar.rs`:

```rust
let mut errores = String::new();
if let Some(mut stderr) = hijo.stderr.take() {
    let _ = stderr.read_to_string(&mut errores).await;
}
```

por una tarea aparte que no bloquea el `await` de `stdout`, con la misma forma que
`persistente.rs::drenar_stderr` pero adaptada a esta función (sin `nombre: &'static str`
si `verificar.rs` no tiene ese parámetro disponible — usar un literal como `"verificar"`
en el `tracing::warn!`):

```rust
if let Some(stderr) = hijo.stderr.take() {
    tokio::spawn(async move {
        let mut lineas = tokio::io::BufReader::new(stderr).lines();
        while let Ok(Some(linea)) = lineas.next_line().await {
            tracing::warn!(target: "lumid::verificar", "verificar: {linea}");
        }
    });
}
```

Quitar la variable `errores` si ya no la usa nada más abajo en la función (buscar sus
usos con `grep -n "errores" crates/lumid/src/verificar.rs` antes de borrarla).

- [ ] **Step 6: Leer la sección B3 completa del spec**

```bash
grep -n "^### B3\." -A 15 "docs/superpowers/specs/2026-09-19-optimizacion-extrema-design.md"
```

- [ ] **Step 7: Arreglar la firma en `lumi_upscale.py`**

Confirmado hoy: `workers/lumi_upscale.py:57` llama
`cargar_motor("upscalador", PESOS, disp)` contra la firma real
`cargar_motor(clase, motor_id, pesos_dir, dispositivo, cuantizacion=None)` de
`workers/lumi_motores.py:53`. Falta el `motor_id` — el id real es `"real-esrgan"`
(`registros/motores/real-esrgan.json:2`, campo `"id"`). Cambiar:

```python
_motores["upscalador"] = cargar_motor("upscalador", PESOS, disp)
```

a:

```python
_motores["upscalador"] = cargar_motor("upscalador", "real-esrgan", PESOS, disp)
```

- [ ] **Step 8: Leer la sección W5 completa del spec**

```bash
grep -n "^### W5\." -A 20 "docs/superpowers/specs/2026-09-19-optimizacion-extrema-design.md"
```

- [ ] **Step 9: Añadir el sello `.verificado` en `lumi_pesos.py`**

```bash
grep -n "_verificar\|sha256\|hashlib" workers/lumi_pesos.py
```

Localizar la función que calcula el sha256 completo del fichero de pesos (llamada desde
al menos tres sitios, según el spec). Antes de rehashear, comprobar si existe
`<fichero_de_pesos>.verificado` con `(sha256_esperado, mtime, size)` guardados (JSON
simple) y si `mtime`/`size` del fichero real coinciden — si coinciden, devolver el
`sha256_esperado` guardado sin releer el fichero. Si no existe o no coincide, hacer el
hash completo como hoy y, si coincide con el esperado, escribir el sello con
`(sha256, mtime, size)` para la próxima vez. No relajar la comprobación en sí: solo se
evita repetirla cuando ya se sabe la respuesta para ese inodo exacto.

- [ ] **Step 10: Compilar y probar**

```bash
cargo build -p lumid
python3 -c "import ast; ast.parse(open('workers/lumi_pesos.py').read())"
python3 -c "import ast; ast.parse(open('workers/lumi_geo.py').read())"
python3 -c "import ast; ast.parse(open('workers/lumi_verify.py').read())"
python3 -c "import ast; ast.parse(open('workers/lumi_upscale.py').read())"
```

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "perf: umbral de presión relativo al modelo, drenado de stderr sin bloqueo, firma del upscaler y sello de sha256 (tanda 1)"
```

---

### Task 2: Tanda 2 — casi gratis, impacto alto (menos los ítems de agentes)

**Files:**
- Modify: `client/src/work/MapCanvas.tsx` (`onMarker` a `useRef`, hoy verificar rango
  real con `grep -n "onMarker" client/src/work/MapCanvas.tsx` — el spec lo situaba en
  `:342-370`)
- Modify: `client/src/work/ImageEditorPopup.tsx` (offscreen del pincel de blur cacheado
  por trazo, hoy verificar con `grep -n "aplicarBlurEn\|PROFUNDIDAD_HISTORIAL"
  client/src/work/ImageEditorPopup.tsx` — el spec lo situaba en `:265-285` para el blur y
  `:112`/`:178`/`:7` para el historial)
- Modify: `crates/lumid/src/store.rs` (los 3 índices SQLite ausentes de D6)
- Modify: `crates/lumid/src/routes/map.rs` (`reqwest::Client` compartido, hoy verificar
  con `grep -n "Client::builder\|fn outbound" crates/lumid/src/routes/map.rs`)
- Modify: `crates/lumid/src/qdrant.rs` (mismo cliente compartido)
- Modify: `crates/lumid/src/routes/media.rs` y `crates/lumid/src/routes/images.rs`
  (`sobrescribir` a `spawn_blocking`, agrupar los 3 `conn()`)

**Interfaces:**
- Consumes: ninguna de la Task 1
- Produces: ninguna que otras tareas de este plan consuman directamente, salvo que la
  Task 4 (Tanda 4, D6 duplicado — comprobar que no se pisan) reutilice los mismos
  índices; si D6 ya quedó hecho aquí, la Task 4 debe saltarlo sin repetirlo.

- [ ] **Step 1: `onMarker` a `useRef` en `MapCanvas.tsx`**

Leer la sección C3 completa:

```bash
grep -n "^### C3\." -A 30 "docs/superpowers/specs/2026-09-19-optimizacion-extrema-design.md"
grep -n "onMarker" client/src/work/MapCanvas.tsx client/src/work/CaseView.tsx
```

Guardar `onMarker` en un `useRef` dentro de `MapCanvas` (patrón «callback ref»): crear
`const onMarkerRef = useRef(onMarker); useEffect(() => { onMarkerRef.current =
onMarker; });` y usar `onMarkerRef.current(...)` en el sitio donde hoy se llama
`onMarker(...)` dentro del efecto que registra los marcadores. Sacar `onMarker` de la
lista de dependencias de ese efecto (dejar `markers` y `flyTo`, que ya están
memoizados según el spec).

- [ ] **Step 2: Offscreen de blur cacheado por trazo en `ImageEditorPopup.tsx`**

Leer la sección C4 completa:

```bash
grep -n "^### C4\." -A 25 "docs/superpowers/specs/2026-09-19-optimizacion-extrema-design.md"
grep -n "aplicarBlurEn\|onPointerMove" client/src/work/ImageEditorPopup.tsx
```

Crear el canvas offscreen desenfocado **una sola vez** al empezar el trazo (en el
handler de `onPointerDown` del pincel de blur, o el punto donde hoy arranca el trazo);
cada `pointermove` pasa a hacer solo `clip()` + `drawImage(offscreen)` sobre el punto
actual, sin recrear ni volver a aplicar `filter: blur()`. Invalidar el offscreen
cacheado (ponerlo a `null` para que se regenere en el próximo trazo) tras
`aplicarRecorte`, `girar`, `aplicarTono` y `deshacer`/`rehacer` — localizar esas cuatro
funciones con `grep -n "function aplicarRecorte\|function girar\|function aplicarTono\|function deshacer\|function rehacer" client/src/work/ImageEditorPopup.tsx`
y añadir la invalidación en cada una.

- [ ] **Step 3: Historial del editor a JPEG**

Leer C5:

```bash
grep -n "^### C5\." -A 20 "docs/superpowers/specs/2026-09-19-optimizacion-extrema-design.md"
grep -n "toDataURL" client/src/work/ImageEditorPopup.tsx
```

Cambiar la(s) llamada(s) a `toDataURL()` del historial (no la de exportación final, que
el spec dice que ya usa JPEG 0.92 — confirmar cuál es cuál con el grep) para que usen
`toDataURL("image/jpeg", 0.92)` en vez de PNG sin argumentos.

- [ ] **Step 4: Los 3 índices SQLite ausentes**

Leer D6:

```bash
grep -n "^### D6\." -A 15 "docs/superpowers/specs/2026-09-19-optimizacion-extrema-design.md"
grep -n "CREATE INDEX" crates/lumid/src/store.rs | tail -20
```

Añadir, en el mismo bloque de `CREATE INDEX IF NOT EXISTS` donde viven los demás (buscar
el patrón exacto con el grep anterior para copiar el estilo):

```sql
CREATE INDEX IF NOT EXISTS analysis_images_by_image ON analysis_images(image_id);
CREATE INDEX IF NOT EXISTS analyses_by_created_at ON analyses(created_at);
CREATE INDEX IF NOT EXISTS media_folders_by_case ON media_folders(case_id);
CREATE INDEX IF NOT EXISTS media_folders_by_project ON media_folders(project_id);
```

(Cuatro índices, no tres — el spec agrupa `media_folders(case_id)` y
`media_folders(project_id)` como una sola fila de su tabla pero son dos índices
distintos; confirmarlo leyendo de nuevo el bloque D6 antes de decidir si el proyecto
prefiere un índice compuesto en su lugar — si `store.rs` ya tiene un patrón de índices
compuestos para casos similares, seguirlo en su lugar del literal de arriba).

- [ ] **Step 5: `reqwest::Client` compartido para teselas y Qdrant**

Leer D7:

```bash
grep -n "^### D7\." -A 20 "docs/superpowers/specs/2026-09-19-optimizacion-extrema-design.md"
grep -n "Client::builder\|fn outbound" crates/lumid/src/routes/map.rs
grep -n "Client::builder" crates/lumid/src/qdrant.rs crates/lumid/src/recuperar.rs
```

En `map.rs`, sustituir la construcción de `Client::builder().build()` dentro de
`outbound` por un `static CLIENTE: std::sync::OnceLock<reqwest::Client> = OnceLock::new();`
a nivel de módulo, con `CLIENTE.get_or_init(|| reqwest::Client::builder()...build().unwrap())`
en el cuerpo de `outbound` (conservando cualquier configuración — timeouts, TLS — que la
construcción actual ya tuviera). En `qdrant.rs`, aplicar el mismo patrón para el cliente
que hoy se instancia por análisis en `recuperar.rs`.

- [ ] **Step 6: `sobrescribir` a `spawn_blocking` + agrupar los 3 `conn()`**

Leer D10 (dentro de la tabla D9):

```bash
grep -n "^| D10" "docs/superpowers/specs/2026-09-19-optimizacion-extrema-design.md"
grep -n "fn sobrescribir" crates/lumid/src/routes/media.rs crates/lumid/src/routes/images.rs
```

En el handler `sobrescribir` de `media.rs`, envolver la decodificación+hash de la
imagen (hoy inline en el `async fn`) en `tokio::task::spawn_blocking`, siguiendo
exactamente el mismo patrón que ya usan `upload` y `upscale` en `images.rs` (leerlos
primero con `grep -n "spawn_blocking" crates/lumid/src/routes/images.rs` para copiar la
forma). Agrupar las 3 adquisiciones de `conn()` que hoy hace la operación en una sola,
si las tres consultas pueden compartir el mismo guard sin cruzar un `.await` en medio
(si alguna de las tres SÍ necesita un `.await` entre medias, dejarlas separadas — el
compilador ya no deja sostener un `MutexGuard` de `std::sync` a través de un `.await`,
así que un intento de agruparlas de forma incorrecta no compila).

- [ ] **Step 7: Compilar y probar**

```bash
cargo build -p lumid
cd client && npx tsc -b --noEmit
```

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "perf: marcadores del mapa, blur cacheado, historial JPEG, indices, cliente HTTP compartido y sobrescribir en spawn_blocking (tanda 2)"
```

---

### Task 3: Tanda 3 — bundle del cliente

**Files:**
- Create (temporal, se borra al final del task): configuración de
  `rollup-plugin-visualizer` en `client/vite.config.ts`
- Modify: `client/src/work/CaseView.tsx` (`React.lazy` sobre `MapCanvas`)
- Modify: `client/src/App.tsx:466`-ish (`React.lazy` sobre `AdminPanel`, verificar línea
  real con grep) y `client/src/ui/NotificationsPopover.tsx` (`React.lazy` sobre
  `AvisoEditor`, verificar línea real — el spec la situaba en `:230`)
- Modify: `client/src/index.css:6-7` (subsets de Inter)

**Interfaces:**
- Consumes: ninguna de las tareas anteriores
- Produces: `MapCanvas`, `AdminPanel` y `AvisoEditor` fuera del chunk de arranque —
  ninguna otra tarea de este plan depende de esto, es terminal para el cliente.

- [ ] **Step 1: Medir con `rollup-plugin-visualizer` antes de tocar nada**

Leer la sección del spec sobre esta medición:

```bash
grep -n "rollup-plugin-visualizer" "docs/superpowers/specs/2026-09-19-optimizacion-extrema-design.md"
```

```bash
cd client && npm i -D rollup-plugin-visualizer
```

Añadir el plugin a `vite.config.ts` con `{ gzipSize: true, brotliSize: true }` (ver la
documentación del propio paquete para la sintaxis exacta de importación en un
`vite.config.ts` con Rolldown/Vite), correr `npm run build`, y leer el treemap generado
para confirmar qué proporción del chunk de arranque es `maplibre-gl` vs React vs
TipTap/ProseMirror vs código propio, ANTES de aplicar los `React.lazy` de los steps
siguientes — es la medida de referencia para confirmar que después bajó.

- [ ] **Step 2: `React.lazy` sobre `MapCanvas`**

Leer C1 completo:

```bash
grep -n "^### C1\." -A 25 "docs/superpowers/specs/2026-09-19-optimizacion-extrema-design.md"
grep -n "import.*MapCanvas\|<MapCanvas" client/src/work/CaseView.tsx
```

En `CaseView.tsx`, cambiar el import estático de `MapCanvas` por
`const MapCanvas = React.lazy(() => import("./MapCanvas"));` y envolver su uso en
`<Suspense fallback={...}>`. El `fallback` reutiliza el `radial-gradient` que ya pinta
`MapCanvas.tsx` (buscar con `grep -n "radial-gradient" client/src/work/MapCanvas.tsx`
para copiar el mismo fondo, así la transición no salta).

- [ ] **Step 3: `React.lazy` sobre `AdminPanel` y `AvisoEditor`**

Leer C2 completo:

```bash
grep -n "^### C2\." -A 20 "docs/superpowers/specs/2026-09-19-optimizacion-extrema-design.md"
grep -n "import.*AdminPanel" client/src/App.tsx
grep -n "import.*AvisoEditor" client/src/ui/NotificationsPopover.tsx
```

Aplicar el mismo patrón `React.lazy` + `Suspense` a ambos imports.

- [ ] **Step 4: Subsets de Inter solo latin/latin-ext, solo woff2**

Leer C11 (dentro de la tabla C8):

```bash
grep -n "^| C11" "docs/superpowers/specs/2026-09-19-optimizacion-extrema-design.md"
sed -n '1,15p' client/src/index.css
```

Editar las declaraciones `@font-face` de Inter en `index.css` para quitar los ficheros
`.woff` (dejando solo `.woff2`) y los subsets que no sean `latin`/`latin-ext` — mirar
qué subsets están declarados hoy antes de decidir cuáles quitar; si el proyecto ya tiene
datos con cirílico/griego en algún sitio (nombres de usuario, notas), NO quitar esos
subsets — el propio spec avisa del riesgo cosmético.

- [ ] **Step 5: Confirmar la mejora y limpiar**

```bash
cd client && npm run build
```

Comparar el tamaño del chunk de arranque contra la medida del Step 1. Quitar
`rollup-plugin-visualizer` del `package.json`/`vite.config.ts` si el proyecto prefiere
no dejarlo como dependencia permanente (el spec lo llama "una dependencia de desarrollo
y un fichero que se borra después" — decidir si se deja instalado para medidas futuras o
se desinstala; si se desinstala, `npm uninstall rollup-plugin-visualizer` y revertir el
cambio de `vite.config.ts` de ese plugin).

```bash
npx tsc -b --noEmit
```

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "perf(client): sacar MapCanvas/AdminPanel/AvisoEditor del chunk de arranque, subsets de Inter (tanda 3)"
```

---

### Task 4: Tanda 4 — daemon estructural

**Files:**
- Modify: `crates/lumid/src/mantenimiento.rs`, `crates/lumid/src/zero_trust.rs`
  (cachear los 3 flags)
- Modify: `crates/lumid/src/queue/mod.rs` (`duenos`, `notificar_posiciones` — N+1 y
  O(n² log n))
- Modify: `crates/lumid/src/store.rs` (`prepare_cached` en caminos calientes; PRAGMAs;
  `[profile.dist]` va en el `Cargo.toml` del workspace, no aquí)
- Modify: `Cargo.toml` (raíz del workspace) — `[profile.dist]`
- Modify: `tools/build.py` — usar el perfil `dist` para empaquetar
- Modify: `crates/lumid/Cargo.toml:21`-ish — `rustls` sin `aws-lc-rs`
- Modify: `crates/lumid/src/routes/projects.rs` (filtro dentro de las subconsultas de
  `list`)
- Modify: `crates/lumid/src/main.rs:96`-ish — `worker_threads` a `num_cpus`
- Modify: `crates/lumid/src/store.rs` — `Store::leer` con `spawn_blocking`, aplicado
  primero a los middlewares y `guard_case`

**Interfaces:**
- Consumes: ninguna de las tareas anteriores de este plan
- Produces: `Store::leer<T>(&self, f: impl FnOnce(&Connection) -> T + Send + 'static) -> T`,
  un helper nuevo que envuelve `spawn_blocking` — cualquier trabajo futuro que quiera
  seguir migrando más rutas a `spawn_blocking` debe reusar esta firma exacta.

- [ ] **Step 1: Cachear los 3 flags de los middlewares**

Leer D2 completo:

```bash
grep -n "^### D2\." -A 30 "docs/superpowers/specs/2026-09-19-optimizacion-extrema-design.md"
grep -n "fn denylist\|fn zero_trust_gate\|fn mantenimiento_gate\|fn set_activo\|fn set_zero_trust\|fn add_deny" crates/lumid/src/zero_trust.rs crates/lumid/src/mantenimiento.rs
```

Añadir una caché (`std::sync::RwLock` o `arc_swap::ArcSwap`, lo que ya use el resto del
crate — comprobar con `grep -rn "ArcSwap" crates/lumid/src/Cargo.toml crates/lumid/Cargo.toml`
si la dependencia ya está disponible; si no, usar `std::sync::RwLock<Vec<String>>` para
la denylist y `std::sync::RwLock<bool>` para los otros dos flags) **en el mismo módulo
que sus escritores** (`zero_trust.rs` para la denylist y el flag de zero trust,
`mantenimiento.rs` para el flag de mantenimiento) — no en `App`. Invalidar/actualizar la
caché desde cada uno de los escritores conocidos: `mantenimiento::set_activo`,
`zero_trust::set_zero_trust`, y la función que añade a la denylist (localizarla con
`grep -n "fn add_deny\|INSERT INTO ip_denylist" crates/lumid/src/zero_trust.rs`). Los
middlewares (`zero_trust_gate`, `mantenimiento_gate`) leen de la caché en vez de hacer
`SELECT` en cada petición.

- [ ] **Step 2: N+1 y O(n² log n) en el reparto de la cola**

Leer D5 completo:

```bash
grep -n "^### D5\." -A 30 "docs/superpowers/specs/2026-09-19-optimizacion-extrema-design.md"
sed -n '1400,1460p' crates/lumid/src/queue/mod.rs
```

(1) En `duenos()` (`crates/lumid/src/queue/mod.rs:1434` según el grep de hoy), leer
`limits::global()` y `limits::overrides_de_todos()` **una vez**, fuera del bucle por
usuario, y aplicar con `limits::apply` (ya `pub(crate)`) para cada usuario, en vez de
llamar `limits::effective` (que internamente repite `global()`+`overrides()`) por cada
uno.

(2) Sustituir cualquier `COUNT(*)` por usuario dentro de `duenos()` por un solo
`SELECT ... GROUP BY requested_by` que traiga los conteos de todos los usuarios de una
vez.

(3) En `notificar_posiciones` (`crates/lumid/src/queue/mod.rs:1221`), sustituir la
llamada repetida a `plan::posicion` por candidato por una única llamada a
`plan::ordenados` (verificar que existe esa función en `plan.rs` con
`grep -n "pub fn ordenados\|pub fn posicion" crates/lumid/src/plan.rs`; si no existe con
ese nombre exacto, crearla como la lista ya ordenada que `posicion` recorre
internamente hoy) y recorrer el resultado con `.enumerate()` para obtener la posición
de cada candidato sin volver a ordenar por cada uno.

Los tests `la_politica_de_reparto` y `la_posicion_sigue_el_mismo_orden_que_repartir` en
`plan.rs` deben seguir en verde tras este cambio — son la protección que el propio spec
señala:

```bash
cargo test -p lumid la_politica_de_reparto la_posicion_sigue_el_mismo_orden_que_repartir
```

- [ ] **Step 3: `[profile.dist]` en el workspace**

Leer D3 completo:

```bash
grep -n "^### D3\." -A 25 "docs/superpowers/specs/2026-09-19-optimizacion-extrema-design.md"
```

En el `Cargo.toml` de la raíz del workspace, añadir:

```toml
[profile.dist]
inherits = "release"
lto = "thin"
codegen-units = 1
strip = "symbols"
```

**No tocar `[profile.release]` ni añadir `panic = "abort"`** (constraint global de este
plan). En `tools/build.py`, localizar dónde se invoca `cargo build --release` para el
empaquetado (`grep -n "cargo build\|--release" tools/build.py`) y cambiarlo a
`--profile dist` solo en el flujo de `tools/build.py build` (el empaquetado), dejando el
flujo de desarrollo (`python tools/build.py` sin argumentos) con `--release` normal tal
como está.

- [ ] **Step 4: `rustls` sin `aws-lc-rs`**

Leer D4 completo:

```bash
grep -n "^### D4\." -A 20 "docs/superpowers/specs/2026-09-19-optimizacion-extrema-design.md"
grep -n "^rustls" crates/lumid/Cargo.toml
```

Cambiar la línea de `rustls` a:

```toml
rustls = { version = "0.23", default-features = false, features = ["ring", "std", "tls12", "logging"] }
```

Verificar que nada reactiva `aws-lc-rs` por unificación de features:

```bash
cargo tree -p lumid -i aws-lc-rs
```

Esperado: «error: package ID specification `aws-lc-rs` did not match any packages» (o
equivalente «no encontrado»). Si SÍ aparece, usar
`cargo tree -p lumid -i aws-lc-rs -e features` para ver qué dependencia lo reactiva
(candidatas según el spec: `axum-server`, `reqwest`, `quinn`) y añadir
`default-features = false` + las features mínimas necesarias también a esa dependencia.

Arrancar el daemon de verdad tras el cambio (`cargo run -p lumid` o el binario
compilado) y confirmar que TLS sigue funcionando — si alguna dependencia necesitaba de
verdad `aws-lc-rs`, el arranque entra en pánico según documenta `main.rs` (buscar el
comentario con `grep -n "ring::default_provider\|aws-lc" crates/lumid/src/main.rs`).

- [ ] **Step 5: `prepare_cached` en los caminos calientes**

Leer D12 (dentro de la tabla D9):

```bash
grep -n "^| D12" "docs/superpowers/specs/2026-09-19-optimizacion-extrema-design.md"
grep -n "\.prepare(" crates/lumid/src/routes/images.rs crates/lumid/src/limits.rs crates/lumid/src/telemetry.rs crates/lumid/src/zero_trust.rs
```

Cambiar `.prepare(` a `.prepare_cached(` en los caminos calientes señalados (los SQL
literales, sin `format!`), empezando por `zero_trust.rs` — pero antes, arreglar el
`format!` que interpola el nombre de tabla en `zero_trust.rs` (localizarlo con
`grep -n "format!" crates/lumid/src/zero_trust.rs`): sustituirlo por un literal SQL fijo
si el nombre de tabla nunca varía en runtime (confirmarlo leyendo el llamante), porque
`prepare_cached` no puede cachear una sentencia cuyo texto cambia en cada llamada.

- [ ] **Step 6: PRAGMAs de `store.rs`**

Leer D11 (dentro de la tabla D9):

```bash
grep -n "^| D11" "docs/superpowers/specs/2026-09-19-optimizacion-extrema-design.md"
grep -n "pragma_update" crates/lumid/src/store.rs
```

Añadir, junto a los `pragma_update` existentes: `cache_size` a un valor mayor que el
defecto de 2 MB (p. ej. `-64000` para 64 MB, en las unidades negativas de páginas de
SQLite — confirmar la sintaxis exacta que ya usa el fichero para `synchronous`) y
`temp_store` a `MEMORY`. **`mmap_size` NO se activa en este step** — el spec pide
medirlo en el host real primero porque no rinde igual en WSL2; dejar un comentario
`// ponytail: mmap_size pendiente de medir en el host real (WSL2 no se comporta igual)`
en el sitio donde iría, y no activarlo.

- [ ] **Step 7: Filtro dentro de las subconsultas de `/v1/projects`**

Leer D8 completo:

```bash
grep -n "^### D8\." -A 20 "docs/superpowers/specs/2026-09-19-optimizacion-extrema-design.md"
sed -n '57,110p' crates/lumid/src/routes/projects.rs
```

Las dos subconsultas derivadas `kc` (`SELECT project_id, COUNT(*) AS n FROM cases GROUP
BY project_id`) e `ic` (sobre `images JOIN cases`) no llevan filtro por usuario.
Correlacionarlas con `project_members WHERE user_id = ?1 AND status = 'accepted'`, por
ejemplo:

```sql
LEFT JOIN (
  SELECT c.project_id AS project_id, COUNT(*) AS n
  FROM cases c
  JOIN project_members pm ON pm.project_id = c.project_id
  WHERE pm.user_id = ?1 AND pm.status = 'accepted'
  GROUP BY c.project_id
) kc ON kc.project_id = p.id
```

(mismo patrón para `ic`, añadiendo el `JOIN project_members` correspondiente). Verificar
con `EXPLAIN QUERY PLAN` que SQLite ya no materializa las tablas enteras:

```bash
sqlite3 <ruta-a-una-lumi.db-de-desarrollo> "EXPLAIN QUERY PLAN <la-consulta-nueva-completa>"
```

- [ ] **Step 8: `worker_threads` a `num_cpus`**

Leer la mención de D1 sobre esto:

```bash
grep -n "worker_threads" crates/lumid/src/main.rs
```

Cambiar el valor fijo de 2 hilos por `num_cpus::get()` (comprobar si la dependencia
`num_cpus` ya está en `Cargo.toml`; si no, añadirla — es una dependencia trivial y
estándar) en la configuración del runtime de Tokio.

- [ ] **Step 9: `Store::leer` con `spawn_blocking`, empezando por middlewares y `guard_case`**

Leer D1 completo:

```bash
grep -n "^### D1\." -A 35 "docs/superpowers/specs/2026-09-19-optimizacion-extrema-design.md"
grep -n "pub fn conn(" crates/lumid/src/store.rs
```

Añadir un helper nuevo en `store.rs`:

```rust
impl Store {
    pub async fn leer<T: Send + 'static>(
        self_arc: std::sync::Arc<Self>,
        f: impl FnOnce(&rusqlite::Connection) -> T + Send + 'static,
    ) -> T {
        tokio::task::spawn_blocking(move || {
            let c = self_arc.conn();
            f(&c)
        })
        .await
        .expect("spawn_blocking de Store::leer no debería poder cancelarse ni entrar en pánico en uso normal")
    }
}
```

(Ajustar la firma exacta — si `App`/`Store` ya se pasan como `Arc` en el resto del
crate, usar ese mismo patrón en vez de introducir uno nuevo; comprobar con
`grep -n "Arc<Store>\|app.store.clone()" crates/lumid/src/main.rs crates/lumid/src/lib.rs`
antes de decidir la firma final.)

Migrar **solo** dos caminos calientes en este task, tal como pide el spec como primer
paso de una migración por tandas: los dos middlewares del Step 1 de esta misma tarea
(que ya tocaste) y `guard_case` (`grep -n "fn guard_case" crates/lumid/src/routes/cases.rs`)
a usar `Store::leer` en vez de `app.store.conn()` directo. El resto de los 210 llamantes
de `conn()` **no se migra en este plan** — es trabajo de una tanda futura, fuera de
alcance aquí; dejar un comentario en `store.rs` junto al nuevo `leer` que diga
`// TODO(perf): migrar el resto de los ~200 llamantes de conn() por tandas futuras,
empezando por images::serve` para que quede constancia sin fingir que este plan lo hizo
todo.

- [ ] **Step 10: Compilar, testear y medir**

```bash
cargo build -p lumid
cargo test -p lumid la_politica_de_reparto la_posicion_sigue_el_mismo_orden_que_repartir
cargo test -p lumi-proto
cargo tree -p lumid -i aws-lc-rs
```

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "perf(lumid): cachear flags de middlewares, N+1 del reparto, perfil dist, quitar aws-lc-rs, prepare_cached, PRAGMAs, filtro de /v1/projects, worker_threads y Store::leer (tanda 4)"
```

---

### Task 5: Tanda 5 reducida — revisar el defecto de persistencia de verificación

**Files:**
- Modify: `crates/lumid/src/routes/rendimiento.rs` (o donde haya quedado el default de
  `verif_persistente` tras la Fase 0 — verificar con grep)
- Modify: `crates/lumid/src/verificar.rs:73`-ish (el default de persistencia)

**Interfaces:**
- Consumes: M1 de la Task 1 (el downgrade de M1 es lo que hace segura esta revisión —
  sin M1, activar persistencia por defecto en 8 GB podría volver a reproducir presión de
  memoria, aunque ya no el escenario crítico del VLM que motivó M1 originalmente)
- Produces: nada que otra tarea consuma — es terminal

- [ ] **Step 1: Leer W4 completo, ya reescrito por la fe de erratas**

```bash
grep -n "^### W4\." -A 25 "docs/superpowers/specs/2026-09-19-optimizacion-extrema-design.md"
grep -n "Tanda 5, ítem 32" "docs/superpowers/specs/2026-09-19-optimizacion-extrema-design.md"
```

Confirmar el estado real de la persistencia de verificación:

```bash
grep -n "verif_persistente\|agentes_persistente" crates/lumid/src/verificar.rs crates/lumid/src/routes/rendimiento.rs crates/lumid/src/queue/mod.rs
```

- [ ] **Step 2: Decidir el defecto de fábrica de la persistencia de verificación**

Con M1 aplicado (Task 1), el desalojo por presión ya tiene en cuenta el tamaño del
modelo entrante, así que activar la persistencia de verificación por defecto ya no
arriesga el escenario de OOM que la motivó apagada. Cambiar el valor de fábrica de
`verif_persistente` (localizado en el Step 1) de `false`/apagado a activado, o —si el
proyecto prefiere no cambiar un default de producción sin medir primero en la máquina
real del dueño— dejarlo apagado y en su lugar añadir un comentario junto a la
constante explicando que M1 ya lo permite y que la decisión de encenderlo por defecto
queda pendiente de una medida real (`Parte 8, ítem 0` del spec: cuánta memoria pide de
verdad cada proceso, con y sin persistencia). **Esta decisión es del dueño del
producto, no de quien ejecuta este plan** — si hay dudas genuinas sobre cuál de las dos
opciones tomar, dejarlo como está hoy (apagado) y anotarlo como pendiente en el reporte
final de esta tarea, en vez de adivinar.

- [ ] **Step 3: Compilar**

```bash
cargo build -p lumid
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "docs(lumid): revisar el defecto de persistencia de verificación ahora que M1 la hace segura en 8 GB (tanda 5)"
```

---

### Task 6: Tanda 6 — oportunista

**Files:**
- Modify: `client/src/lib/api.ts`, `client/src/ui/NotificationsPopover.tsx`,
  `client/src/lib/store.ts` (C6: avisos fuera del `Sample`, medida ponytail solo cliente)
- Modify: `client/src/App.tsx` (C7: `/v1/hello` a 10 s)
- Modify: `client/src/work/CaseView.tsx`, `client/src/ui/Drawer.tsx`,
  `client/src/work/MediaDrawer.tsx` (C10: `loading="lazy"` + no montar cerrado)
- Modify: `client/src/work/Dock.tsx` (C12: `React.memo` en `Thumb`)
- Modify: `crates/lumid/src/recuperar.rs` (D14: N+1 en `candidatos`)
- Modify: `crates/lumid/src/routes/images.rs`, `crates/lumid/src/routes/map.rs`,
  `Cargo.toml` de `lumid` (D15: compresión + `ETag`, excluyendo SSE y bytes ya
  comprimidos)
- Modify: `crates/lumid/src/queue/mod.rs` (D16: `foto()` fuera del lock de `estado`)
- Modify: `crates/lumid/src/recuperar.rs` (W10: Qdrant en paralelo, conservando orden)
- Modify: `crates/lumid/src/persistente.rs` (W11: un `Persistente` por dispositivo)
- Modify: `workers/lumi_geo.py` (W13: `tobytes()` en vez de `struct.pack`)
- Modify: `workers/lumi_pesos.py` (W14: `Compose` construido en `__init__`, no por lote)

**Interfaces:**
- Consumes: ninguna tarea anterior de este plan
- Produces: nada — es la última tarea, y sus doce ítems son independientes entre sí (se
  pueden dividir en sub-commits si algún compilado intermedio falla, pero el plan pide
  un solo commit para toda la tanda, igual que las anteriores)

- [ ] **Step 1: C6 — avisos fuera de la telemetría (medida ponytail, solo cliente)**

```bash
grep -n "^### C6\." -A 25 "docs/superpowers/specs/2026-09-19-optimizacion-extrema-design.md"
grep -n "setSample" client/src/lib/store.ts
```

En `setSample` (o el reducer/store equivalente), conservar la referencia del array
`avisos` anterior si el contenido es igual: comparar `length` y el `id` mayor entre el
array nuevo y el guardado, y si coinciden, asignar la referencia vieja al `sample`
nuevo en vez de la que acaba de llegar por SSE. **No** implementar aquí la medida
"correcta" del protocolo (sacar `avisos` de `Sample`, evento propio) — el spec la marca
como algo que toca `lumi-proto` y queda fuera de esta tanda oportunista; solo la medida
ponytail de un lado.

- [ ] **Step 2: C7 — `/v1/hello` a 10 s**

```bash
grep -n "^### C7\." -A 15 "docs/superpowers/specs/2026-09-19-optimizacion-extrema-design.md"
grep -n "request.*hello\|setInterval" client/src/App.tsx | head -10
```

Subir el intervalo de sondeo de `/v1/hello` de 3000 ms a 10000 ms, y resetear el
contador de fallos consecutivos cada vez que llega un evento `telemetry` del SSE (buscar
dónde vive ese contador con `grep -n "KICK_AFTER_MS\|fallos" client/src/App.tsx`).

- [ ] **Step 3: C10 — `MediaDrawer` cerrado no monta su rejilla, `loading="lazy"`**

```bash
grep -n "^| C10" "docs/superpowers/specs/2026-09-19-optimizacion-extrema-design.md"
grep -n "MediaDrawer" client/src/work/CaseView.tsx client/src/ui/Drawer.tsx
```

Condicionar el montaje de la rejilla de miniaturas de `MediaDrawer` a que el `Drawer`
esté abierto (no renderizar sus hijos, o renderizar `null`, mientras `Drawer` esté
cerrado — mirar cómo otros `Drawer`s del proyecto ya condicionan su contenido, si alguno
lo hace, para seguir el mismo patrón). Añadir `loading="lazy"` a las etiquetas `<img>`
de las miniaturas.

- [ ] **Step 4: C12 — `React.memo` en `Thumb`**

```bash
grep -n "^| C12" "docs/superpowers/specs/2026-09-19-optimizacion-extrema-design.md"
grep -n "function Thumb\|const Thumb" client/src/work/Dock.tsx
```

Envolver el componente `Thumb` en `React.memo`. El spec advierte que memoizar `Dock`
entero no serviría mientras `summary` sea un literal nuevo por render — memoizar
únicamente `Thumb`, no `Dock`.

- [ ] **Step 5: D14 — N+1 en `recuperar::candidatos`**

```bash
grep -n "^| D14" "docs/superpowers/specs/2026-09-19-optimizacion-extrema-design.md"
sed -n '43,120p' crates/lumid/src/recuperar.rs
```

Sustituir los 12 `query_row` individuales dentro del bucle por una sola consulta que
traiga los datos de todos los candidatos de una vez (o el número que corresponda hoy —
confirmar con el `sed` de arriba cuántos `query_row` hay realmente), reconstruyendo el
orden RRF con un `HashMap` indexado por lo que identifique a cada candidato, tal como
indica el spec.

- [ ] **Step 6: D15 — compresión + `ETag`**

```bash
grep -n "^| D15" "docs/superpowers/specs/2026-09-19-optimizacion-extrema-design.md"
grep -n "tower_http\|tower-http" crates/lumid/Cargo.toml
grep -n "immutable\|sobrescribir_bytes" crates/lumid/src/routes/images.rs crates/lumid/src/routes/map.rs
```

Activar `tower_http::compression::CompressionLayer` (la dependencia ya está declarada,
solo sin usar) en el router de `main.rs`, **excluyendo explícitamente** las 6 rutas SSE
(localizarlas con `grep -n "Sse\|text/event-stream" crates/lumid/src/main.rs`) y
cualquier ruta que ya sirva bytes comprimidos (JPEG/PNG/PBF de imágenes y teselas) — la
compresión sobre un JPEG ya comprimido es trabajo desperdiciado, y sobre un SSE rompe el
streaming. Añadir cabecera `ETag` (hash del contenido o `mtime`+`size`) a las rutas de
imagen, y corregir el bug de caché: donde hoy se marca `immutable` pese a que
`sobrescribir_bytes` sí reescribe el fichero, quitar `immutable` o invalidar el `ETag`
en cada sobrescritura para que el cliente deje de servir la versión vieja durante un
año.

- [ ] **Step 7: D16 — `foto()` fuera del lock de `estado`**

```bash
grep -n "^| D16" "docs/superpowers/specs/2026-09-19-optimizacion-extrema-design.md"
grep -n "pub fn foto" crates/lumid/src/queue/mod.rs
```

Confirmado hoy: `foto()` está en `crates/lumid/src/queue/mod.rs:346`. Leer su cuerpo
completo y localizar dónde adquiere el `lock()` de `estado` y dónde, DENTRO de ese
`lock()`, hace el N+1 que además toca `conn()` de SQLite (anidando los dos mutex).
Reestructurar para soltar el lock de `estado` (clonar los datos necesarios mientras se
tiene el lock, un `Vec`/snapshot barato) antes de hacer las consultas SQLite, evitando
el orden de adquisición peligroso que señala el spec.

- [ ] **Step 8: W10 — Qdrant en paralelo, conservando el orden RRF**

```bash
grep -n "^| W10" "docs/superpowers/specs/2026-09-19-optimizacion-extrema-design.md"
sed -n '1,90p' crates/lumid/src/recuperar.rs
```

Sustituir la secuencia de `await` uno tras otro (un viaje por `modelo × versión`) por
`futures::future::join_all` (o `try_join_all` si alguna puede fallar), **conservando el
orden de `listas`** en el vector de resultados — el spec avisa de que ese orden afecta
al cálculo RRF, así que no basta con paralelizar: hay que emparejar cada resultado con
su índice original, no con el orden de llegada.

- [ ] **Step 9: W11 — un `Persistente` por dispositivo**

```bash
grep -n "^| W11" "docs/superpowers/specs/2026-09-19-optimizacion-extrema-design.md"
sed -n '1,60p' crates/lumid/src/persistente.rs
```

Hoy el proceso persistente serializa todas las peticiones bajo un `Mutex` y hereda
`LUMI_DEVICE` del primer lanzamiento. Cambiar `Persistente` para que mantenga un mapa
`HashMap<String, Proceso>` (o `Vec`) indexado por dispositivo (`LUMI_DEVICE`), lanzando
un proceso hijo distinto por cada dispositivo distinto que se le pida, en vez de un
único proceso global. El spec señala que la solución ya está escrita en el comentario
del propio fichero — leerlo primero (`grep -n "^//\|^///" crates/lumid/src/persistente.rs | head -40`)
antes de diseñar la estructura desde cero.

- [ ] **Step 10: W13 — `tobytes()` en vez de `struct.pack`**

```bash
grep -n "^| W13" "docs/superpowers/specs/2026-09-19-optimizacion-extrema-design.md"
grep -n "struct.pack\|tolist()" workers/lumi_geo.py workers/lumi_pesos.py
```

Sustituir `struct.pack("<%df", *v)` (precedido de `.tolist()`) por
`t.numpy().astype('<f4').tobytes()` en los tres sitios que el spec señala
(`lumi_geo.py:122-126`, `lumi_pesos.py:370` — confirmar líneas reales con el grep de
arriba), **sin cambiar el formato binario que produce** (`<f4` little-endian float32,
mismo que `<%df` empaquetaba) — el contrato de `vectores` con el Indexer no debe
romperse.

- [ ] **Step 11: W14 — `Compose` en `__init__`, no por lote**

```bash
grep -n "^| W14" "docs/superpowers/specs/2026-09-19-optimizacion-extrema-design.md"
grep -n "transforms.Compose\|_prep(" workers/lumi_pesos.py
```

Mover la construcción de `transforms.Compose(...)` fuera de `_prep()` (que se llama por
lote) a donde el objeto que lo usa se inicializa una sola vez, guardándolo como
atributo. **No tocar** el `DataLoader`/paralelismo de CPU que el spec menciona como
"choca con `_limitar_hilos` y tiene riesgo real de volver a 'el pc va fatal'" — el
`Compose` es el único cambio de este ítem, no una paralelización nueva.

- [ ] **Step 12: Compilar y probar todo**

```bash
cargo build -p lumid
cargo test -p lumi-proto
python3 -c "import ast; ast.parse(open('workers/lumi_geo.py').read())"
python3 -c "import ast; ast.parse(open('workers/lumi_pesos.py').read())"
cd client && npx tsc -b --noEmit && npm run lint
```

- [ ] **Step 13: Commit**

```bash
git add -A
git commit -m "perf: tanda oportunista -- avisos, hello a 10s, MediaDrawer cerrado, Thumb memo, N+1 de recuperar, compresion+ETag, foto() sin lock anidado, Qdrant en paralelo, Persistente por dispositivo, tobytes y Compose en init (tanda 6)"
```
