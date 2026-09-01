# Instalador — Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Arreglar 4 bugs del instalador (`installer/`): iconos genéricos en el asistente y en los accesos directos, congelación "no responde" durante la instalación real, y falta de animaciones/exceso de texto en el modal de versión personalizada.

**Architecture:** Todos los cambios viven en `installer/` (frontend estático `installer/public`+`installer/index.html`+`installer/instalador.js`, backend Tauri `installer/src-tauri/`) más un ajuste puntual en `crates/lumi-installer/` y `tools/release_flow.py`. No tocar `client/` ni `indexer/` — otro plan cubre esos árboles en paralelo.

**Tech Stack:** Tauri v2 (Rust + vanilla JS, sin framework), `mslnk` para accesos directos, `reqwest::blocking`, `tokio::task::spawn_blocking`.

## Global Constraints

- No tests unless explicitly requested (proyecto: `CLAUDE.md`).
- Un commit por tarea terminada, mensaje en español, cuerpo explicando el porqué.
- DESIGN.md: dark-theme-only, sin verde, animaciones solo `cubic-bezier(.16,1,.3,1)` o `cubic-bezier(.22,1,.36,1)` (exponential ease-out), respetar `prefers-reduced-motion` (ya manejado globalmente en `installer/index.html` líneas 105-107).
- `ponytail`: la solución más simple que funcione, sin abstracciones nuevas.
- Antes de cada commit: `git status --short` y confirmar que solo se staged los archivos propios de esta tarea.

---

### Task 1: Iconos reales en el asistente del instalador (#50)

**Root cause confirmado:** `installer/public/icono-cliente.png` e `installer/public/icono-indexer.png` son **el mismo archivo** (SHA1 idéntico `ad26da66...`), un placeholder genérico que nunca se conectó a los iconos reales. `installer/index.html` líneas 328, 337, 434, 437 los referencia vía `<img src="/icono-cliente.png">` / `<img src="/icono-indexer.png">`.

**Files:**
- Modify: `installer/public/icono-cliente.png` — reemplazar por un render real del icono de Lumi client (fuente: `client/src-tauri/icons/icon.png`, SHA1 `a8bdacd4...`).
- Modify: `installer/public/icono-indexer.png` — reemplazar por un render real del icono del Indexer (fuente: `indexer/src-tauri/icons/icon.png`, SHA1 `fe68e44a...`).

**Steps:**
- [ ] Copiar/redimensionar `client/src-tauri/icons/icon.png` a un tamaño apropiado para el asistente (mirar el tamaño actual del placeholder con `file`/dimensiones de imagen antes de decidir — probablemente 128x128 o similar; mantener el mismo tamaño que el placeholder actual para no romper el layout) y sobrescribir `installer/public/icono-cliente.png`.
- [ ] Hacer lo mismo con `indexer/src-tauri/icons/icon.png` → `installer/public/icono-indexer.png`.
- [ ] Verificar visualmente: abrir `installer/index.html` en el navegador embebido (o levantar el instalador con `python tools/build.py` si aplica) y comprobar que las dos tarjetas de producto muestran iconos distintos y reales, no el mismo placeholder.
- [ ] Confirmar que los dos PNG resultantes ya NO son idénticos (`sha1sum` o equivalente).
- [ ] Commit: `git add installer/public/icono-cliente.png installer/public/icono-indexer.png` + `git commit -m "fix: iconos reales de cliente e indexer en el asistente del instalador"`.

---

### Task 2: Icono correcto en accesos directos y exe instalado (#53)

**Root cause confirmado:** El código de acceso directo (`installer/src-tauri/src/comandos.rs:266-275`, `crear_acceso_directo`) es correcto — `mslnk` sin `set_icon_location` hace que Explorer lea el icono directo del `.exe` instalado, que es el comportamiento esperado. El problema real es que `tauri-build`'s `WindowsResource::set_icon_with_id` solo re-embebe `icon.ico` cuando `build.rs` se re-ejecuta, y **no hay `cargo:rerun-if-changed` para el archivo de icono** — un build incremental (`cargo build --release`, usado en todo `tools/release_flow.py`, sin `cargo clean`) puede seguir empaquetando un `.exe` con el icono viejo/genérico aunque `icon.ico` ya se haya corregido en disco.

**Files:**
- Modify: `tools/release_flow.py` — forzar rebuild limpio de `client/src-tauri` e `indexer/src-tauri` antes de empaquetar release.

