# Cliente — Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Arreglar 4 bugs del cliente Lumi (`client/src/`, fuera del panel de administración) y del daemon `lumid`: el toggle de "reducir movimiento" sigue roto visualmente, el aviso de versión incompatible se solapa/pierde contraste, el login falla en silencio tras forzar entrada con versión incompatible, y la detección de GPU en WSL es intermitente.

**Architecture:** Tres tareas en `client/src/` (settings/entry), una en `crates/lumid/src/`. No tocar `indexer/`, `installer/`, ni `client/src/admin/` — otros planes cubren esos árboles en paralelo.

**Tech Stack:** Tauri v2 + React + TypeScript + Tailwind (cliente), Rust (`nvml-wrapper` para detección de GPU en `lumid`).

## Global Constraints

- No tests unless explicitly requested (proyecto: `CLAUDE.md`).
- Un commit por tarea terminada, mensaje en español, cuerpo explicando el porqué.
- DESIGN.md: dark-theme-only, sin verde, animaciones `cubic-bezier` exponential ease-out, respetar `prefers-reduced-motion`.
- `ponytail`: la solución más simple que funcione.
- Antes de cada commit: `git status --short` y confirmar que solo se staged los archivos propios de esta tarea (otros agentes en paralelo pueden estar tocando `client/src/admin/`/`indexer/`/`installer/` simultáneamente).

---

### Task 1: Toggle de "reducir movimiento" sigue roto visualmente (#86)

