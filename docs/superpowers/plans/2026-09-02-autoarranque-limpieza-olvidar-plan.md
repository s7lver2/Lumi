# Autoarranque, limpieza de procesos y "Olvidar" servidor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** BUG_BOUNTY #99 (toggle de inicio con el sistema en cliente e indexer), #100 (sin procesos residuales al cerrar, incluido el worker de embebido y lo levantado en WSL), #101+#102 (quitar carpetas de organización de servidores en el cliente, sustituir por un botón "Olvidar" en el menú contextual).

**Architecture:** `client/src-tauri`, `indexer/src-tauri` (nueva dependencia `tauri-plugin-autostart`), `client/src/settings/`, `indexer/src/settings/`, `client/src/entry/ServerSelect.tsx`, `client/src/lib/session.ts`. No tocar `indexer/src-tauri/src/services.rs` más allá de lo estrictamente necesario para #100 — otro plan en paralelo está optimizando ese mismo archivo para el arranque de WSL.

## Global Constraints

- No tests unless explicitly requested.
- Un commit por tarea, mensaje en español.
- `ponytail`: la solución más simple que funcione, preferir el plugin oficial de Tauri antes que reinventar registro de Windows a mano.
- Antes de cada commit: `git status --short`, stage solo archivos exactos de esta tarea (otro agente en paralelo toca `indexer/src-tauri/src/services.rs` y `ServicesBoot.tsx` — si tu tarea de #100 necesita tocar `services.rs`, hazlo con cuidado de no pisar cambios concurrentes: lee el archivo primero, y si ves cambios de otro agente sin commitear ahí, limita tu edición a las líneas exactas del `RunEvent::Exit` handler, no reformatees el resto).

---

### Task 1: Toggle de "iniciar con el sistema" en cliente e indexer (#99)

**Root cause / contexto confirmado:** No existe ningún mecanismo de autoarranque en ninguna de las dos apps hoy — ni el plugin oficial `tauri-plugin-autostart`, ni registro de Windows a mano.

**Files:**
- Modify: `client/src-tauri/Cargo.toml`, `client/src-tauri/src/lib.rs`
- Modify: `indexer/src-tauri/Cargo.toml`, `indexer/src-tauri/src/lib.rs`
- Modify: `client/src/settings/AjustesSidebar.tsx` (+ el panel de ajustes correspondiente, crear uno "General" si no encaja en los existentes)
- Modify: `indexer/src/settings/RendimientoPanel.tsx` (o una sección nueva si no encaja)
- Modify: `client/src/lib/api.ts`, `indexer/src/lib/api.ts` (wrappers del comando)

**Steps:**
- [ ] Añadir `tauri-plugin-autostart` como dependencia en `client/src-tauri/Cargo.toml` e `indexer/src-tauri/Cargo.toml` (usar la misma versión de Tauri v2 ya fijada en el resto del workspace — comprobar compatibilidad de versión del plugin contra `tauri = "2.x"` ya usado).
- [ ] Registrar el plugin en el builder de Tauri de cada app (`client/src-tauri/src/lib.rs`, `indexer/src-tauri/src/lib.rs`), con los argumentos de arranque que ya usa cada app si los hay (revisar si hace falta pasar `--minimized`/similar; si no hay flag equivalente en el proyecto, arrancar normal).
- [ ] Exponer un comando Tauri por app (`autoarranque_leer`/`autoarranque_fijar`, o los nombres que sigan la convención ya usada en `ajustes`/`cola_consumo` de este mismo archivo) que envuelva `enable()`/`disable()`/`is_enabled()` del plugin.
- [ ] En `client/src/lib/api.ts` e `indexer/src/lib/api.ts`, añadir los wrappers correspondientes.
- [ ] En el cliente: añadir el toggle en `AjustesSidebar.tsx`/su panel — si ninguna sección existente encaja bien, crear una nueva sección "General" siguiendo el patrón visual ya usado por las demás (revisar `AjustesView.tsx` para el shell exacto).
- [ ] En el indexer: añadir el toggle en `RendimientoPanel.tsx`, siguiendo el mismo patrón `api.xxxLeer/xxxFijar` que ya usa `colaConsumoLeer/colaConsumoFijar` en ese mismo archivo.
- [ ] Verificar manualmente: activar el toggle en cada app, confirmar (vía el Administrador de tareas > pestaña Inicio, o `shell:startup`) que se registra correctamente; desactivarlo y confirmar que desaparece.
- [ ] Commit: `git add client/src-tauri/Cargo.toml client/src-tauri/src/lib.rs indexer/src-tauri/Cargo.toml indexer/src-tauri/src/lib.rs client/src/settings/ indexer/src/settings/RendimientoPanel.tsx client/src/lib/api.ts indexer/src/lib/api.ts` (ajustar rutas exactas) + `git commit -m "feat: toggle de iniciar con el sistema en cliente e indexer"`.

---

### Task 2: Sin procesos residuales al cerrar el indexer (#100)

**Root cause confirmado:** El hook `RunEvent::Exit` en `indexer/src-tauri/src/lib.rs` (línea ~1858) solo llama a `servicios.parar()` (detiene Redis/mata `self.hijos`). El worker de embebido (`workers/lumi_embed.py`, gestionado por `Cola` en `queue.rs`, guardado como `Trabajador` dentro de `Cola.ranuras`) depende únicamente de `kill_on_drop(true)` para morir — y como Tauri v2 suele salir con `std::process::exit` justo después de `RunEvent::Exit`, los destructores de Rust pueden no llegar a ejecutarse nunca, dejando procesos Python huérfanos.

**Files:** Modify `indexer/src-tauri/src/lib.rs` (el handler de `RunEvent::Exit`).

**Steps:**
- [ ] Leer cómo `Estado.cola`/`Cola.ranuras` expone sus `Trabajador` activos (probablemente un método ya existente para inspeccionar el estado de la cola, o habrá que añadir uno mínimo que devuelva los `Child`/PID de cada ranura ocupada).
- [ ] En el handler de `RunEvent::Exit`, además de `servicios.parar()`, recorrer las ranuras activas de la cola y matar explícitamente cada proceso hijo (`Child::kill()` o el método ya usado en otros puntos del archivo para terminar procesos), en vez de confiar en `kill_on_drop`.
- [ ] Sobre el caso de Qdrant "adoptado" (no arrancado por el Indexer, documentado en `services.rs:378-385` como límite conocido y aceptado): NO intentar matarlo — eso ya es una decisión de diseño explícita y correcta (no es tuyo, no lo tocas). El alcance de esta tarea es solo lo que el Indexer SÍ arrancó y controla.
- [ ] Verificar manualmente si es posible: iniciar un embebido, cerrar el Indexer a mitad, y confirmar en el Administrador de tareas (o `tasklist`) que no queda ningún proceso Python de `lumi_embed.py` colgando.
- [ ] Commit: `git add indexer/src-tauri/src/lib.rs` + `git commit -m "fix: al cerrar el indexer, los workers de embebido en curso se matan explicitamente, no dependen solo de kill_on_drop"`.

---

### Task 3: Quitar carpetas de servidores, añadir "Olvidar" al menú contextual (#101, #102)

**Root cause / contexto confirmado:** `client/src/entry/ServerSelect.tsx` tiene toda la UI de carpetas (`abrirMenuServidor` líneas 47-60 con "Mover a «carpeta»"/"Quitar de la carpeta"/"Nueva carpeta…", `abrirMenuCarpeta` línea 62, input de creación líneas 117-128, render de agrupación 130-145). `forgetServer(addr)` ya existe en `client/src/lib/session.ts:118` pero hoy solo lo usa `migrarDireccion` internamente — no hay ninguna UI que lo exponga directamente.

**Files:**
- Modify: `client/src/entry/ServerSelect.tsx`
- Check: `client/src/lib/session.ts` (limpiar funciones de carpetas que queden sin uso)

**Steps:**
- [ ] En `abrirMenuServidor`, sustituir las entradas de carpeta ("Mover a «carpeta»", "Quitar de la carpeta", "Nueva carpeta…") por una única entrada `{ label: "Olvidar", onClick: () => { forgetServer(s.addr); refrescar(); } }` (usar el nombre real de la función de refresco de la lista ya presente en el componente).
- [ ] Eliminar `abrirMenuCarpeta` (el menú de la fila de carpeta) por completo — ya no hay carpetas que gestionar.
- [ ] Eliminar el estado y JSX de creación de carpeta (`creandoCarpetaPara`, `nombreCarpeta`, el input asociado) y el bloque de render que agrupa servidores por carpeta, dejando la lista de servidores plana (sin agrupar).
- [ ] Revisar `client/src/lib/session.ts`: si `createServerFolder`/`deleteServerFolder`/`moveServerToFolder`/`loadServerFolders`/`loadCarpetasColapsadas`/`toggleCarpetaColapsada` quedan sin ningún llamador tras este cambio (grep para confirmarlo), eliminarlas también — no dejar código muerto.
- [ ] Importar `forgetServer` desde `../lib/session` en `ServerSelect.tsx`.
- [ ] Verificar manualmente: click derecho (o el gesto que ya use este menú — confirmar si es click izquierdo o derecho leyendo el `onContextMenu`/`onClick` actual) sobre un servidor registrado, confirmar que aparece "Olvidar" y que al usarlo el servidor desaparece de la lista; confirmar que ya no aparece ninguna opción de carpetas en ningún sitio de esta pantalla.
- [ ] Commit: `git add client/src/entry/ServerSelect.tsx client/src/lib/session.ts` + `git commit -m "fix: quitar carpetas de organizacion de servidores, sustituir por Olvidar en el menu contextual"`.

---

## Verificación final

- [ ] `cargo build` limpio en el workspace (el plugin de autostart es nuevo, confirmar que compila en `client/src-tauri` e `indexer/src-tauri`).
- [ ] `cd client && npx tsc -b && npm run lint` sin errores.
- [ ] `cd indexer && npx tsc -b && npm run lint` sin errores.
- [ ] `git status --short` vacío tras los commits de este plan.
- [ ] Reportar cualquier desviación al final.
