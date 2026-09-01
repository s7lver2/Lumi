# Indexer — Licencia de modelos y sellado tras migración — Fixes Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Arreglar dos bugs nuevos del Indexer: la comprobación de licencia de un modelo debe hacerse ANTES de arrancar el embedding (no a mitad de cola) y su fallo debe pausar la cola en vez de reintentar en bucle; y el sellado reporta "0 de N" para todos los modelos tras una migración de carpeta porque la cola de embebido sigue apuntando al directorio viejo mientras el sellado ya lee de la base de datos nueva.

**Architecture:** Cambios en `indexer/src-tauri/src/queue.rs`, `indexer/src-tauri/src/lib.rs`, `indexer/src-tauri/src/store.rs`, y `workers/lumi_pesos.py`/`workers/lumi_embed.py` si hace falta exponer el chequeo de licencia de forma reutilizable desde Rust. No tocar `client/`, `installer/`, ni `crates/lumid`.

**Tech Stack:** Rust (Tauri backend), Python worker (JSON-lines stdio).

## Global Constraints

- No tests unless explicitly requested (proyecto: `CLAUDE.md`).
- Un commit por tarea, mensaje en español explicando el porqué.
- `ponytail`: la solución más simple que funcione.
- Antes de cada commit: `git status --short`, stage solo los archivos exactos de esta tarea.

---

### Task 1: Regresión de sellado tras migración de carpeta (#91) — prioridad alta, es un bug introducido por esta misma sesión