**Root cause confirmado:** `client/src/settings/AjustesView.tsx:41-55` — track `h-5 w-9` (20×36px, con borde de 1px añadido en el fix previo de #2), knob `h-3.5 w-3.5` (14px) en `top-0.5`, `translate-x-[18px]` cuando está activo. El margen matemático es exacto (18+14=32 contra un contenedor de 34px, igual que el margen de 2px en estado apagado) — sin ningún margen de tolerancia. Esto se vuelve visible como overflow porque `client/src/lib/apariencia.ts:12-14` aplica `document.documentElement.style.zoom` para "Tamaño de la interfaz" (fix de #29) ENCIMA de `#root { transform: scale(var(--ui-scale)) }` (`client/src/index.css:35-40`) — combinar `zoom` y `transform:scale` genera desajustes de subpíxel en escalas no estándar (85%, 140%, etc.), suficiente para que el margen de 2px, ya sin holgura, se convierta en overflow visible.

**Files:**
- Modify: `client/src/settings/AjustesView.tsx` (el toggle de reducir movimiento — confirmar si es una instancia inline o un componente compartido `Toggle`/`Switch` en `client/src/ui/`)
- Modify: `client/src/lib/apariencia.ts` y/o `client/src/index.css` (el mecanismo de escala doble)

**Steps:**
- [ ] Buscar (Grep `role="switch"`) todas las instancias de este toggle en el codebase para confirmar si es un componente único reutilizado o hay duplicados — el hallazgo previo dice que solo hay una implementación (`role="switch"`) en el archivo, pero verificarlo antes de tocar nada.
- [ ] Dar holgura real al toggle: aumentar el ancho del track (p.ej. de `w-9` a `w-10`) o reducir el tamaño del knob/su traslado, de forma que el margen en ambos extremos deje de estar en el límite exacto (0px de tolerancia) y pase a tener un par de píxeles de aire genuino, en vez de solo corregir el cálculo actual que ya está "bien" en teoría pero frágil en la práctica.
- [ ] Resolver la causa de fondo del desajuste de subpíxel: elegir UN solo mecanismo de escala de interfaz en vez de apilar `zoom` + `transform: scale`. La opción más simple (ponytail): quitar `document.documentElement.style.zoom` de `apariencia.ts` y dejar que `--ui-scale` (ya aplicado vía `transform: scale` en `index.css`) sea el único mecanismo — verificar que "Tamaño de la interfaz" (#29) sigue funcionando correctamente tras quitar el `zoom` duplicado.
- [ ] Verificar visualmente en varias escalas de interfaz (100%, 85%, 140%) que el toggle de reducir movimiento se ve correcto tanto apagado como encendido, sin que la bolita se salga del track.
- [ ] Commit: `git add client/src/settings/AjustesView.tsx client/src/lib/apariencia.ts client/src/index.css` + `git commit -m "fix: toggle de reducir movimiento ya no se rompe visualmente, se unifica el mecanismo de escala de interfaz"`.

---

### Task 2: Aviso de versión incompatible se solapa y pierde contraste (#87)

**Root cause confirmado:** `client/src/entry/VersionMismatchNotice.tsx` (`VersionMismatchModal`, líneas 25-145) se renderiza como overlay fijo (`z-[60]`) dentro de `LoginForm.tsx`, `AddServerForm.tsx`, `PairStep.tsx` — cada uno de esos componentes también renderiza su propio bloque de error normal justo debajo (p.ej. `LoginForm.tsx:107-112`: `{error && !mismatch && ...}`). El solapamiento reportado implica que `mismatch` puede quedar en un estado "falsy pero truthy" simultáneo — sospecha principal: `parseVersionMismatch` (en `client/src/lib/api.ts`) clasifica mal algunos errores que NO son de versión como si lo fueran, dejando ambas UIs (modal + bloque de error del formulario) activas a la vez.

**Files:**
- Modify: `client/src/lib/api.ts` (`parseVersionMismatch` — corregir la heurística de clasificación)
- Modify: `client/src/entry/VersionMismatchNotice.tsx` (contraste/centrado del texto)

**Steps:**
- [ ] Leer `parseVersionMismatch` completo en `client/src/lib/api.ts` y entender qué heurística usa para decidir si un error de login/conexión es "versión incompatible" — buscar casos donde un error genérico (credenciales incorrectas, red caída, etc.) podría hacer match con el patrón usado.
- [ ] Endurecer la heurística para que solo clasifique como mismatch errores que inequívocamente lo sean (p.ej. un código de error específico del backend, no solo un substring de mensaje que podría aparecer en otros contextos).
- [ ] En `VersionMismatchNotice.tsx`, revisar las clases de texto (`text-danger-fg` y el layout flex) — confirmar si el problema de "texto fuera de la caja, no centrado" apunta a una segunda instancia de este aviso en otro sitio (Grep por otro componente similar) o si es un bug de overflow/wrap dentro de este mismo archivo (p.ej. texto largo sin `break-words`/`text-wrap` dentro de un contenedor de ancho fijo). Corregir el contenedor para que el texto siempre quede centrado y contenido, y ajustar el color si `text-danger-fg` no contrasta bien contra el fondo del modal (comparar con otros usos de `text-danger-fg` en el proyecto que sí contrasten correctamente).
- [ ] Verificar manualmente: forzar un error de login normal (credenciales malas) y confirmar que NO aparece el modal de versión incompatible; forzar un verdadero mismatch de versión y confirmar que el modal se ve centrado, con buen contraste, sin solaparse con otro bloque de error.
- [ ] Commit: `git add client/src/lib/api.ts client/src/entry/VersionMismatchNotice.tsx` + `git commit -m "fix: el aviso de version incompatible ya no se confunde con otros errores ni se solapa, mejora contraste y centrado"`.

---

### Task 3: Login falla en silencio tras forzar entrada con versión incompatible (#88)

**Root cause confirmado:** `client/src/entry/LoginForm.tsx:78-84`, `forzarEntrada()` solo llama a `api.reconnect(server.addr, server.fingerprint, true)`, pone `forzarVersion=true` y limpia el error (`setError(null)`) — NUNCA dispara el login real (`POST /v1/auth/login`). El modal se cierra y el formulario vuelve a su estado sin intentar loguear; el usuario tiene que pulsar "Entrar" una segunda vez para que `submit()` (línea ~23) realmente lo intente. Si esa segunda vez falla por credenciales incorrectas, sí debería mostrar el error — pero el síntoma reportado ("falla silenciosamente") sugiere que el flujo completo se percibe como roto porque el primer "continuar" no hizo nada visible.

**Files:** Modify `client/src/entry/LoginForm.tsx`.

**Steps:**
- [ ] Leer `forzarEntrada()` y `submit()` completos para entender la relación entre ambos.
- [ ] Cambiar `forzarEntrada()` para que, tras marcar `forzarVersion=true`, dispare inmediatamente el intento de login real (llamar a la misma lógica que usa `submit()`) en vez de solo cerrar el modal y esperar una segunda pulsación del usuario.
- [ ] Confirmar que si ese login (ahora disparado automáticamente) falla por credenciales incorrectas, el bloque de error normal (`{error && !mismatch && ...}`) sí se muestra correctamente — con el fix de Task 2 aplicado, `mismatch` ya debería estar en `false` en este punto porque el usuario decidió continuar explícitamente.
- [ ] Verificar manualmente el flujo completo: servidor con versión incompatible → "continuar de todos modos" → si las credenciales son incorrectas, ver el error inmediatamente sin tener que pulsar "Entrar" otra vez.
- [ ] Commit: `git add client/src/entry/LoginForm.tsx` + `git commit -m "fix: forzar entrada con version incompatible ahora intenta el login de inmediato en vez de fallar en silencio"`.

---

### Task 4: Detección de GPU en WSL intermitente (#89)

**Root cause confirmado:** `crates/lumid/src/main.rs:343-356` (`gpus()`) se llama una única vez al arrancar el daemon (`main.rs:118`) vía `nvml_wrapper::Nvml::init()`; si falla, devuelve `vec![]` para siempre, cacheado en `app.gpus` durante toda la vida del proceso — sin reintento ni re-sondeo periódico. En WSL2, `/usr/lib/wsl/lib` (donde vive `libnvidia-ml`) se monta de forma asíncrona respecto al arranque de WSL/systemd; si `lumid` arranca antes de que ese montaje esté listo, la detección falla y el daemon queda sin GPU hasta reiniciarlo manualmente.

**Files:** Modify `crates/lumid/src/main.rs` (`gpus()` y su punto de llamada).

**Steps:**
- [ ] Leer `gpus()` y el punto donde se llama en `main.rs:118` para entender cómo se almacena `app.gpus` y qué otras partes del código dependen de leerlo.
- [ ] Añadir un reintento acotado al arrancar: si `Nvml::init()` falla, esperar un breve intervalo (p.ej. 1-2 segundos) y reintentar un número pequeño de veces (p.ej. 3-5 intentos) antes de rendirse — esto cubre el caso típico de "el montaje de WSL todavía no estaba listo en el primer intento", que es la causa más probable según el timing descrito en el bug.
- [ ] Si tras los reintentos iniciales sigue fallando, no dejarlo cacheado como definitivo: exponer una forma de re-sondear sin reiniciar el daemon completo — la opción más simple (ponytail): añadir un endpoint/comando administrativo ya existente (si `lumid` tiene alguna ruta de "refrescar estado de hardware" en el panel de Hardware del admin) que también dispare un nuevo intento de `Nvml::init()` y actualice `app.gpus`, en vez de construir un sistema de sondeo periódico en segundo plano nuevo.
- [ ] Verificar manualmente si es posible: reiniciar WSL, arrancar `lumid` inmediatamente (antes de que el montaje de GPU esté listo) y confirmar que los reintentos consiguen detectar la GPU sin necesidad de un reinicio manual del daemon.
- [ ] Commit: `git add crates/lumid/src/main.rs` + `git commit -m "fix: la deteccion de GPU en WSL reintenta al arrancar, evita quedarse sin GPU por timing de montaje"`.

---

## Verificación final

- [ ] `cd client && npx tsc -b && npm run lint` sin errores.
- [ ] `cargo build` limpio en el workspace (crate `lumid` tocado en Task 4).
- [ ] `git status --short` vacío tras todos los commits de este plan.
- [ ] Reportar cualquier desviación del plan al final.
