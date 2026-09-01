# Instalador — Segunda tanda de fixes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Icono propio del instalador, claridad visual de selección en el modal "Otros", y auto-actualización del propio instalador.

**Architecture:** `installer/`, más `crates/lumi-proto` (nuevo variante `Producto::Instalador`) y `tools/release_flow.py` (incluir el instalador en `PRODUCTOS`) para la tarea 3. No tocar `indexer/` ni `client/` — otros planes cubren esos árboles en paralelo.

## Global Constraints

- No tests unless explicitly requested.
- Un commit por tarea, mensaje en español.
- DESIGN.md: dark-theme-only, animaciones exponential ease-out.
- `ponytail`: la solución más simple que funcione.
- Antes de cada commit: `git status --short`, stage solo archivos exactos de esta tarea (otros agentes en paralelo tocan `indexer/`/`client/`).

---

### Task 1: Icono propio del instalador (#92)

**Root cause confirmado:** `installer/src-tauri/icons/icon.ico` es byte-idéntico al icono del cliente (md5 igual) — el instalador nunca tuvo un icono propio, siempre reusó el del cliente.

**Files:** `installer/src-tauri/icons/` (set completo: ico/png en los tamaños que ya usa `tauri.conf.json`).

**Steps:**
- [ ] Diseñar/generar un icono nuevo: la estrella de Lumi (mismo path que el resto de iconos de la app, ver `client/src-tauri/icons/app-icon.svg` como referencia del trazo) sobre fondo negro (`#0e0f11`, el mismo tono usado en el corte del icono del indexer) con una flecha de descarga superpuesta — coherente con lo que ya se hizo para diferenciar el icono del indexer (estrella + gafas) en esta misma sesión, pero esta vez con una flecha de descarga.
- [ ] Crear el SVG fuente en `installer/src-tauri/icons/app-icon.svg` (o el nombre que siga la convención de `client`/`indexer`) y regenerar el set completo con `npx tauri icon` desde `installer/src-tauri/`, igual que se hizo para el indexer.
- [ ] Verificar que `installer/src-tauri/tauri.conf.json`'s `bundle.icon` apunta al set nuevo (si ya apuntaba a las rutas correctas, no hace falta tocarlo, solo los ficheros).
- [ ] Verificar visualmente el icono generado (renderizarlo/abrirlo) antes de dar la tarea por terminada, igual que se hizo la vez anterior con el icono del indexer.
- [ ] Commit: `git add installer/src-tauri/icons/` + `git commit -m "feat: icono propio del instalador, estrella sobre fondo negro con flecha de descarga"`.

---

### Task 2: Claridad visual de selección en el modal "Otros" (#93)

**Root cause confirmado:** La lógica de selección en `installer/instalador.js` (líneas ~194-217) funciona correctamente — el bug es puramente visual: `.version-row:hover` y `.version-row.seleccionada` en `installer/index.html` solo difieren en 0.02 de opacidad de fondo (`rgba(255,255,255,.035)` vs `rgba(255,255,255,.055)`), prácticamente indistinguibles, sin borde/check/acento que marque la selección.

**Files:** Modify `installer/index.html` (CSS de `.version-row.seleccionada`).

**Steps:**
- [ ] Dar a `.version-row.seleccionada` un tratamiento visual claramente distinto del hover: un borde/acento izquierdo (reutilizar el color de acento ya usado en el resto de la app, ver `.product-card` seleccionada si existe un patrón similar) y/o un icono de check a la derecha de la fila.
- [ ] Verificar visualmente: abrir el modal "Otros" con datos de prueba, pasar el ratón sobre varias filas (hover) y seleccionar una (click) — confirmar que el estado seleccionado se distingue claramente del hover incluso sin el ratón encima.
- [ ] Commit: `git add installer/index.html` + `git commit -m "fix: el estado seleccionado en el modal de version personalizada ahora se distingue claramente del hover"`.

---

### Task 3: Auto-actualización del propio instalador (#94)

**Root cause / contexto confirmado:** No existe ningún mecanismo de auto-actualización para el instalador mismo. `crates/lumi-proto/src/actualizacion.rs`'s `enum Producto` no tiene variante `Instalador` (solo `Cliente`, `Lumid`, `Indexer`). `tools/release_flow.py`'s `PRODUCTOS = ("cliente", "indexer", "lumid")` nunca publica/versiona el instalador en el manifiesto firmado. `installer/src-tauri/src/silencioso.rs` ya tiene lógica de descarga-relanzamiento-cierre para los productos que el instalador INSTALA, pero nunca para sí mismo.

