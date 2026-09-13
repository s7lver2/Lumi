# Rendimiento del Indexer: arranque, descarga, recursos y revisión — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ejecutar las diez decisiones de código del spec de rendimiento: bundle diferido, portón de servicios no bloqueante, descarga en paralelo tras un interruptor, cola de bytes separada del limitador de API, progreso de embebido incremental, conexiones de lectura separadas de la de escritura, Qdrant con `on_disk`, detección de VHDX en disco mecánico, miniaturas en revisión, y menos invocaciones de `wsl.exe`.

**Architecture:** Cada sección del spec es una unidad casi independiente — se implementan y commitean por separado, en el orden de impacto/riesgo que el spec ya fija en su §7, con una excepción: el progreso incremental (§4.1) debe ir antes que cualquier cosa que dependa de leer `progreso_embebido`, y la cola de bytes (§3.4) va penúltima a propósito porque es la única que cambia el ritmo real contra un proveedor. No se mueve el VHDX de WSL (eso es una acción manual del operador, documentada, no código) — lo que sí es código es que el panel de Ajustes lo detecte y avise.

**Tech Stack:** Rust (tokio, rusqlite, reqwest, image) en `indexer/src-tauri/src`; React/TypeScript en `indexer/src`; configuración de Qdrant vía su API HTTP. Sin dependencias nuevas de Cargo o npm — `@tanstack/react-virtual`, `tokio::task::JoinSet` y `spawn_blocking` ya están en uso en el propio código.

## Global Constraints

- Spec de referencia: `docs/superpowers/specs/2026-09-13-indexer-rendimiento-design.md`. Toda duda de comportamiento se resuelve ahí, no inventando. Los números medidos (83,4 min → 40,5 min, 343,7 ms, 9,9 GB de RSS, 8,6 MB/s) son la justificación de cada tarea y no se re-miden salvo que algo no cuadre.
- **Ningún cambio puede aumentar el ritmo de peticiones que ve un proveedor.** El paralelismo de descarga es ENTRE orígenes, nunca dentro de uno compartiendo el mismo host — `limitador_wikimedia()` y `calles::limitador_overpass()` no se tocan.
- El interruptor de descarga paralela (`descarga_paralela` en `ajustes`) se lee al arrancar la descarga, no en cada tesela — no reconfigurar un plan en curso.
- Nada se descarga sin pasar por presupuesto; lo apuntado sigue siendo lo servido.
- Una descarga cortada se retoma sin pagar dos veces — la unidad de trabajo sigue siendo tesela × origen.
- Español en comentarios, nombres de función y mensajes de log/error, siguiendo el estilo ya presente en el repo.
- **No tests unless explicitly requested** — excepción ya en vigor: `download.rs`, `troceado.rs`, `store.rs` y `origins/` ya llevan `#[cfg(test)] mod tests`. Si una tarea toca lógica ya cubierta por un test existente, ese test debe seguir pasando y puede extenderse; no crear un runner nuevo ni exigir cobertura donde no la había.
- Un commit por tarea terminada.
- Antes de cerrar cada tarea que toque Rust: `cargo test -p indexer-app` (o el nombre real del paquete, comprobar en `indexer/src-tauri/Cargo.toml` — es `indexer-app`) y para las que tocan frontend: `cd indexer && npm run build && npm run lint`. Antes de cerrar el plan entero: los dos, limpios.
- El operador (no este plan) es quien mueve el VHDX de WSL a un SSD — ver Task 8, que solo detecta y avisa.

---

## File Structure

**Nuevos:**
- `indexer/src/ui/PantallaCargaMapa.tsx` (o el nombre que ya siga la convención de `Booting`/`LogBox` — decidir al implementar)

**Modificados (por tarea, ver detalle abajo):**
- `indexer/src/App.tsx`, `indexer/src/territory/MapCanvas.tsx`, `indexer/src/download/DownloadMap.tsx`, `indexer/src/catalog/CoverageMap.tsx`, `indexer/src/catalog/IndexMapDialog.tsx`
- `indexer/src-tauri/src/services.rs`, `indexer/src-tauri/src/lib.rs`
- `indexer/src/setup/ServicesBoot.tsx`, `indexer/src/setup/ServicesFailDialog.tsx`, `indexer/src/ui/Rail.tsx`, `indexer/src/embed/DescargaYEmbebidoView.tsx`
- `indexer/src-tauri/src/download.rs`, `indexer/src-tauri/src/origins/mod.rs`
- `indexer/src/settings/RendimientoPanel.tsx`, `indexer/src/lib/api.ts`
- `indexer/src-tauri/src/store.rs`
- `indexer/src-tauri/src/qdrant.rs`
- `indexer/src-tauri/src/services.rs` (VHDX detection)
- `indexer/src/review/ReviewGrid.tsx`

---

### Task 1: `lazy()` en las rutas con mapa

**Files:**
- Modify: `indexer/src/App.tsx`
- Modify: `indexer/src/territory/TerritoryView.tsx` (o el punto exacto donde se importa `MapCanvas`)
- Modify: cualquier import estático de `mapbox-gl` fuera de los tres componentes de mapa (comprobar con grep antes de tocar)

**Interfaces:**
- No cambia ninguna prop pública; solo cambia CÓMO se cargan `MapCanvas`, `DownloadMap`, `CoverageMap` e `IndexMapDialog`.

- [x] **Step 1: Diferir los cuatro componentes que importan `mapbox-gl`**

Localizar los cuatro puntos (`territory/MapCanvas.tsx`, `download/DownloadMap.tsx`, `catalog/CoverageMap.tsx`, `catalog/IndexMapDialog.tsx`) y envolver su import con `React.lazy()` en el componente que los monta (`TerritoryView`, `DownloadView`, la pantalla de catálogo, el diálogo). Usar `<Suspense fallback={...}>` con un *fallback* mínimo coherente con el vocabulario visual existente (mirar `Booting.tsx` para el tono — sin tarjeta de cristal, sin spinner genérico).

No tocar `@turf/*`: cae en el mismo chunk diferido de `TerritoryView` sin trabajo extra, verificar que efectivamente lo hace tras el build (Step 2).

- [x] **Step 2: Verificar el tamaño del chunk principal** — 2.320,27 kB → 468,38 kB; `mapbox-gl` en su propio trozo de 1.822,72 kB

```bash
cd indexer && npm run build
```

Confirmar en la salida que el chunk principal baja de 2.320 kB a menos de 600 kB, y que aparece un chunk separado con `mapbox-gl` que solo se carga bajo demanda. Si el build sigue avisando de un chunk grande, revisar qué import estático quedó sin diferir (grep `from "mapbox-gl"` en `indexer/src` debe dar solo los cuatro ficheros de mapa, y esos cuatro deben quedar fuera del árbol de imports estáticos de `App.tsx`).

- [ ] **Step 3: Probar manualmente que las pantallas de mapa siguen funcionando** — *pendiente: requiere ojos del operador*

Abrir Territorio, Descarga (con un índice con descarga activa) y el diálogo de cobertura del catálogo; confirmar que el mapa se pinta igual que antes, sin regresión visual ni de interacción (dibujar polígono, ver teselas).