**Steps:**
- [ ] Leer `tools/release_flow.py` completo para localizar la función que ejecuta `npm run tauri build` para cliente e indexer (probablemente dentro de `lanzar()` o una función `construir_*`).
- [ ] Antes de cada `npm run tauri build`, añadir un paso que borre el build cacheado del crate `src-tauri` correspondiente — la forma más simple y correcta con Cargo es `cargo clean -p <nombre-del-crate>` ejecutado con `cwd` en `client/src-tauri` / `indexer/src-tauri` respectivamente (mirar `Cargo.toml` de cada uno para el nombre exacto del paquete). Alternativa más barata si `cargo clean -p` resulta lento: `touch build.rs` (o su equivalente `Path(...).touch()` en Python) en cada `src-tauri/build.rs` para forzar que Cargo lo re-ejecute — usar esta alternativa (ponytail: más simple, evita recompilar todo el árbol de dependencias).
- [ ] Aplicar la misma limpieza a `installer/src-tauri` si el instalador también embebe icono (comprobar si tiene su propio `icon.ico`).
- [ ] Ejecutar un build real (`python tools/build.py build` o el comando equivalente de solo-build sin publicar) y verificar con el explorador de archivos / `Get-ItemProperty` que el `.exe` resultante de `client/src-tauri/target/release/` e `indexer/src-tauri/target/release/` muestra el icono correcto (no el genérico de Tauri) al inspeccionar sus propiedades.
- [ ] Commit: `git add tools/release_flow.py` + `git commit -m "fix: forzar rebuild limpio de client/indexer para no cachear el icono viejo en releases"`.

---

### Task 3: Instalador ya no se congela durante la instalación real (#52)

**Root cause confirmado:** `installer/src-tauri/src/comandos.rs`, comando `instalar()` (líneas ~158-242) es una función **síncrona** (`pub fn instalar(...)`, sin `async`). Tauri v2 solo hace offload a un hilo de fondo cuando el comando es `async` (o tiene `#[tauri::command(async)]`); una función síncrona se ejecuta directo en el hilo de IPC/mensajería de la ventana. Como `instalar()` hace, en ese mismo hilo: fetch bloqueante del manifiesto, `cerrar_por_nombre` (espera hasta 5s), y sobre todo `aplicar_producto` (`crates/lumi-installer/src/aplicar.rs:33`, `reqwest::blocking::get` **sin timeout** para descargar el artefacto real, que puede pesar mucho más que el manifiesto) — el hilo de la ventana queda bloqueado potencialmente minutos, provocando el "No responde" de Windows durante todo ese tramo, no solo al arrancar.

Esto es el mismo patrón ya arreglado en el bug #48 (`detectar_instalados`/`listar_versiones_disponibles`), aplicado ahora al comando que realmente instala.

**Files:**
- Modify: `installer/src-tauri/src/comandos.rs:158-242` (`instalar`)
- Modify: `crates/lumi-installer/src/aplicar.rs:33` (`aplicar_producto`, la llamada `reqwest::blocking::get`)

