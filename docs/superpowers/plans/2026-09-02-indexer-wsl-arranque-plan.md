# Indexer — Arranque de WSL bloqueante — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** BUG_BOUNTY #103 (bloqueante, prioridad máxima): el auto-arranque de servicios WSL al abrir el Indexer YA EXISTE (`ServicesBoot.tsx`), pero su límite de 72s (90 intentos × 800ms) es demasiado corto para un arranque en frío de WSL + instalación de Redis/Qdrant, así que cae al diálogo manual con demasiada frecuencia. Además la instalación es secuencial pudiendo ser paralela, y el log de Qdrant/Redis (ya capturado) no llega al panel de Debug para poder diagnosticar futuras lentitudes con datos reales.

**Architecture:** Todo en `indexer/src-tauri/src/services.rs`, `indexer/src/setup/ServicesBoot.tsx` y `indexer/src-tauri/src/lib.rs`. No tocar `client/` — otro plan cubre ese árbol en paralelo.

## Global Constraints

- No tests unless explicitly requested.
- Un commit por tarea, mensaje en español.
- `ponytail`: la solución más simple que funcione.
- Antes de cada commit: `git status --short`, stage solo archivos exactos de esta tarea (otro agente en paralelo toca `client/`).

---

### Task 1: Alargar el margen de espera del auto-arranque, con feedback de progreso real

**Root cause confirmado:** `ServicesBoot.tsx` sondea 90 veces a intervalos de 800ms (≈72s) y si se agota cae a `ServicesFailDialog` pidiendo acción manual. Un arranque en frío de WSL (VM parada tras ~8 min de inactividad o tras reiniciar Windows) más `apt-get update` más la descarga de Qdrant puede superar ese margen de sobra, sobre todo la primera vez.

**Files:**
- Modify: `indexer/src/setup/ServicesBoot.tsx`

**Steps:**
- [ ] Aumentar el límite de intentos/tiempo total a un margen mucho más generoso para el PRIMER arranque tras instalar (p.ej. 5 minutos), mantener algo más corto para arranques posteriores si el código ya distingue "primera vez" de "ya instalado" (revisar si `Servicios::arrancar_wsl` expone esa distinción; si no, aplicar el margen generoso siempre — más simple, ponytail).
- [ ] Mientras se espera, mostrar al usuario en qué fase está (instalando Redis / instalando Qdrant / arrancando) en vez de un spinner mudo, leyendo el mismo log que ya captura `Servicios::lanzar` (`servicios_log`, ya expuesto como comando Tauri) — esto le da al usuario una señal de que sigue avanzando, no colgado, y reduce la sensación de "tarda muchísimo" aunque el tiempo real no cambie.
- [ ] Verificar que, si el margen SÍ se agota (caso real de fallo, no solo lentitud), sigue cayendo correctamente a `ServicesFailDialog` como hasta ahora.
- [ ] Commit: `git add indexer/src/setup/ServicesBoot.tsx` + `git commit -m "fix: el auto-arranque de WSL espera lo suficiente para un arranque en frio, con progreso visible"`.

---

### Task 2: Instalar Redis y Qdrant en paralelo, no en secuencia

**Root cause confirmado:** `Servicios::instalar_en_wsl` (`services.rs:271-313`) instala Redis (`apt-get install redis-server`) y LUEGO Qdrant (búsqueda de release + descarga + extracción) de forma completamente secuencial, aunque son independientes entre sí.

**Files:** Modify `indexer/src-tauri/src/services.rs`.

**Steps:**
- [ ] Leer `instalar_en_wsl` completo para entender las dos rutas de instalación (Redis vía `apt-get`, Qdrant vía descarga de binario) y confirmar que no comparten estado/recursos que impidan paralelizar (ambas corren dentro de la misma distro WSL vía `wsl -u root -e sh -lc "..."`, pero como procesos `wsl.exe` independientes deberían poder correr a la vez sin conflicto, ya que `apt-get` y una descarga de Qdrant no tocan los mismos ficheros).
- [ ] Lanzar ambas instalaciones como tareas async concurrentes (`tokio::join!` o equivalente ya usado en el resto del archivo) en vez de `.await` una tras otra.
- [ ] Verificar manualmente (si es posible reproducir un entorno limpio) que la instalación combinada tarda aproximadamente lo que tarda la más lenta de las dos, no la suma de ambas.
- [ ] Commit: `git add indexer/src-tauri/src/services.rs` + `git commit -m "fix: instalar redis y qdrant en wsl en paralelo, no en secuencia"`.

---

### Task 3: Log de Qdrant/Redis visible en el panel de Debug

**Root cause confirmado:** `Servicios::lanzar` ya captura stdout+stderr de Redis/Qdrant línea a línea en un `Log` en memoria (`services.rs:37-58`, cap 2000 líneas), expuesto vía el comando Tauri `servicios_log` y renderizado hoy solo en pantallas del flujo de setup (`ServicesStep`, `ServicesFailDialog`, `ServicesPanel`, `RuntimeStep` — todas usan `<LogBox/>`). El panel general de Debug (`DebugPanel.tsx`) lee un fichero de log aparte (`indexer.log`, vía `debug_log_leer`) al que este log nunca llega, porque `Log::apuntar` no pasa por `tracing::`.

**Files:**
- Modify: `indexer/src-tauri/src/services.rs` (`Log::apuntar`)

**Steps:**
- [ ] En `Log::apuntar` (o el punto exacto donde cada línea de stdout/stderr de Redis/Qdrant se añade al buffer en memoria), añadir también `tracing::info!(...)` (o `debug!`, según el nivel que ya use el resto del archivo para logs de servicios) con esa misma línea, prefijada con el nombre del servicio (`[redis]`/`[qdrant]`) para que sea identificable dentro del log combinado.
- [ ] Verificar que arrancando los servicios, las líneas de Qdrant/Redis aparecen ahora en `DebugPanel.tsx` (leer vía `debug_log_leer`) sin necesidad de tocar ese componente — la vía es que ya lee de `tracing`, así que basta con emitir ahí.
- [ ] Commit: `git add indexer/src-tauri/src/services.rs` + `git commit -m "feat: el arranque de qdrant y redis en wsl se vuelca tambien al log de debug general"`.

---

## Verificación final

- [ ] `cargo check` en `indexer/src-tauri` limpio.
- [ ] `cd indexer && npx tsc -b && npm run lint` sin errores.
- [ ] `git status --short` vacío tras los commits de este plan.
- [ ] Reportar cualquier desviación al final. Este plan es prioritario — el usuario está bloqueado ahora mismo, así que si alguna tarea resulta más compleja de lo previsto, prioriza Task 1 (el margen de espera) sobre las otras dos, ya que por sí sola ya desbloquea el uso normal.