**Root cause confirmado:** `Almacen::reabrir_en` (introducido en el commit de esta sesión que arregló la migración, tarea de #55/#56) intercambia la conexión SQLite compartida de toda la app al migrar, pero `queue::Cola` se construye una única vez al arrancar (`lib.rs:1669`) con un `dir: PathBuf` capturado por valor — tras una migración, la cola de embebido sigue escribiendo/leyendo pesos y resultados contra el directorio VIEJO mientras `sellar()` ya consulta la base de datos NUEVA vía el `Arc<Almacen>` migrado. Resultado: los vectores nunca aparecen como `'hecho'` en la base que el sellado lee, para ningún modelo — "0 de N" sistemático.

**Files:**
- Modify: `indexer/src-tauri/src/queue.rs` (`Cola`, su campo `dir`)
- Modify: `indexer/src-tauri/src/lib.rs` (donde se migra el `Almacen` — la misma función que ya actualiza `ubicacion_leer`)

**Steps:**
- [ ] Leer `queue.rs` completo para entender cómo `Cola` usa su campo `dir` (probablemente para construir las rutas que le pasa al worker Python vía `LUMI_PESOS`/stdio, y quizá para localizar el propio `indexer.db` si abre su propia conexión en vez de compartir el `Arc<Almacen>`).
- [ ] Leer la función de migración en `lib.rs` (la que ya se tocó para #55/#56, probablemente `Migracion::arrancar` o el comando Tauri que la envuelve) para ver exactamente qué se actualiza hoy tras migrar (el `Almacen` compartido, el fichero puntero) y qué NO se actualiza (`Cola.dir`).
- [ ] Añadir un mecanismo para que `Cola` pueda actualizar su `dir` en caliente tras una migración — la forma más simple (ponytail): si `Cola` vive detrás de un `Arc<Mutex<Cola>>`/`RwLock` accesible desde `Estado`, exponer un método `Cola::actualizar_dir(&mut self, nuevo: PathBuf)` y llamarlo desde el mismo punto de la migración donde ya se actualiza el `Almacen`/`estado.dir`. Si `Cola` no es mutable en caliente fácilmente (arquitectura de canal/task en background), la alternativa más simple es hacer que `Cola` NO capture `dir` por valor al construirse, sino que lo lea de la misma fuente de verdad que `ubicacion_leer` (el fichero puntero en disco) cada vez que lo necesite — evita el problema de raíz sin necesitar sincronización entre componentes.
- [ ] Verificar que cualquier ruta que la cola le pase al proceso Python (`LUMI_PESOS`, rutas de imágenes/pesos) usa la ubicación actualizada tras una migración.
- [ ] Si hay tiempo/es sencillo: revisar también el hallazgo secundario del investigador — `sellar()` (`lib.rs:1054`) usa `estado.modelos.clone()` (todos los modelos registrados) en vez de solo los modelos seleccionados para ese índice concreto, lo que podría reportar falsos "0/N" para modelos no elegidos. Si se confirma, intersectar con los modelos del índice (mismo patrón ya usado en `lib.rs:1559`). Si no hay tiempo, dejarlo anotado en el commit para revisión futura — no es la causa raíz principal reportada por el bug (que muestra 0/N en TODOS los modelos, consistente con la causa de migración, no con este hallazgo secundario).
- [ ] Probar manualmente si es posible: migrar la carpeta de datos con un índice a medio embeber, completar el embedding tras la migración, y confirmar que el sellado ya no reporta 0/N para los modelos correctos.
- [ ] Commit: `git add indexer/src-tauri/src/queue.rs indexer/src-tauri/src/lib.rs` (+ `store.rs` si se tocó) + `git commit -m "fix: la cola de embebido ya no queda apuntando al directorio viejo tras migrar, arregla el 0 de N al sellar"`.

---

### Task 2: Comprobar licencias de modelos antes de arrancar el embedding, y pausar la cola si falta una (#90)

**Root cause confirmado:** El chequeo de licencia (`workers/lumi_pesos.py:30-43`, `_licencia`) solo se ejecuta de forma perezosa, dentro del worker Python, la primera vez que se carga un modelo concreto — nunca antes de arrancar la cola. No existe ningún pre-vuelo en Rust. Cuando falla (`workers/lumi_embed.py`'s `_cargar`, `except Exception`), el worker responde `{"tipo":"fallo",...}` y sigue vivo a propósito; en Rust, el bucle de la cola (`queue.rs:404-482`) solo mete ese `indice_id` en un cooldown de 60s tras agotar reintentos — nunca pone `self.pausada = true` (ese flag solo lo cambia el usuario desde el botón "Pausar embebido" en `DescargaYEmbebidoView.tsx`).

**Files:**
- Modify: `indexer/src-tauri/src/queue.rs` (el bucle de arranque/consumo de la cola, y el manejo de `fallo`)
- Modify: `indexer/src-tauri/src/lib.rs` si el comando que arranca el embedding necesita un paso de pre-vuelo antes de invocar la cola.
- Check: `workers/lumi_pesos.py` (`_licencia`) para ver si su lógica de comprobación es reutilizable/invocable de forma barata desde Rust sin cargar el modelo completo (probablemente solo comprueba la existencia de un fichero `LICENCIA.txt` — replicar esa comprobación mínima en Rust es más simple que invocar al worker Python solo para esto).

**Steps:**
- [ ] Leer `workers/lumi_pesos.py:30-43` (`_licencia`) para entender exactamente qué comprueba (ruta esperada del fichero de licencia, formato del error).
- [ ] Antes de que el bucle de la cola (`queue.rs:404`) empiece a consumir trabajo pendiente para un índice, añadir un paso de pre-vuelo: para cada modelo con trabajo pendiente en ese índice, comprobar en Rust (replicando la comprobación mínima de `_licencia`: existencia de `LICENCIA.txt` bajo la carpeta de pesos del modelo) si la licencia está presente. Esto puede vivir como una función `fn licencias_faltantes(dir_pesos: &Path, modelos: &[String]) -> Vec<String>` en `queue.rs` o `pesos.rs` (revisar si ya existe algo parecido ahí, dado que `pesos.rs` ya maneja la descarga de licencias).
- [ ] Si hay modelos con licencia faltante, NO arrancar la cola para ese trabajo — devolver/emitir el mismo tipo de error que ya surge hoy (el que dispara la UI de "Descargar pesos" en `DescargaYEmbebidoView.tsx:89-98`) pero ANTES de empezar, no como resultado de un lote fallido a mitad de cola.
- [ ] Para el caso en que el fallo ocurra de todos modos en pleno vuelo (razón defensiva: alguien borra el fichero de licencia mientras la cola corre) — en el bucle de `queue.rs:460-478`, cuando el `fallo` devuelto por el worker sea específicamente por licencia faltante (distinguir este caso del resto de fallos transitorios, mirando el mensaje/tipo de error que ya envía el worker), poner `*self.pausada.lock().unwrap() = true` en vez de solo aplicar el cooldown de 60s al `indice_id` — un fallo de licencia no es transitorio, reintentar no lo va a arreglar solo, así que debe pausar y esperar acción del usuario.
- [ ] Verificar manualmente si es posible: quitar/renombrar temporalmente un `LICENCIA.txt` de un modelo, iniciar embedding, confirmar que el aviso aparece ANTES de que la cola empiece a trabajar (no a mitad de lote) y que si el fallo ocurre igualmente, la cola queda pausada en vez de seguir reintentando en bucle.
- [ ] Commit: `git add indexer/src-tauri/src/queue.rs indexer/src-tauri/src/lib.rs` (+ `pesos.rs` si se tocó) + `git commit -m "fix: comprobar licencias de modelos antes de arrancar el embedding y pausar la cola si falta una"`.

---

## Verificación final

- [ ] `cargo check -p lumi-index` y `cargo check` en `indexer/src-tauri` limpios.
- [ ] `cd indexer && npx tsc -b && npm run lint` sin errores (si tocaste algo del frontend, aunque este plan es mayormente backend).
- [ ] `git status --short` vacío tras los commits de este plan.
- [ ] Reportar cualquier desviación del plan al final.