- [x] **Commit:** `perf(indexer): diferir mapbox-gl a las rutas que lo usan`

---

### Task 2: Progreso de embebido incremental

**Files:**
- Modify: `indexer/src-tauri/src/store.rs`
- Modify: `indexer/src-tauri/src/lib.rs` (dónde se llama `progreso_indice`)
- Modify: cualquier punto que marque un vector como `hecho`/`pendiente` (buscar `estado = 'hecho'` y `estado = 'pendiente'` en `store.rs`/`queue.rs`)

**Interfaces:**
- Nueva tabla `progreso_embebido(indice_id INTEGER, modelo TEXT, hechas INTEGER NOT NULL DEFAULT 0, total INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(indice_id, modelo))`.
- `Almacen::progreso_indice(indice_id, modelo) -> Result<(u32,u32)>` cambia de un doble `COUNT(*)` con `JOIN` a un `SELECT` por clave primaria contra la tabla nueva.
- Nuevas funciones en `store.rs`: `progreso_embebido_incrementar(indice_id, modelo)` (suma 1 a `hechas`), y `progreso_embebido_recalcular(indice_id, modelo)` (el `COUNT(*)` de hoy, usado solo en los tres puntos de recálculo).

- [x] **Step 1: Migración de esquema**

En `ESQUEMA` (`store.rs`), añadir:

```sql
CREATE TABLE IF NOT EXISTS progreso_embebido (
    indice_id INTEGER NOT NULL,
    modelo    TEXT NOT NULL,
    hechas    INTEGER NOT NULL DEFAULT 0,
    total     INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (indice_id, modelo)
);
```

Esta tabla nace vacía en una base existente — no hace falta sembrarla desde `imagenes`/`vectores` en la migración: `progreso_indice` debe sembrar-o-leer (`INSERT OR IGNORE` con el `COUNT(*)` de hoy la primera vez que se pide un `(indice_id, modelo)` que no está en la tabla, y desde ahí ya vive incremental). Esto evita un paso de migración que recorra todo `imagenes` de golpe al abrir la app.

- [x] **Step 2: `progreso_indice` lee de la tabla, con siembra perezosa**

```rust
pub fn progreso_indice(&self, indice_id: i64, modelo: &str) -> Result<(u32, u32)> {
    let c = self.0.lock().unwrap();
    if let Some((h, t)) = c.query_row(
        "SELECT hechas, total FROM progreso_embebido WHERE indice_id = ?1 AND modelo = ?2",
        params![indice_id, modelo],
        |r| Ok((r.get::<_, u32>(0)?, r.get::<_, u32>(1)?)),
    ).optional()? {
        return Ok((h, t));
    }
    // Primera vez que se pide este par: sembrar con el recuento real (el
    // COUNT(*) de siempre) y guardarlo, para que la próxima llamada ya sea
    // el SELECT barato.
    drop(c);
    self.progreso_embebido_recalcular(indice_id, modelo)
}
```

`progreso_embebido_recalcular` hace los dos `COUNT(*)` de hoy y los persiste con `INSERT OR REPLACE INTO progreso_embebido`.

- [x] **Step 3: Incrementar en el punto donde un vector pasa a `hecho`** — el punto único es `marcar_vector`; compara con el estado anterior para que reembeber no sume dos veces

Buscar en `queue.rs` (o donde viva) el `UPDATE vectores SET estado = 'hecho'` tras guardar un vector en Qdrant, y justo ahí llamar a una función que suma 1 al `hechas` de `progreso_embebido` para ese `(indice_id, modelo)` — necesita saber el `indice_id` de la imagen, que ya debe estar disponible en ese contexto (si no, un `JOIN` puntual a `imagenes` para resolverlo, una sola vez, no en el camino caliente del sondeo).

```rust
pub fn progreso_embebido_incrementar(&self, indice_id: i64, modelo: &str) -> Result<()> {
    let c = self.0.lock().unwrap();
    c.execute(
        "UPDATE progreso_embebido SET hechas = hechas + 1 WHERE indice_id = ?1 AND modelo = ?2",
        params![indice_id, modelo],
    )?;
    Ok(())
}
```

Si la fila no existe todavía (no se ha llamado nunca a `progreso_indice` para este par), el `UPDATE` no hace nada — está bien: la próxima lectura la sembrará con el `COUNT(*)` real, que ya incluye este vector.

- [x] **Step 4: Incrementar `total` al insertar una imagen nueva con vectores pendientes** — en `insertar_imagen` e `insertar_imagen_de_red`

En `insertar_imagen_de_red` (y el equivalente de ingesta de carpeta/legacy si aplica), tras el `INSERT OR IGNORE INTO vectores`, sumar 1 al `total` de `progreso_embebido` para cada modelo — mismo patrón que Step 3, tolerando fila inexistente.

- [x] **Step 5: Recalcular en los tres puntos que invalidan la cuenta** — `marcar_saltada`, `revision_marcar('rechazada')`, `cancelar_lote`/`estado_lote('cancelado')`; se borran las filas del índice y la próxima lectura las siembra, en vez de adivinar a qué modelos afecta el evento

Grep de `saltada_motivo`, `revision = 'rechazada'` y `estado_lote(...'cancelado')` en `store.rs`/`review.rs`/`lib.rs`. En cada uno de esos tres puntos (crear un índice ya cuenta como "no hay fila todavía", cancelar un lote, rechazar en revisión), llamar a `progreso_embebido_recalcular` para el `(indice_id, modelo)` afectado en vez de confiar en el incremental — son eventos raros, el coste de un `COUNT(*)` ahí es aceptable.

- [x] **Step 6: Test unitario** — `el_progreso_incremental_cuadra_con_el_recuento_real`

Añadir en `store.rs` (o `download.rs` si es más natural con `Falso`) un test que: inserta una imagen con vectores pendientes, comprueba `total` incrementado; marca un vector `hecho`, comprueba `hechas` incrementado; cancela el lote, comprueba que el recálculo baja `total`. Seguir el patrón de tests ya existente en el fichero.

- [x] **Step 7: Verificar el coste real** — `cargo test -p indexer-app` limpio (99). La lectura es un `SELECT` por clave primaria sobre una tabla de (índices × modelos) filas; no se midió contra la base real del operador para no tocarla mientras está en uso

Con la base de datos de prueba (o, si el operador lo permite, contra la real en modo lectura), confirmar que una llamada a `progreso_indice` baja de ~25-170 ms a submilisegundo. `cargo test -p indexer-app` limpio.

- [x] **Commit:** `perf(indexer): progreso de embebido incremental en vez de recalculado`

---

### Task 3: Conexiones de lectura separadas de la de escritura

**Files:**
- Modify: `indexer/src-tauri/src/store.rs`

**Interfaces:**
- `Almacen` pasa de `Mutex<Connection>` a una estructura con una conexión de escritura (`Mutex<Connection>`, comportamiento actual) y un pequeño *pool* de conexiones de solo lectura (p.ej. `Vec<Mutex<Connection>>` de tamaño fijo, 2-4, elegidas por round-robin o por intento de `try_lock`).
- Los métodos que solo leen (`progreso_indice`, `sondeo_leer`, `descargas_pendientes`, etc.) usan una conexión de lectura; los que escriben siguen usando la de escritura. Decidir caso por caso: si un método hace `INSERT`/`UPDATE`/`DELETE` en cualquier rama, va por escritura.