**Files:**
- Modify: `crates/lumi-proto/src/actualizacion.rs` (`enum Producto`, añadir `Instalador`)
- Modify: `tools/release_flow.py` (`PRODUCTOS`, añadir `"installer"`, y el bloque de construcción/publicación para incluirlo)
- Modify: `installer/src-tauri/tauri.conf.json`/`Cargo.toml` (asegurarse de que la versión del instalador se sincroniza igual que los demás productos — revisar `VERSION_FILES`/`escribir_version()` en `release_flow.py`, que según CLAUDE.md ya incluye `installer/src-tauri/{Cargo.toml,tauri.conf.json}` en el lockstep de versión, solo falta que se PUBLIQUE como producto)
- Modify: `installer/src-tauri/src/main.rs` o `comandos.rs` (nueva lógica de auto-chequeo al arrancar)

**Steps:**
- [ ] Leer `crates/lumi-proto/src/actualizacion.rs` completo (`Producto`, `Manifiesto`, `Publicacion`) para entender el patrón de serialización (probablemente `serde` con un `#[serde(rename_all = ...)]` o similar — revisar el nombre exacto que usarían `Cliente`/`Lumid`/`Indexer` serializados, y replicarlo para `Instalador`).
- [ ] Añadir la variante `Instalador` al enum, y actualizar cualquier `match` exhaustivo sobre `Producto` en el crate (el compilador señalará los sitios que falten).
- [ ] En `tools/release_flow.py`, añadir `"installer"` a `PRODUCTOS` y verificar que `construir()`/`subir_github()`/`armar_borrador()` ya generalizan sobre la tupla `PRODUCTOS` sin asumir solo 3 elementos (si hay algo hardcodeado a 3 productos, generalizarlo).
- [ ] En `installer/src-tauri/src/silencioso.rs`, leer el patrón exacto usado para actualizar cliente/indexer/lumid (descarga, verificación de hash, lanzamiento, cierre del proceso viejo) y replicarlo para que el PROPIO instalador se auto-actualice: al arrancar, comprobar `manifiesto.mas_nueva(Producto::Instalador)` contra su propia versión compilada (usar la constante de versión ya disponible, p.ej. `env!("CARGO_PKG_VERSION")` o el patrón que ya use el resto del código para conocer su propia versión), y si hay una más reciente, descargarla, lanzarla, y cerrarse a sí mismo (`std::process::exit` tras spawnear el nuevo proceso, mismo patrón que "kill viejo, lanza nuevo" ya usado en `silencioso.rs` para los demás productos).
- [ ] Este chequeo debe ser silencioso y rápido al arrancar (no bloquear la ventana — recordar el fix de #48/#52 de esta sesión: cualquier llamada de red debe ir en `spawn_blocking`/ser `async`, con timeout, nunca bloquear el hilo de IPC).
- [ ] Verificar `cargo build` limpio en el workspace tras el cambio del enum compartido (afecta a `lumid`, `client/src-tauri`, `indexer/src-tauri` también, ya que todos dependen de `lumi-proto` — revisar que ninguno tenga un `match` exhaustivo sobre `Producto` que ahora falle en compilar por la variante nueva).
- [ ] Commit: `git add crates/lumi-proto/src/actualizacion.rs tools/release_flow.py installer/src-tauri/src/silencioso.rs` (+ cualquier otro archivo que el compilador obligue a tocar por el `match` exhaustivo, documentado en el commit) + `git commit -m "feat: el instalador se auto-actualiza al arrancar si hay una version mas reciente publicada"`.

---

## Verificación final

- [ ] `cargo build` limpio en el workspace COMPLETO (el cambio de `Producto` en `lumi-proto` es compartido — verificar que `client/src-tauri`, `indexer/src-tauri` y `lumid` siguen compilando).
- [ ] `git status --short` vacío tras los commits de este plan.
- [ ] Reportar cualquier desviación del plan al final, especialmente si el `match` exhaustivo de `Producto` obligó a tocar archivos fuera de `installer/`/`crates/lumi-proto`/`tools/` — en ese caso documentar exactamente qué se tocó y por qué era inevitable.