**Steps:**
- [ ] En `installer/src-tauri/src/comandos.rs`, cambiar `pub fn instalar(...)` a `pub async fn instalar(...)`.
- [ ] Envolver el cuerpo actual (o como mínimo la llamada a `manifiesto::obtener_verificado()`, `proceso::cerrar_por_nombre(...)`, y el bucle que llama a `aplicar_producto(...)` por cada producto) en `tokio::task::spawn_blocking(move || { ... }).await.expect(...)` — mismo patrón que `detectar_instalados`/`listar_versiones_disponibles` en el mismo archivo (revisar esas dos funciones como referencia exacta de estilo antes de escribir esta).
- [ ] Prestar atención a que `instalar()` probablemente usa `app.emit("progreso", ...)` dentro de callbacks — el `AppHandle`/`Window` debe clonarse (`.clone()`) antes de moverlo dentro del closure de `spawn_blocking`, ya que estos tipos son `Send + Sync` y soportan esto sin problema.
- [ ] En `crates/lumi-installer/src/aplicar.rs:33`, añadir un timeout razonable al cliente usado para `reqwest::blocking::get(&artefacto.url)` — construir un `reqwest::blocking::Client` con `.timeout(std::time::Duration::from_secs(120))` (más generoso que el timeout de 5s del manifiesto en #48, porque aquí se descarga el instalador completo, no solo JSON) en vez de usar `reqwest::blocking::get` directo. Ajustar la firma de la función si hace falta pasar el cliente o construirlo localmente ahí mismo (más simple: construirlo localmente, ponytail).
- [ ] Verificar que `cargo build` en el workspace (`crates/lumi-installer`) y `cargo build` en `installer/src-tauri` compilan sin error.
- [ ] Probar manualmente: ejecutar el instalador (`python tools/build.py` con el target de instalador, o el flujo dev correspondiente) y confirmar que la ventana sigue respondiendo (se puede mover, no aparece "No responde" en el Administrador de tareas) mientras la barra de progreso avanza durante una instalación real.
- [ ] Commit: `git add installer/src-tauri/src/comandos.rs crates/lumi-installer/src/aplicar.rs` + `git commit -m "fix: instalar() ya no bloquea el hilo de IPC, evita 'no responde' durante la instalacion"`.

---

### Task 4: Animaciones y texto del modal de versión personalizada (#51)

**Root cause confirmado:** El modal `#modal-otros`/`.modal-otros-overlay` en `installer/index.html` (markup líneas ~430-450, CSS líneas ~170-210) se abre/cierra puramente con `style.display = "flex"/"none"` en `installer/instalador.js` (líneas 132-207) — sin ninguna clase de transición, a diferencia de `.pantalla-carga` (fade vía `.oculto` + `opacity .45s cubic-bezier(.16,1,.3,1)`) y `.pane.active` (`animation: jg-fade-rise .45s cubic-bezier(.16,1,.3,1) both`). `.version-row` tampoco tiene `transition` (a diferencia de `.product-card`, que sí). Además, `.version-row .sub` (línea ~209) renderiza `v.notas` en crudo sin límite de líneas, y el origen real de textos largos es `tools/release_flow.py`'s `preguntar_notas()` (línea ~275-276), un `input()` libre sin guía de brevedad.

**Files:**
- Modify: `installer/index.html` (CSS: `.modal-otros-overlay`, `.modal-otros`, `.version-row`, `.version-row .sub`)
- Modify: `installer/instalador.js` (líneas 132-207, apertura/cierre del modal)
- Modify: `tools/release_flow.py` (`preguntar_notas()`)

**Steps:**
- [ ] En `installer/index.html`, añadir a `.modal-otros-overlay` una transición de opacidad: `transition: opacity .15s cubic-bezier(.22,1,.36,1)` y controlar visibilidad con una clase (p.ej. `.visible`) en vez de solo `display`, siguiendo el patrón `.oculto` ya usado en `.pantalla-carga`.
- [ ] Aplicar la animación `jg-fade-rise .45s cubic-bezier(.16,1,.3,1) both` (ya definida en el archivo, reutilizar por nombre, no redefinir) a `.modal-otros` cuando se abre, igual que `.pane`/`.error-box`.
- [ ] Añadir `transition: background-color .15s cubic-bezier(.22,1,.36,1)` a `.version-row` para que el hover y el estado `.seleccionada` dejen de ser instantáneos.
- [ ] En `installer/instalador.js`, cambiar la apertura/cierre del modal (líneas ~132-207) de `style.display = "flex"/"none"` a toggle de clase (añadir `.visible` al abrir, quitarla al cerrar con un `setTimeout` corto para permitir que la transición de salida se vea antes de poner `display:none`, o usar `transitionend`). Mantener el cambio mínimo — no reescribir la lógica de selección de versión, solo el mecanismo de mostrar/ocultar.
- [ ] Añadir a `.version-row .sub` (CSS) un recorte de texto: `display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden;` y añadir un atributo `title="${v.notas}"` en el JS que genera esa fila (`instalador.js` línea ~180) para que el texto completo esté disponible al pasar el ratón.
- [ ] En `tools/release_flow.py`, en `preguntar_notas()`, añadir una línea de guía antes del `input()` pidiendo brevedad (p.ej. imprimir `"notas de esta versión (1-2 frases, se muestran recortadas en el instalador):"` en vez del prompt actual) — no forzar un límite de caracteres duro, solo guiar al autor.
- [ ] Verificar visualmente el modal (abrir con datos de prueba, ver que aparece con fade+rise, hover en filas transiciona, y una nota larga de prueba se recorta con `...` y tooltip).
- [ ] Commit: `git add installer/index.html installer/instalador.js tools/release_flow.py` + `git commit -m "fix: animaciones en modal de version personalizada del instalador, recorte de notas largas"`.

---

## Verificación final

- [ ] `cargo build` limpio en el workspace y en `installer/src-tauri`.
- [ ] `cd installer && npm run lint` (si `installer/` tiene su propio `package.json`/lint — comprobar primero; si no existe, omitir).
- [ ] `git status --short` vacío tras todos los commits de este plan.
- [ ] Reportar cualquier desviación del plan (archivos distintos a los previstos, decisiones de diseño no cubiertas aquí) al final.