- [x] **Step 1: Diseñar el tipo**

```rust
pub struct Almacen {
    escritura: Mutex<Connection>,
    lectura: Vec<Mutex<Connection>>,
    siguiente_lectura: std::sync::atomic::AtomicUsize,
}
```

Cada conexión (escritura y las de lectura) se abre igual, con el mismo `PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;`. Las de lectura además `PRAGMA query_only = TRUE;` — documentar por qué: evita que un método mal clasificado escriba por la conexión equivocada sin que nadie lo note, falla ruidoso en vez de silencioso.

- [x] **Step 2: `conectar_lectura` y selección round-robin** — 3 conexiones

```rust
fn conectar_lectura(dir: &Path) -> Result<Connection> {
    let c = Connection::open(dir.join("indexer.db"))?;
    c.execute_batch("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA query_only = TRUE;")?;
    Ok(c)
}

fn con_lectura<T>(&self, f: impl FnOnce(&Connection) -> Result<T>) -> Result<T> {
    let i = self.siguiente_lectura.fetch_add(1, std::sync::atomic::Ordering::Relaxed) % self.lectura.len();
    let c = self.lectura[i].lock().unwrap();
    f(&c)
}
```

- [x] **Step 3: Migrar los métodos de solo lectura** — los cinco calientes: `progreso_indice`, `sondeo_leer`, `descargas_pendientes`, `descargas_estados`, `indices_con_pendientes`. El resto sigue por la conexión de escritura, a propósito

Revisar cada método público de `Almacen` (son ~40, según el listado de la investigación) y clasificarlo. Empezar por los que el spec señala como el problema real: `progreso_indice`, `sondeo_leer`, `descargas_pendientes`, `descargas_estados`, `indices_con_pendientes`. Cambiar su `self.0.lock().unwrap()` (o el equivalente tras Task 2) por `self.con_lectura(...)`.

**No migrar de golpe los ~40**: hacerlo para los de lectura caliente listados arriba primero, confirmar que compila y los tests pasan, y dejar el resto para una pasada posterior si el spec no la exige — el objetivo medible es que el sondeo de progreso deje de bloquear al escritor, no una reescritura completa de `store.rs`.

- [x] **Step 4: `reabrir_en` cierra TODAS las conexiones**

Este es el punto delicado que el spec señala explícitamente. `reabrir_en` (migración de carpeta, #55) hoy sustituye solo `self.0`. Con el nuevo tipo debe:

```rust
pub fn reabrir_en(&self, nuevo_dir: &Path) -> Result<()> {
    let nueva_escritura = Self::conectar(nuevo_dir)?;
    let nuevas_lectura: Vec<_> = (0..self.lectura.len())
        .map(|_| Self::conectar_lectura(nuevo_dir).map(Mutex::new))
        .collect::<Result<_>>()?;
    *self.escritura.lock().unwrap() = nueva_escritura;
    for (viejo, nuevo) in self.lectura.iter().zip(nuevas_lectura) {
        *viejo.lock().unwrap() = nuevo.into_inner().unwrap();
    }
    Ok(())
}
```

Verificar que esto realmente suelta TODOS los handles de Windows sobre el `indexer.db` viejo antes de que el llamador intente borrarlo — es la razón de ser de esta función, no romperla.

- [x] **Step 5: `cache_size` y `temp_store`** — en `conectar` y en `conectar_lectura`

En `conectar` y `conectar_lectura`, añadir a los `PRAGMA` existentes: `PRAGMA cache_size = -20000; PRAGMA temp_store = MEMORY;` (20 MB de caché, arriba de los 2 MB por defecto para una base que ya pesa 34 MB y crecerá).

- [x] **Step 6: Verificar concurrencia** — `cargo test -p indexer-app` limpio (99), sin tocar ningún test

`cargo test -p indexer-app` — los tests existentes de `download.rs`/`store.rs` deben seguir pasando sin cambios (usan `Almacen::abrir` igual). Si algún test llama directamente a `self.0` o similar desde fuera del módulo, ajustarlo a la nueva forma.

- [x] **Commit:** `perf(indexer): conexiones de lectura separadas de la de escritura`

---

### Task 4: Descarga en paralelo entre orígenes, tras un interruptor

**Files:**
- Modify: `indexer/src-tauri/src/download.rs`
- Modify: `indexer/src-tauri/src/lib.rs` (donde se construye `Descarga` y se llama `correr`)
- Modify: `indexer/src/settings/RendimientoPanel.tsx`
- Modify: `indexer/src/lib/api.ts`

**Interfaces:**
- Nueva clave en `ajustes`: `descarga_paralela` (texto `"true"`/`"false"`, mismo patrón que `concurrencia_gpu`). Default (ausente) = `true`, según spec §3.3.
- `Descarga::correr` pasa a tomar `self: &Arc<Self>` (o quedarse en `&self` si el `JoinSet` puede clonar `Arc<Descarga>` desde fuera — decidir según cómo ya se construye en `lib.rs`) y lanzar los orígenes en un `JoinSet` cuando el ajuste está activo; si no, mantiene el `for` secuencial actual byte por byte.
- Nuevos comandos Tauri: `descarga_paralela_leer() -> bool`, `descarga_paralela_fijar(bool)`, mismo patrón que `cola_concurrencia_leer`/`fijar`.

- [x] **Step 1: Almacenar y leer el ajuste** — `CLAVE_DESCARGA_PARALELA` en `store.rs`, comandos en `lib.rs`, default `true`

En `store.rs`, añadir constante `pub const CLAVE_DESCARGA_PARALELA: &str = "descarga_paralela";` junto a las claves existentes (`CLAVE_HF_TOKEN`, etc. — buscar dónde viven). En `lib.rs`, comandos `descarga_paralela_leer`/`descarga_paralela_fijar` calcando `cola_concurrencia_leer`/`fijar` (`lib.rs:420-429`), con default `true` cuando la clave no existe (`leer_ajuste(...).ok().flatten().map(|v| v == "true").unwrap_or(true)`).

- [x] **Step 2: `Descarga` necesita `Arc<Self>` para el `JoinSet`** — ya vivía tras un `Arc` en `lib.rs`; `correr` pasa a `self: &Arc<Self>`

Revisar cómo se construye y se guarda `Descarga` hoy en `lib.rs` (`estado.descarga: Mutex<Option<...>>`). Si ya vive detrás de un `Arc` (probable, dado que `Almacen` ya lo está y el patrón se repite), el cambio es local a `correr`:

```rust
pub async fn correr(self: &Arc<Self>, origenes: &[Origen], nuevas: &BTreeMap<String, Vec<String>>, paralelo: bool) {
    if paralelo {
        let mut tareas = tokio::task::JoinSet::new();
        for o in origenes.iter().cloned() {
            let Some(teselas) = nuevas.get(o.id()).cloned() else { continue };
            let this = Arc::clone(self);
            tareas.spawn(async move {
                if this.parar.load(Ordering::SeqCst) { return; }
                this.un_origen(&o, &teselas).await;
            });
        }
        while tareas.join_next().await.is_some() {}
    } else {
        for o in origenes {
            if self.parar.load(Ordering::SeqCst) { break; }
            let Some(teselas) = nuevas.get(o.id()) else { continue };
            self.un_origen(o, teselas).await;
        }
    }
    self.progreso.lock().unwrap().trabajando = false;
    let _ = self.almacen.borrar_ajuste(CLAVE_PLAN_PENDIENTE);
}
```

`Origen` ya es `Arc<dyn OrigenDeRed>` (visto en los tests: `Arc<Falso>` asignado a `Origen`), así que `.cloned()` sobre el `Arc` es barato — verificar el tipo exacto de `Origen` en `origins/mod.rs` antes de escribir esto literal.

**OJO con `self.parar.load` dentro de cada tarea del `JoinSet`**: en el modo paralelo, `parar()` debe seguir cortando cada origen en curso (que ya lo hace, `un_origen` comprueba `self.parar` en su propio bucle de teselas) — el chequeo de arriba, antes de arrancar la tarea, es solo para no lanzar un origen que ni ha empezado si ya se pidió parar entre que se construyó el plan y que corrió el `JoinSet`. No es una garantía nueva, es defensiva.

- [x] **Step 3: Pasar el ajuste desde `lib.rs`** — leído una vez en `descarga_arrancar`

En el comando Tauri que arranca la descarga (`descarga_arrancar` o el nombre real — grep `CLAVE_PLAN_PENDIENTE` en `lib.rs` para encontrarlo), leer `descarga_paralela_leer()` **una vez, al arrancar**, y pasarlo a `correr`. No releerlo dentro del bucle — el spec es explícito en que cambiar el ajuste a mitad no debe afectar un plan en curso.

- [x] **Step 4: Panel de Ajustes**

En `RendimientoPanel.tsx`, junto al control de concurrencia de GPU y modo de baja prioridad, añadir un toggle "Descargar de varios orígenes a la vez" con una nota breve (una frase, tono del resto del panel) explicando que cada origen tiene su propio límite de peticiones y que esto no cambia el ritmo contra ningún proveedor — es información que el operador necesita para confiar en el interruptor, no relleno.

En `api.ts`, añadir `descargaParalelaLeer()`/`descargaParalelaFijar(bool)` calcando las funciones de concurrencia de GPU ya existentes.

- [x] **Step 5: Test unitario del modo paralelo** — `en_paralelo_baja_exactamente_lo_mismo_que_en_serie`, que corre el mismo plan en los dos modos contra bases distintas y compara el progreso final

En `download.rs`, extender los tests existentes (que ya usan `Falso` con varios orígenes, ver `correr_procesa_todos_los_origenes_y_solo_entonces_apaga_trabajando`) con una variante que llame `correr(..., true)` y compruebe que el resultado final (`teselas_hechas`, `imagenes`, `trabajando`) es idéntico al modo secuencial — el paralelismo no debe cambiar QUÉ se descarga, solo CUÁNDO.

- [x] **Step 6: Verificar** — `cargo test -p indexer-app` 100 tests limpios; `npm run build` + `npm run lint` limpios

- [x] **Commit:** `feat(indexer): descargar de varios orígenes a la vez, tras un interruptor`

---

### Task 5: `spawn_blocking` + una transacción por tesela

**Files:**
- Modify: `indexer/src-tauri/src/origins/mod.rs` (`Ctx::bajar_imagen`)
- Modify: `indexer/src-tauri/src/download.rs` (`un_origen`)
- Modify: `indexer/src-tauri/src/store.rs` (nueva función de inserción en lote)

**Interfaces:**
- `Ctx::bajar_imagen` mueve `fs::write` + `image::image_dimensions` a `tokio::task::spawn_blocking`.
- Nueva función `Almacen::insertar_imagenes_de_red_en_lote(indice_id, lote_id, capturas: &[(Captura, String)], modelos: &[String]) -> Result<Vec<i64>>` que envuelve todos los `INSERT` de una tesela en una única transacción.

- [x] **Step 1: `bajar_imagen` no bloquea el runtime** — el closure devuelve un booleano y el mensaje con `redactar(url)` se compone fuera, para no mover `url` al hilo bloqueante

```rust
pub async fn bajar_imagen(&self, url: &str, nombre: &str) -> Result<PathBuf> {
    let nombre = sanear(nombre);
    let _p = self.limitador.permiso().await;
    let r = self.cliente.get(url).send().await?;
    if !r.status().is_success() {
        anyhow::bail!("{} respondió {}", crate::keys::redactar(url), r.status());
    }
    let bytes = r.bytes().await?;
    let stage = self.stage.clone();
    let ruta = stage.join(&nombre);
    let ruta_verificar = ruta.clone();
    tokio::task::spawn_blocking(move || -> anyhow::Result<()> {
        std::fs::create_dir_all(&stage)?;
        std::fs::write(&ruta, &bytes)?;
        if image::image_dimensions(&ruta).is_err() {
            let _ = std::fs::remove_file(&ruta);
            anyhow::bail!("no decodifica como imagen");
        }
        Ok(())
    }).await??;
    self.bajadas.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    Ok(ruta_verificar)
}
```

Revisar el mensaje de error exacto de hoy (usa `crate::keys::redactar(url)`) y conservarlo tal cual dentro del closure, o devolverlo fuera si `redactar` no es `Send`/no puede moverse al hilo bloqueante — comprobar su firma antes de escribir esto literal.

- [x] **Step 2: Inserción por tesela en una transacción** — cuerpo compartido `insertar_imagen_de_red_en(&Connection, ...)`, que vale igual para una `Transaction` por deref

En `store.rs`, nueva función:

```rust
pub fn insertar_imagenes_de_red_en_lote(
    &self,
    indice_id: i64,
    lote_id: i64,
    capturas: &[(lumi_index::network::Captura, String)], // (captura, quadkey_real)
    modelos: &[String],
) -> Result<Vec<i64>> {
    let mut cn = self.0.lock().unwrap(); // o self.escritura tras Task 3
    let tx = cn.transaction()?;
    let mut ids = Vec::with_capacity(capturas.len());
    for (c, qk_real) in capturas {
        // mismo cuerpo que insertar_imagen_de_red, contra `tx` en vez de `cn`
        ...
        ids.push(tx.last_insert_rowid());
    }
    tx.commit()?;
    Ok(ids)
}
```

Extraer el cuerpo actual de `insertar_imagen_de_red` a una función privada que tome `&Transaction` (o `&Connection`, rusqlite acepta ambos vía el trait `ConnectionOrTransaction` si existe, o simplemente duplicar la única query parametrizada — es corta) para no duplicar el SQL entre la versión de una imagen y la de lote. Mantener `insertar_imagen_de_red` como está (llamada desde ingesta legacy/carpeta, que no pasa por este camino) delegando internamente a la misma función compartida con una transacción de una sola fila, para no romper otros llamadores.

- [x] **Step 3: `un_origen` acumula la tesela entera antes de insertar** — se documenta el cambio de comportamiento (opción preferida del plan): una tesela que falla al insertar no entra a medias, se queda sin marcar `hecho` y vuelve como avería. De paso, `sort_by_cached_key` (§4 del spec)

Este es el cambio de forma más delicado de la tarea: hoy `un_origen` inserta imagen a imagen dentro del `for c in &caps`. Cambiar a: recorrer `caps`, filtrar por `qk_real == qk` (igual que hoy, contando `descartadas`), acumular en un `Vec<(Captura, String)>`, y al final del bucle llamar una vez a `insertar_imagenes_de_red_en_lote`. El resto de la lógica (conteo de `n`, `descartadas`, `spend::apuntar`, marcar la tesela `hecho`/`error`) no cambia de orden, solo se mueve después de la inserción en lote.

**Ojo**: si `insertar_imagenes_de_red_en_lote` falla a mitad (raro, pero SQLite puede fallar), hoy una imagen que fallaba individualmente se ignoraba con `let _ =` y las demás seguían. Con una transacción, un fallo descarta la tesela entera. Decidir: o se mantiene el `let _ =` de antes;  o se documenta el cambio de comportamiento (preferible, y más simple: una tesela que falla al insertar ya se trata como "avería, vuelve una vez" en el `Err(e)` del match exterior de `un_origen`, así que el comportamiento observable para el operador es equivalente — una tesela que no entró se reintenta, no se pierde en silencio).

- [x] **Step 4: Verificar con los tests existentes** — 100 tests limpios, sin tocar ninguno

Los tests de `download.rs` que comprueban `imagenes`/`teselas_hechas` deben seguir pasando sin modificación — el resultado observable no cambia, solo el camino interno. `cargo test -p indexer-app`.

- [x] **Commit:** `perf(indexer): descarga no bloquea el runtime, e inserta cada tesela en una transacción`

---

### Task 6: Cola de bytes separada del limitador de API

**Files:**
- Modify: `indexer/src-tauri/src/origins/mod.rs` (`Ctx`, `bajar_imagen`)
- Modify: `indexer/src-tauri/src/origins/mapillary.rs`, `kartaview.rs`, `flickr.rs`, `panoramax.rs`, `openaerialmap.rs` (construcción de `Ctx`)

**Interfaces:**
- `Ctx::nuevo` gana un parámetro más: `(req_s_bytes: u32, conc_bytes: usize)`, o mejor, un segundo `Limitador` opcional que por defecto es `None` (usa el mismo `limitador` de siempre — caso Wikimedia, que NO se separa).
- `bajar_imagen` usa `self.limitador_bytes.as_ref().unwrap_or(&self.limitador)`.

- [x] **Step 1: `Ctx` gana un limitador de bytes opcional**

```rust
pub struct Ctx {
    pub cliente: reqwest::Client,
    pub clave: Option<String>,
    pub stage: PathBuf,
    pub limitador: Limitador,
    /// Limitador SOLO para bajar bytes (CDN), separado del de consultas a la
    /// API. `None` cuando el proveedor no tiene CDN separado de su API —
    /// Wikimedia es el caso: `upload.wikimedia.org` cae bajo la misma
    /// política de contacto/ritmo que `commons.wikimedia.org`, así que ahí
    /// bajar bytes se sigue cobrando contra el mismo limitador, a propósito.
    pub limitador_bytes: Option<Limitador>,
    bajadas: std::sync::atomic::AtomicU32,
    objetivo: std::sync::atomic::AtomicU32,
}

impl Ctx {
    pub fn nuevo(clave: Option<String>, stage: PathBuf, req_s: u32, conc: usize) -> Self {
        Self::con_bytes(clave, stage, req_s, conc, None)
    }

    pub fn con_bytes(
        clave: Option<String>, stage: PathBuf, req_s: u32, conc: usize,
        bytes: Option<(u32, usize)>,
    ) -> Self {
        Self {
            cliente: ...,
            clave, stage,
            limitador: Limitador::nuevo(req_s, conc),
            limitador_bytes: bytes.map(|(r, c)| Limitador::nuevo(r, c)),
            bajadas: ..., objetivo: ...,
        }
    }
}
```

`Ctx::nuevo` mantiene su firma actual (compatibilidad con todos los orígenes que no cambian: google, mapbox, commons, wikipedia, monumentos, wms-orto, geograph, inaturalist), delegando a `con_bytes` con `None`.

- [x] **Step 2: `bajar_imagen` usa el limitador de bytes si existe** — vía `Ctx::limitador_de_bytes()`, para poder probar la elección sin red

```rust
pub async fn bajar_imagen(&self, url: &str, nombre: &str) -> Result<PathBuf> {
    let nombre = sanear(nombre);
    let _p = self.limitador_bytes.as_ref().unwrap_or(&self.limitador).permiso().await;
    ...
}
```

- [x] **Step 3: Los orígenes con CDN propio declaran su cola de bytes** — mapillary, kartaview, flickr, panoramax, openaerialmap

Según spec §3.4:

```rust
// mapillary.rs
Self { ctx: Ctx::con_bytes(Some(token), stage, 8, 4, Some((16, 8))) }
// kartaview.rs
Self { ctx: Ctx::con_bytes(None, stage, 4, 2, Some((8, 4))) }
// flickr.rs
Self { ctx: Ctx::con_bytes(Some(clave), stage, 4, 2, Some((8, 4))) }
// panoramax.rs
Self { ctx: Ctx::con_bytes(None, stage, 2, 1, Some((8, 4))) }
// openaerialmap.rs
Self { ctx: Ctx::con_bytes(None, stage, 4, 2, Some((8, 4))) }
```

**No tocar** `commons.rs`, `wikipedia.rs`, `monumentos.rs` (siguen con `Ctx::nuevo`, sin cola de bytes separada — comparten `limitador_wikimedia()` para todo, API y CDN) ni `google.rs`/`mapbox.rs` (de pago por petición, no aplica) ni `wms_orto.rs`/`geograph.rs`/`inaturalist.rs` (el spec no los lista con CDN separado).

- [x] **Step 4: Verificar que Wikimedia sigue compartiendo un único limitador** — `commons.rs`, `wikipedia.rs` y `monumentos.rs` NO se han tocado: siguen con `Ctx::nuevo` (sin cola de bytes) y sus llamadas a la API siguen pasando por `limitador_wikimedia()`

Grep `limitador_wikimedia` en `commons.rs`, `wikipedia.rs`, `monumentos.rs` — confirmar que ninguno de los tres pasa por `Ctx` en absoluto para sus llamadas a `upload.wikimedia.org` (si `bajar_imagen` de `Ctx` se usa ahí, debe seguir siendo `self.limitador`, es decir, este Task no debe tocar esos tres ficheros en absoluto más que para confirmar que compilan igual).

- [x] **Step 5: Test** — `la_cola_de_bytes_es_la_del_cdn_solo_si_el_origen_la_declara`

Si hay un test existente que instancia `Ctx` directamente (buscar en `#[cfg(test)]` de `origins/mod.rs`), extenderlo para cubrir `con_bytes` con `Some(...)` y confirmar que `bajar_imagen` respeta el límite de bytes, no el de API — puede hacerse con dos `Limitador` de tasas muy distintas y comprobando el tiempo transcurrido, siguiendo el estilo de test ya usado para `Limitador` si existe, o uno nuevo mínimo.

- [x] **Step 6: Verificar** — 101 tests limpios

- [x] **Commit:** `perf(indexer): cola de bytes separada del limitador de API, por origen`

---

### Task 7: Portón de servicios no bloqueante

**Files:**
- Modify: `indexer/src/App.tsx`
- Modify: `indexer/src/setup/ServicesBoot.tsx`
- Modify: `indexer/src/setup/ServicesFailDialog.tsx`
- Modify: `indexer/src/ui/Rail.tsx`
- Modify: `indexer/src/embed/DescargaYEmbebidoView.tsx`

**Interfaces:**
- `App.tsx` deja de renderizar `ServicesBoot`/`ServicesFailDialog` como pantalla completa antes de `dentro`. Entra en cuanto `saludo`+`setupCompleto` resuelven, igual que hoy, pero SIN esperar a `traspasarServicios()`.
- El estado de servicios (arrancando/vivo/fallido) se sondea en segundo plano y se expone como una prop/contexto ligero que `Rail` pinta como un indicador (mismo vocabulario que `descargaActiva`/`embebiendoActivo`).
- `EmbedView` (dentro de `DescargaYEmbebidoView.tsx`) es la única pantalla que exige servicios vivos: si no lo están, pinta el estado real (reutilizando el contenido hoy en `ServicesBoot`/`LogBox`/`ServicesFailDialog`) en el lugar de la rejilla de progreso, no como modal.

- [x] **Step 1: Mover el arranque de servicios a un hook que corre siempre, sin bloquear** — `useServicios(activo, enWindows)` en `setup/ServicesBoot.tsx`, junto a la pieza presentacional `ServiciosArrancando`

Extraer la lógica de `ServicesBoot` (arrancar, sondear cada 800 ms, tope de 375 sondeos, distinguir Windows/no-Windows) a un hook `useServicios()` que devuelve `{ estado: 'arrancando' | 'vivo' | 'fallo', detalle?: string }`. Este hook se monta en `App.tsx` en cuanto `dentro` es verdadero (ya no antes de entrar) y sigue corriendo en segundo plano independientemente de qué pantalla se mire.

- [x] **Step 2: `App.tsx` entra directamente tras identidad, sin esperar servicios** — `traspasarServicios` desaparece; la identidad se resuelve en un efecto y `Booting` cubre ese instante

El flujo `saludo && setupListo === true && !dentro` deja de ramificar en `ServicesBoot`/`ServicesFailDialog`/`ofrecerIdentidad` en secuencia obligatoria. En su lugar: se resuelve identidad (`traspasarServicios` ya hace esto, pero renombrar si conviene ahora que ya no "traspasa" servicios, solo identidad) y se entra (`setDentro(true)`) en paralelo a que `useServicios()` arranca en segundo plano.

`ofrecerIdentidad` no depende de servicios — puede mostrarse igual de rápido que hoy, revisando que no dependía implícitamente de que Redis/Qdrant ya estuvieran vivos en ningún punto (no debería, según el código leído).

- [x] **Step 3: El indicador en el carril** — punto sobre «Ajustes» (es desde ahí donde se resuelve): naranja mientras arranca, rojo si falló, con el título explicándolo

En `Rail.tsx`, añadir un tercer punto de estado (junto a `descargaActiva`/`embebiendoActivo`) que refleje `useServicios().estado`, con el mismo lenguaje visual (punto naranja mientras arranca, algo distinto si falló — revisar `Rail.tsx` para el patrón exacto de los otros dos indicadores y replicarlo, no inventar uno nuevo).

- [x] **Step 4: Solo `EmbedView` exige servicios**

En `DescargaYEmbebidoView.tsx` → `EmbedView`, si `useServicios().estado !== 'vivo'`, renderizar el contenido informativo (arrancando: el mensaje + `LogBox` que hoy tiene `ServicesBoot`; fallo: el contenido de `ServicesFailDialog`, con su botón "Ajustes" y "Reintentar") en el lugar donde hoy iría la rejilla de progreso de embebido — no como diálogo modal que tapa el resto de la app.

- [x] **Step 5: Verificar el resto de pantallas no dependen de servicios** — revisado por código: ninguna llama a `serviciosEstado`, y el progreso de embebido de `IndexDetail` sale de SQLite (`indice_progreso_embebido`), no de Qdrant, así que degrada a «0 hechas» en vez de reventar. *No verificado a ojo: ver Step 6*

Revisar `ProjectsView`, `IndexDetail`, `ReviewGrid`, `TerritoryView`, `PublishDialog` — ninguna debe quedar bloqueada por `useServicios()`. Si alguna llamada a `api.*` falla silenciosamente porque Redis/Qdrant no están (por ejemplo, algo en `IndexDetail` que muestre progreso de embebido), debe degradar mostrando "0 hechas" o el estado real, no reventar — comprobar visualmente.

- [ ] **Step 6: Probar manualmente** — *pendiente: requiere ojos del operador, con Redis/Qdrant parados a propósito*

Con Redis/Qdrant parados a propósito (o el VHDX en frío si es reproducible), confirmar: la app entra a Proyectos de inmediato, Territorio y Revisión funcionan, el carril muestra el indicador de servicios arrancando, y al entrar a Descarga/Embebido se ve el estado real en vez de un modal bloqueante.

- [x] **Commit:** `feat(indexer): los servicios locales arrancan en segundo plano, sin bloquear la entrada`

---

### Task 8: Qdrant `on_disk` + detección de disco mecánico

**Files:**
- Modify: `indexer/src-tauri/src/qdrant.rs`
- Modify: `indexer/src-tauri/src/services.rs`
- Modify: `indexer/src/settings/RendimientoPanel.tsx`
- Modify: `indexer/src/lib/api.ts`

**Interfaces:**
- `asegurar_coleccion` crea colecciones nuevas ya con `on_disk` en `vectors` y `hnsw_config`.
- Nueva función `Qdrant::migrar_a_on_disk(nombre: &str) -> Result<()>` que hace `PATCH /collections/{nombre}` sobre una colección existente.
- Nuevo comando Tauri `qdrant_migrar_on_disk() -> Result<Vec<String>, String>` (aplica a todas las colecciones existentes, devuelve los nombres tocados) detrás de un botón explícito en Ajustes.
- Nuevo comando `disco_wsl_es_mecanico() -> Option<bool>` (o similar) que el panel de Rendimiento usa para avisar.

- [x] **Step 1: Colecciones nuevas nacen con `on_disk`**

```rust
let cuerpo = json!({
    "vectors": { "size": dims, "distance": "Cosine", "on_disk": true },
    "hnsw_config": { "on_disk": true },
    "quantization_config": { "binary": { "always_ram": true } }
});
```

- [x] **Step 2: Migración de colecciones existentes vía `PATCH`** — **DESVIACIÓN**: el cuerpo del plan no vale. Al PARCHEAR, Qdrant 1.19.0 espera un mapa nombre → cambios, y el vector sin nombre se llama `""`; con `{"vectors": {"on_disk": true}}` responde «invalid type: boolean `true`, expected struct VectorParamsDiff». Lo correcto es `{"vectors": {"": {"on_disk": true}}}`, comprobado contra la instancia real

```rust
pub async fn migrar_a_on_disk(&self, nombre: &str) -> Result<()> {
    let url = format!("{}/collections/{nombre}", self.base);
    let cuerpo = json!({
        "vectors": { "on_disk": true },
        "hnsw_config": { "on_disk": true },
    });
    let r = self.http.patch(&url).json(&cuerpo).send().await?;
    if !r.status().is_success() {
        bail!("Qdrant rechazó migrar «{nombre}» a on_disk: {}", r.text().await.unwrap_or_default());
    }
    Ok(())
}

pub async fn migrar_todas_a_on_disk(&self) -> Result<Vec<String>> {
    let r = self.http.get(format!("{}/collections", self.base)).send().await?;
    let cuerpo: serde_json::Value = r.json().await?;
    let nombres: Vec<String> = cuerpo["result"]["collections"].as_array()
        .map(|a| a.iter().filter_map(|c| c["name"].as_str().map(String::from)).collect())
        .unwrap_or_default();
    let mut hechas = Vec::new();
    for n in &nombres {
        self.migrar_a_on_disk(n).await?;
        hechas.push(n.clone());
    }
    Ok(hechas)
}
```

Confirmar la sintaxis exacta del `PATCH` contra la versión real de Qdrant instalada (1.19.0, ya verificado en la investigación) — probar contra la instancia local antes de dar la tarea por cerrada, no solo confiar en la documentación.

- [x] **Step 3: Comando Tauri, sin disparo automático** — `qdrant_migrar_on_disk` no toma `Estado`: `qdrant::Cliente` no vive en él, se construye donde hace falta

En `lib.rs`:

```rust
#[tauri::command]
async fn qdrant_migrar_on_disk(estado: tauri::State<'_, Estado>) -> Result<Vec<String>, String> {
    estado.qdrant.migrar_todas_a_on_disk().await.map_err(|e| e.to_string())
}
```

Registrar en `invoke_handler`. **No llamarlo desde ningún punto de arranque** — solo desde el botón del panel.

- [x] **Step 4: Botón en Ajustes → Rendimiento**

En `RendimientoPanel.tsx`, sección nueva con un botón "Migrar Qdrant a disco" (o el rótulo que mejor encaje con el tono del panel), con el aviso de que Qdrant trabajará de fondo un rato y que es seguro repetirlo. Tras pulsarlo, mostrar el resultado (lista de colecciones migradas) o el error.

- [x] **Step 5: Detección de disco mecánico** — un solo `powershell.exe`: registro `Lxss` → `BasePath` → letra de unidad → `Get-Partition` → `Get-PhysicalDisk.MediaType`

En `services.rs` (Windows only, `cfg!(windows)`), una función que:
1. Resuelve la ruta del VHDX de la distro WSL activa — vía `wsl.exe --list --verbose` para el nombre y el registro (`HKCU:\Software\Microsoft\Windows\CurrentVersion\Lxss`) para `BasePath`, o el comando equivalente ya usado en otras partes de `services.rs` si existe una forma más simple.
2. De esa ruta, extrae la letra de unidad y consulta si el disco físico que la respalda es HDD (`MediaType` vía WMI/PowerShell, `Get-PhysicalDisk`, cruzando por `Get-Partition`/`Get-Volume`).
3. Devuelve `Option<bool>` — `None` si no se pudo determinar (no romper el flujo por esto), `Some(true)` si es mecánico.

Esta detección puede implementarse invocando `powershell.exe` con un script corto (mismo patrón que `en_wsl`/`cmd_async` ya usan para invocar procesos externos) — no hace falta una crate de WMI nueva.

- [x] **Step 6: Comando Tauri y aviso en el panel** — en esta máquina devuelve `Some(true)`: el VHDX vive en D:, que es un HDD, igual que midió el spec

```rust
#[tauri::command]
async fn disco_wsl_es_mecanico(estado: tauri::State<'_, Estado>) -> Option<bool> {
    estado.servicios.disco_wsl_es_mecanico().await
}
```

En `RendimientoPanel.tsx`, si `disco_wsl_es_mecanico() === true`, mostrar un aviso (no bloqueante, no modal) explicando en una frase que los vectores de Qdrant viven en un disco mecánico dentro de WSL y que moverlos a un SSD acelera el arranque — con un enlace o referencia al procedimiento documentado (README o similar), sin que la app intente mover nada sola.

- [x] **Step 7: Verificar contra la instancia real** — probado primero contra `lumi_img__mixvpr_1_0` (13.781 puntos): `on_disk` quedó en `true` en vectores y HNSW, el `scroll` siguió respondiendo, y la colección volvió a `green`. Solo entonces se aplicó a las nueve: todas en `on_disk`, optimizando de fondo (`yellow`, que es lo esperado)

Con permiso ya dado por el usuario (tiene sudo en WSL disponible para esto), probar `migrar_a_on_disk` contra una colección real pequeña primero (`lumi_img__mixvpr_1_0`, 272 MB) y confirmar con `GET /collections/{nombre}` que `on_disk` queda en `true` y que Qdrant sigue sirviendo consultas correctamente después. Solo entonces aplicar a las nueve.

- [x] **Commit:** `perf(indexer): Qdrant con vectores en disco, y aviso si WSL vive en un HDD`

---

### Task 9: Menos invocaciones de `wsl.exe`

**Files:**
- Modify: `indexer/src-tauri/src/services.rs`

**Interfaces:**
- `instalar_en_wsl` agrupa sus comprobaciones de presencia (`hay_en_wsl("redis-server")`, `hay_en_wsl("...qdrant")`) en una sola invocación de `wsl.exe -e sh -lc "..."` que devuelve las dos respuestas (por ejemplo, con un separador conocido en la salida).

- [x] **Step 1: Una sola invocación para las dos comprobaciones** — `hay_en_wsl_lote` sustituye a `hay_en_wsl`, que ya no tenía otros llamadores

```rust
async fn hay_en_wsl_lote(paquetes: &[&str]) -> Vec<bool> {
    let guion = paquetes.iter()
        .map(|p| format!("command -v {p} >/dev/null 2>&1 && echo 1 || echo 0"))
        .collect::<Vec<_>>()
        .join("; ");
    let salida = crate::proceso::cmd_async("wsl", false)
        .args(["-e", "sh", "-lc", &guion])
        .output().await;
    match salida {
        Ok(o) => String::from_utf8_lossy(&o.stdout).lines()
            .map(|l| l.trim() == "1").collect(),
        Err(_) => vec![false; paquetes.len()],
    }
}
```

Sustituir las dos llamadas independientes a `Self::hay_en_wsl(...)` en `instalar_en_wsl` por una sola a `hay_en_wsl_lote(&["redis-server", "$HOME/.lumi-indexer/bin/qdrant"])`.

- [x] **Step 2: Verificar que el orden de la salida coincide** — comentado explícitamente: solo se pregunta por lo que hace falta comprobar, y el cortocircuito de `&&` es lo que mantiene alineadas pregunta y respuesta. Además, si el número de líneas no cuadra con el de paquetes se responde «no está» a todos, en vez de desalinear

Con dos paquetes, la línea 1 corresponde al primero y la línea 2 al segundo — cubrir con un comentario explícito porque es un contrato posicional frágil si alguien añade un tercer paquete sin mirar.

- [x] **Step 3: Probar en real** — ejecutado el guion real contra la distro Ubuntu: devuelve `1` para `redis-server`, `1` para el qdrant de `$HOME/.lumi-indexer/bin` y `0` para un ejecutable inventado, en ese orden. `arrancar_wsl` los sigue viendo presentes y no reinstala nada

Con Redis y Qdrant ya instalados en WSL, confirmar que `arrancar_wsl` sigue detectándolos como presentes y no reinstala nada, y medir (aproximado, con `time`) que el número de invocaciones de `wsl.exe` baja.

- [x] **Commit:** `perf(indexer): agrupar las comprobaciones de presencia en WSL en una sola invocación`

---

### Task 10: Miniaturas en revisión

**Files:**
- Modify: `indexer/src-tauri/src/origins/mod.rs` (`Ctx::bajar_imagen`)
- Modify: `indexer/src-tauri/src/review.rs`
- Modify: `indexer/src/review/ReviewGrid.tsx`
- Modify: `indexer/src-tauri/src/lib.rs` (`revision_pendientes`, si el tope de 120 se retira)

**Interfaces:**
- Al bajar una imagen, además del fichero original, se escribe una miniatura (lado largo 512 px, mismo formato) junto a él — mismo directorio de `stage`, sufijo o subcarpeta clara (p.ej. `mini/` o `-mini` antes de la extensión — decidir con un criterio simple y documentarlo).
- `review::Ficha` gana un campo `ruta_miniatura: Option<String>` (o se calcula la ruta de la miniatura por convención desde `ruta` en el frontend, si el patrón de nombre es determinista — más simple, preferir esto).
- `ReviewGrid.tsx` apunta `<img src>` a la miniatura; solo el original se usa al ampliar (si existe esa interacción — comprobar si `ReviewGrid` ya tiene un modo "ampliar", si no, no inventarlo, es fuera de alcance).

- [ ] **Step 1: Generar la miniatura en el mismo `spawn_blocking` de Task 5**

Extender el closure de `bajar_imagen` (ya movido a `spawn_blocking` en Task 5) para, tras confirmar que `image::image_dimensions` decodifica, cargar la imagen completa una vez con `image::open`, generar un `thumbnail(512, 512)` (mantiene proporción, `image` ya lo soporta) y guardarlo junto al original con un sufijo determinista (`nombre_sin_ext + "-mini." + ext`, o el criterio que se decida — debe ser trivial de reconstruir desde `ruta` sin ir a la base de datos, para no tener que persistir una columna nueva).

```rust
tokio::task::spawn_blocking(move || -> anyhow::Result<()> {
    std::fs::create_dir_all(&stage)?;
    std::fs::write(&ruta, &bytes)?;
    let img = image::open(&ruta).map_err(|_| { let _ = std::fs::remove_file(&ruta); anyhow::anyhow!("no decodifica como imagen") })?;
    let mini = img.thumbnail(512, 512);
    mini.save(ruta_miniatura(&ruta))?;
    Ok(())
}).await??;
```

Definir `ruta_miniatura(ruta: &Path) -> PathBuf` como función libre reutilizable desde donde haga falta reconstruir el nombre (backend y, si el frontend necesita el mismo criterio, documentarlo para que `ReviewGrid` lo replique en TS — más simple: que el backend devuelva la ruta de la miniatura ya resuelta en `review::Ficha`, evitando duplicar la convención de nombres en dos lenguajes).

- [ ] **Step 2: `review::Ficha` incluye la ruta de la miniatura**

```rust
pub struct Ficha {
    pub id: i64,
    pub ruta: String,
    pub ruta_miniatura: Option<String>, // None si no existe (fotos ya bajadas antes de este cambio)
    ...
}
```

En la consulta que construye `Ficha` (`review.rs`), calcular `ruta_miniatura` comprobando si el fichero existe en disco (`Path::exists()`) — no confiar en que siempre está, porque las 34.966 imágenes ya bajadas no la tienen.

- [ ] **Step 3: Generación perezosa para lo ya bajado**

Cuando `ruta_miniatura` es `None` (foto bajada antes de este cambio), `ReviewGrid` sigue usando `ruta` (el original) para esa ficha — no se dispara una migración masiva. Si se quiere generación perezosa real (la primera vez que se pide, se genera y se persiste), documentarlo como posible mejora futura pero NO implementarlo en este plan salvo que sea trivial de añadir en el mismo comando `revision_pendientes` (comprobar si el coste de decodificar-y-reescalar 120 fichas bajo demanda, una vez, es aceptable — probablemente sí, dado que ya se hace `image_dimensions` sobre cada una en algún punto de la ingesta legacy; si no es trivial, dejarlo fuera y decirlo en el commit).

- [ ] **Step 4: `ReviewGrid.tsx` usa la miniatura**

```tsx
<img src={convertFileSrc(f.ruta_miniatura ?? f.ruta)} ... />
```

- [ ] **Step 5: Retirar (o subir) el tope de 120 si aplica**

Con miniaturas, el coste por ficha baja lo suficiente para que el tope de `revision_pendientes` pueda subir o quitarse — pero esto depende de medir cuántas fichas puede aguantar el frontend virtualizado de verdad. **No retirarlo a ciegas**: si se sube, subirlo a un número concreto justificado (p.ej. 2000, con una nota de por qué ese número) o dejarlo en 120 y anotar en el commit que el tope sigue existiendo por otra razón (paginación real pendiente, ya anotado en el código actual) — decidir con el operador si hace falta, no es bloqueante para el resto de la tarea.

- [ ] **Step 6: Probar manualmente**

Abrir Revisión sobre un índice con material ya bajado antes de este cambio (debe verse igual que hoy, con el original) y sobre una descarga nueva de prueba (debe verse la miniatura, notablemente más ligera de cargar).

- [ ] **Step 7: Verificar**

`cargo test -p indexer-app`, `cd indexer && npm run build && npm run lint`.

- [ ] **Commit:** `perf(indexer): miniaturas en revisión, generadas al bajar`

---

## Validación final del plan completo

- [ ] `cargo test -p indexer-app` limpio (workspace completo: `cargo test` desde la raíz también, por si algo de `lumi-index` quedó tocado).
- [ ] `cd indexer && npm run build && npm run lint` limpio.
- [ ] Prueba manual de extremo a extremo: abrir la app con Qdrant en frío (o simulado), confirmar entrada inmediata a Proyectos; activar el interruptor de descarga paralela y lanzar una descarga de prueba con al menos dos orígenes activos, confirmar que corren a la vez (verlo en el registro de la pantalla de Descarga) y que el resultado final (imágenes, gasto, teselas) es correcto; abrir Revisión y confirmar miniaturas; abrir Ajustes → Rendimiento y confirmar el botón de migración de Qdrant y el aviso de disco mecánico si aplica.
- [ ] Repasar que ningún commit dejó `TODO`/comentario a medias, y que cada uno cierra su propia tarea de forma independiente (se puede revertir uno sin romper los demás, salvo Task 4/5/6 que comparten `download.rs`/`origins/mod.rs` — revisar que el historial quede legible igualmente).
