# Compatibilidad de versión cliente↔servidor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** El cliente se niega a completar el pairing/reconexión si su versión y la de `lumid`
no coinciden exactamente, y ofrece un camino de salida: si el cliente es más nuevo, pedir al
servidor que actualice (nueva solicitud visible para el admin) o hacer downgrade del cliente; si
el servidor es más nuevo, actualizar el cliente. Ambos caminos de actualización instalan una
versión **exacta**, no "la más nueva".

**Architecture:** Extiende tres piezas ya existentes en vez de crear infraestructura nueva:
`lumi-proto::actualizacion` gana una consulta por versión exacta, el instalador compartido
(`installer.exe --silencioso`) gana un flag `--version-objetivo=`, y el patrón ya establecido de
"una tabla por clase de solicitud" (`access_requests`/`credit_requests`) gana una tercera tabla
`version_mismatch_requests`. El punto de detección es único: `connect()` en
`client/src-tauri/src/main.rs`, ya la puerta de entrada de `pair`/`reconnect`/`pair_card`.

**Tech Stack:** Rust (axum, rusqlite, tauri v2), React + TypeScript, SQLite.

## Global Constraints

- Spec fuente: [2026-08-26-compatibilidad-de-version-design.md](../specs/2026-08-26-compatibilidad-de-version-design.md).
- Español en código, comentarios y copy de UI — igual que el resto del repo.
- **No escribir tests salvo en `lumi-proto`** (convención del proyecto, `CLAUDE.md`): las demás
  tareas se verifican con `cargo build`/`cargo check`/`npm run build`, no con tests nuevos.
- Cualquier diferencia de versión (major, minor o patch) bloquea — no hay compatibilidad parcial.
- El Indexer no habla con `lumid`: ninguna tarea de este plan lo toca.
- Un commit por tarea terminada, mensaje en español, sin `--no-verify`.

---

### Task 1: `lumi-proto` — comparador reutilizable y consulta por versión exacta

**Files:**
- Modify: `crates/lumi-proto/src/actualizacion.rs`

**Interfaces:**
- Produces: `pub fn comparar(a: &str, b: &str) -> std::cmp::Ordering` (ya existía, se hace `pub`),
  `pub fn partes(v: &str) -> (u32, u32, u32)` (ídem), `Manifiesto::version_exacta(&self,
  producto: Producto, version: &str, plataforma: &str) -> Option<&Publicacion>`.

- [ ] **Paso 1: hacer `pub` `partes`, `comparar` y `es_mas_nueva`**

En `crates/lumi-proto/src/actualizacion.rs`, cambia las firmas (líneas 139, 144, 148) de:

```rust
fn partes(v: &str) -> (u32, u32, u32) {
```
```rust
fn comparar(a: &str, b: &str) -> std::cmp::Ordering {
```
```rust
fn es_mas_nueva(candidata: &str, actual: &str) -> bool {
```

a `pub fn partes(...)`, `pub fn comparar(...)`, `pub fn es_mas_nueva(...)` respectivamente (mismo
cuerpo, solo cambia la visibilidad). El comentario de línea 136-138 ("Ponytail: no hay sufijo de
pre-release...") se queda igual, sigue aplicando.

- [ ] **Paso 2: añadir `Manifiesto::version_exacta`**

Dentro del `impl Manifiesto` (después de `version_retirada`, que termina en la línea 133), añade:

```rust
    /// La publicación de `producto` para `plataforma` cuya versión coincide
    /// EXACTAMENTE con `version` (a diferencia de `mas_nueva`, que exige que
    /// sea más nueva). Necesaria para downgrade y para igualar la versión de
    /// un servidor que no sea la última publicada — ver
    /// docs/superpowers/specs/2026-08-26-compatibilidad-de-version-design.md.
    /// Una versión retirada no se ofrece tampoco aquí: "retirada" significa
    /// "no instalar esto", sea cual sea la dirección.
    pub fn version_exacta(&self, producto: Producto, version: &str, plataforma: &str) -> Option<&Publicacion> {
        self.publicaciones
            .iter()
            .filter(|p| p.producto == producto && !p.retirada)
            .filter(|p| p.artefactos.iter().any(|a| a.plataforma == plataforma))
            .find(|p| comparar(&p.version, version) == std::cmp::Ordering::Equal)
    }
```

- [ ] **Paso 3: tests, mismo estilo que los de `mas_nueva`**

Añade al `mod tests` (después de `mas_nueva_ignora_otro_producto`, antes de
`version_retirada_detecta_la_propia_y_solo_esa`):

```rust
    #[test]
    fn version_exacta_encuentra_solo_la_igual() {
        let m = manifiesto_de_prueba();
        assert!(m.version_exacta(Producto::Lumid, "2.1.0", "linux-x86_64").is_some());
        assert!(m.version_exacta(Producto::Lumid, "2.0.0", "linux-x86_64").is_none());
        assert!(m.version_exacta(Producto::Lumid, "2.2.0", "linux-x86_64").is_none());
    }

    #[test]
    fn version_exacta_ignora_retirada() {
        let mut m = manifiesto_de_prueba();
        m.publicaciones[0].retirada = true;
        assert!(m.version_exacta(Producto::Lumid, "2.1.0", "linux-x86_64").is_none());
    }
```

- [ ] **Paso 4: verificar**

Run: `cargo test -p lumi-proto`
Expected: todos los tests pasan, incluidos los dos nuevos.

- [ ] **Paso 5: commit**

```bash
git add crates/lumi-proto/src/actualizacion.rs
git commit -m "feat: lumi-proto expone comparador de versiones y consulta por version exacta"
```

---

### Task 2: `lumi-proto` — tipos para el aviso de versión distinta

**Files:**
- Modify: `crates/lumi-proto/src/api.rs`

**Interfaces:**
- Consumes: nada nuevo de otras tareas.
- Produces: `VersionMismatchReq`, `VersionMismatchInfo`, y la variante
  `EventoAdmin::SolicitudVersion` — los usa la Tarea 3 (rutas de `lumid`).

- [ ] **Paso 1: añadir los dos structs**

En `crates/lumi-proto/src/api.rs`, justo después de `ResolveCreditReq` (línea 435, antes del
comentario de `EventoAdmin` en la línea 437):

```rust
#[derive(Debug, Serialize, Deserialize)]
pub struct VersionMismatchReq {
    pub version_cliente: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct VersionMismatchInfo {
    pub id: i64,
    pub version_cliente: String,
    pub source_ip: String,
    pub created_at: i64,
    pub resolved_at: Option<i64>,
}
```

- [ ] **Paso 2: añadir la variante a `EventoAdmin`**

En el `enum EventoAdmin` (líneas 440-457), añade una variante nueva antes de `ColaCambio`:

```rust
    /// Un cliente detectó que su versión no coincide con la del servidor y
    /// pidió que se avise. No hay nada que aprobar/conceder — a diferencia
    /// de `SolicitudAcceso`/`SolicitudCredito`, el admin solo se entera y
    /// actualiza `lumid` por su cuenta (`ActualizacionesView.tsx`).
    SolicitudVersion {
        version_cliente: String,
    },
```

- [ ] **Paso 3: verificar**

Run: `cargo check -p lumi-proto`
Expected: compila sin errores (nadie más referencia estos tipos todavía).

- [ ] **Paso 4: commit**

```bash
git add crates/lumi-proto/src/api.rs
git commit -m "feat: lumi-proto define los tipos del aviso de version distinta"
```

---

### Task 3: `lumid` — tabla, rutas y registro del aviso de versión distinta

**Files:**
- Modify: `crates/lumid/src/store.rs`
- Modify: `crates/lumid/src/routes/mod.rs`
- Create: `crates/lumid/src/routes/version_mismatch.rs`
- Modify: `crates/lumid/src/main.rs`

**Interfaces:**
- Consumes: `VersionMismatchReq`, `VersionMismatchInfo`, `EventoAdmin::SolicitudVersion` (Tarea
  2); `crate::routes::access::now`, `crate::routes::auth::{bearer, require_admin}`,
  `crate::routes::projects::{err, Fail}` (ya existentes, mismo patrón que
  `credit_requests.rs`).
- Produces: `routes::version_mismatch::{create, list_all, resolve}`, montadas en
  `POST /v1/version-mismatch` (sin auth), `GET /v1/admin/version-mismatch` (admin),
  `POST /v1/admin/version-mismatch/:id/resolve` (admin) — las consume la Tarea 6 (UI de admin) y
  la Tarea 5 (cliente, al pedir la actualización).

- [ ] **Paso 1: tabla nueva en el esquema**

En `crates/lumid/src/store.rs`, dentro de la constante `SCHEMA`, justo después de la tabla
`credit_requests` (que termina en la línea 65 con `);`), añade:

```sql
CREATE TABLE IF NOT EXISTS version_mismatch_requests (
    id              INTEGER PRIMARY KEY,
    version_cliente TEXT NOT NULL,
    source_ip       TEXT NOT NULL,
    created_at      INTEGER NOT NULL,
    resolved_at     INTEGER,
    resolved_by     INTEGER
);
```

- [ ] **Paso 2: registrar el módulo de rutas**

En `crates/lumid/src/routes/mod.rs`, añade una línea junto a los demás (orden alfabético, entre
`pub mod telemetry;` y `pub mod models;` no aplica — el archivo no está estrictamente ordenado
al final; añádela junto a `pub mod tasks;`):

```rust
pub mod version_mismatch;
```

- [ ] **Paso 3: crear el archivo de rutas**

Crea `crates/lumid/src/routes/version_mismatch.rs` con:

```rust
//! Aviso de que un cliente detectó una versión distinta a la del servidor.
//! Mismo patrón que `access_requests`/`credit_requests`: una tabla, un
//! estado. A diferencia de esas dos, no hay nada que aprobar/conceder — el
//! admin solo se entera (`EventoAdmin::SolicitudVersion`, panel de
//! Solicitudes) y actualiza `lumid` por su cuenta desde
//! `ActualizacionesView.tsx`. `create` es sin autenticación, igual que
//! `access_requests::create` (segunda superficie escribible sin
//! credenciales del proyecto): mismo régimen anti-abuso, mismos límites.

use crate::routes::access::now;
use crate::routes::auth::{bearer, require_admin};
use crate::routes::projects::{err, Fail};
use crate::App;
use axum::extract::{ConnectInfo, Path, State};
use axum::{http::HeaderMap, http::StatusCode, Json};
use lumi_proto::api::{EventoAdmin, VersionMismatchInfo, VersionMismatchReq};
use std::net::SocketAddr;

const MAX_VERSION_LEN: usize = 32;
const PER_HOUR: i64 = 3;
const PER_DAY: i64 = 10;
const MAX_PENDING: i64 = 100;

pub async fn create(
    State(app): State<App>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    Json(req): Json<VersionMismatchReq>,
) -> Result<StatusCode, Fail> {
    let version_cliente = req.version_cliente.trim();
    if version_cliente.is_empty() || version_cliente.chars().count() > MAX_VERSION_LEN {
        return Err(err(StatusCode::BAD_REQUEST, "version invalida"));
    }

    let ip = peer.ip().to_string();
    let t = now();
    let c = app.store.conn();
    let count = |since: i64| -> i64 {
        c.query_row(
            "SELECT COUNT(*) FROM version_mismatch_requests WHERE source_ip = ?1 AND created_at > ?2",
            rusqlite::params![ip, since],
            |r| r.get(0),
        )
        .unwrap_or(0)
    };
    if count(t - 3600) >= PER_HOUR {
        return Err(err(StatusCode::TOO_MANY_REQUESTS, "demasiadas solicitudes; espera una hora"));
    }
    if count(t - 86400) >= PER_DAY {
        return Err(err(StatusCode::TOO_MANY_REQUESTS, "demasiadas solicitudes; espera 24 horas"));
    }
    let pending: i64 = c
        .query_row(
            "SELECT COUNT(*) FROM version_mismatch_requests WHERE resolved_at IS NULL",
            [],
            |r| r.get(0),
        )
        .unwrap_or(0);
    if pending >= MAX_PENDING {
        return Err(err(
            StatusCode::SERVICE_UNAVAILABLE,
            "hay demasiadas solicitudes sin resolver; inténtalo más tarde",
        ));
    }

    c.execute(
        "INSERT INTO version_mismatch_requests (version_cliente, source_ip, created_at) VALUES (?1, ?2, ?3)",
        rusqlite::params![version_cliente, ip, t],
    )
    .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;
    let id = c.last_insert_rowid();
    tracing::info!("aviso de version distinta #{id} desde {ip}: cliente en {version_cliente}");
    let _ = app.admin_eventos.send(EventoAdmin::SolicitudVersion {
        version_cliente: version_cliente.to_string(),
    });
    Ok(StatusCode::CREATED)
}

fn map_row(r: &rusqlite::Row) -> rusqlite::Result<VersionMismatchInfo> {
    Ok(VersionMismatchInfo {
        id: r.get(0)?,
        version_cliente: r.get(1)?,
        source_ip: r.get(2)?,
        created_at: r.get(3)?,
        resolved_at: r.get(4)?,
    })
}

pub async fn list_all(
    State(app): State<App>,
    headers: HeaderMap,
) -> Result<Json<Vec<VersionMismatchInfo>>, StatusCode> {
    require_admin(&app, &bearer(&headers))?;
    let c = app.store.conn();
    let mut q = c
        .prepare(
            "SELECT id, version_cliente, source_ip, created_at, resolved_at
             FROM version_mismatch_requests ORDER BY (resolved_at IS NULL) DESC, created_at DESC",
        )
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let rows = q.query_map([], map_row).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(rows.flatten().collect()))
}

pub async fn resolve(
    State(app): State<App>,
    Path(id): Path<i64>,
    headers: HeaderMap,
) -> Result<StatusCode, Fail> {
    let admin = require_admin(&app, &bearer(&headers))
        .map_err(|c| (c, "hace falta ser administrador".to_string()))?;
    let c = app.store.conn();
    let t = now();
    let n = c
        .execute(
            "UPDATE version_mismatch_requests SET resolved_at = ?1, resolved_by = ?2 WHERE id = ?3 AND resolved_at IS NULL",
            rusqlite::params![t, admin, id],
        )
        .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;
    if n == 0 {
        return Err(err(StatusCode::NOT_FOUND, "no existe esa solicitud, o ya estaba descartada"));
    }
    Ok(StatusCode::NO_CONTENT)
}
```

- [ ] **Paso 4: montar las rutas**

En `crates/lumid/src/main.rs`, añade estas tres líneas junto a las de `credit_requests` (después
de la línea `.route("/v1/admin/credit-requests/:id/resolve", post(routes::credit_requests::resolve))`,
antes de `.route("/v1/admin/events", get(routes::admin::events))`):

```rust
        .route("/v1/version-mismatch", post(routes::version_mismatch::create))
        .route("/v1/admin/version-mismatch", get(routes::version_mismatch::list_all))
        .route("/v1/admin/version-mismatch/:id/resolve", post(routes::version_mismatch::resolve))
```

- [ ] **Paso 5: verificar**

Run: `cargo build -p lumid`
Expected: compila sin errores ni warnings nuevos.

- [ ] **Paso 6: commit**

```bash
git add crates/lumid/src/store.rs crates/lumid/src/routes/mod.rs crates/lumid/src/routes/version_mismatch.rs crates/lumid/src/main.rs
git commit -m "feat: lumid expone POST /v1/version-mismatch y su cola de admin"
```

---

### Task 4: instalador — instalar una versión exacta con `--version-objetivo=`

**Files:**
- Modify: `installer/src-tauri/src/silencioso.rs`

**Interfaces:**
- Consumes: `Manifiesto::version_exacta` (Tarea 1), `Manifiesto::mas_nueva` (ya existente).
- Produces: el flag `--version-objetivo=<x.y.z>` — lo usan la Tarea 5 (comando
  `disparar_actualizacion_a_version` del cliente) y cualquier invocación manual futura.

- [ ] **Paso 1: `Args` admite `version_actual` opcional y `version_objetivo`**

En `installer/src-tauri/src/silencioso.rs`, sustituye el struct y el parseo (líneas 19-43) por:

```rust
struct Args {
    producto: String,
    pid: u32,
    /// Al menos uno de los dos tiene que estar presente: `version_actual`
    /// resuelve "la más nueva que la mía" (autoactualización normal),
    /// `version_objetivo` resuelve "exactamente esta" (downgrade, o igualar
    /// la versión de un servidor que no es la última publicada) — ver
    /// docs/superpowers/specs/2026-08-26-compatibilidad-de-version-design.md.
    version_actual: Option<String>,
    version_objetivo: Option<String>,
}

pub fn es_invocacion_silenciosa() -> bool {
    std::env::args().any(|a| a == "--silencioso")
}

fn parsear_args() -> Option<Args> {
    let mut producto = None;
    let mut pid = None;
    let mut version_actual = None;
    let mut version_objetivo = None;
    for arg in std::env::args().skip(1) {
        if let Some(v) = arg.strip_prefix("--producto=") {
            producto = Some(v.to_string());
        } else if let Some(v) = arg.strip_prefix("--pid=") {
            pid = v.parse::<u32>().ok();
        } else if let Some(v) = arg.strip_prefix("--version-actual=") {
            version_actual = Some(v.to_string());
        } else if let Some(v) = arg.strip_prefix("--version-objetivo=") {
            version_objetivo = Some(v.to_string());
        }
    }
    if version_actual.is_none() && version_objetivo.is_none() {
        return None;
    }
    Some(Args { producto: producto?, pid: pid?, version_actual, version_objetivo })
}
```

- [ ] **Paso 2: resolver por `version_exacta` cuando hay objetivo**

Dentro de `ejecutar_y_salir`, sustituye el bloque que resuelve `publicacion` (líneas 80-88):

```rust
        let manifiesto = lumi_installer::manifiesto::obtener_verificado()?;
        let Some(producto) = producto_enum(&args.producto) else {
            return Err(lumi_installer::InstaladorError::SinPublicacionNueva);
        };
        let publicacion = manifiesto
            .mas_nueva(producto, &args.version_actual, "windows-x86_64")
            .ok_or(lumi_installer::InstaladorError::SinPublicacionNueva)?
            .clone();
```

por:

```rust
        let manifiesto = lumi_installer::manifiesto::obtener_verificado()?;
        let Some(producto) = producto_enum(&args.producto) else {
            return Err(lumi_installer::InstaladorError::SinPublicacionNueva);
        };
        let encontrada = if let Some(objetivo) = &args.version_objetivo {
            manifiesto.version_exacta(producto, objetivo, "windows-x86_64")
        } else {
            manifiesto.mas_nueva(producto, args.version_actual.as_deref().unwrap_or("0.0.0"), "windows-x86_64")
        };
        let publicacion = encontrada.ok_or(lumi_installer::InstaladorError::SinPublicacionNueva)?.clone();
```

- [ ] **Paso 3: el log de error usa lo que haya disponible como "versión actual"**

Las dos llamadas a `bitacora::dejar_marca_error` que usan `&args.version_actual` (líneas 71 y
121 del archivo original) esperan un `&str`, y `version_actual` ahora es `Option<String>`.
Sustitúyelas:

```rust
    if !esperar_cierre(args.pid, Duration::from_secs(10)) {
        bitacora::dejar_marca_error(&args.producto, "desconocida", "el proceso anterior no cerro a tiempo");
        std::process::exit(1);
    }
```
(sin cambios, ya usa el literal `"desconocida"`, no `args.version_actual`)

y al final:

```rust
        Err(e) => {
            let version_para_log = args.version_objetivo.as_deref().or(args.version_actual.as_deref()).unwrap_or("desconocida");
            bitacora::dejar_marca_error(&args.producto, version_para_log, &e.to_string());
            std::process::exit(1);
        }
```

- [ ] **Paso 4: verificar**

Run: `cargo build -p installer` (o, si el nombre del paquete difiere, `cargo build --manifest-path installer/src-tauri/Cargo.toml`)
Expected: compila sin errores.

- [ ] **Paso 5: commit**

```bash
git add installer/src-tauri/src/silencioso.rs
git commit -m "feat: installer --silencioso admite --version-objetivo para instalar una version exacta"
```

---

### Task 5: cliente Rust — bloquear en `connect()` y comando para igualar la versión del servidor

**Files:**
- Modify: `client/src-tauri/src/main.rs`

**Interfaces:**
- Consumes: `lumi_proto::actualizacion::comparar` (Tarea 1), `lumi_proto::api::Hello` (ya
  existente).
- Produces: el error `"version incompatible|<propia>|<servidor>"` devuelto por
  `pair`/`reconnect`/`pair_card` — lo consume la Tarea 7 (UI). El comando
  `disparar_actualizacion_a_version` — lo consume la Tarea 6 (TS).

- [ ] **Paso 1: `connect()` compara versiones antes de dar por completado el pairing**

Sustituye la función `connect` completa (líneas 279-294) por:

```rust
async fn connect(addr: &str, fingerprint: &str, state: &Shared) -> Result<serde_json::Value, String> {
    let client = client_for(fingerprint)?;
    let base = format!("https://{addr}");
    let hello: lumi_proto::api::Hello = client
        .get(format!("{base}/v1/hello"))
        .send()
        .await
        .map_err(|e| format!("no se pudo conectar: {e}"))?
        .json()
        .await
        .map_err(|e| e.to_string())?;

    // El cliente HTTP se guarda ANTES de comprobar la versión, no después:
    // si hay desajuste, la pantalla de bloqueo todavía necesita poder hacer
    // `POST /v1/version-mismatch` a través de este mismo `state` (comando
    // `request`, que exige `state.base`/`state.client` ya puestos). El
    // pairing no se da por completado (no se guarda `hello` en el store de
    // TS), pero el transporte HTTP sí queda listo.
    {
        let mut c = state.lock().unwrap();
        c.base = Some(base);
        c.client = Some(client);
    }

    let propia = env!("CARGO_PKG_VERSION");
    if lumi_proto::actualizacion::comparar(&hello.version, propia) != std::cmp::Ordering::Equal {
        return Err(format!("version incompatible|{propia}|{}", hello.version));
    }

    serde_json::to_value(&hello).map_err(|e| e.to_string())
}
```

- [ ] **Paso 2: comando para relanzar el instalador apuntando a una versión exacta**

Añade, justo después de `disparar_actualizacion_silenciosa` (que termina en la línea 260):

```rust
/// Mismo camino que `disparar_actualizacion_silenciosa`, pero para igualar
/// una versión concreta (downgrade, o la versión de un servidor que no es
/// la última publicada) en vez de "la más nueva". Ver
/// docs/superpowers/specs/2026-08-26-compatibilidad-de-version-design.md.
#[tauri::command]
fn disparar_actualizacion_a_version(app: tauri::AppHandle, version_objetivo: String) -> Result<(), String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let carpeta = exe.parent().ok_or("sin carpeta padre")?;
    let instalador = carpeta.join("installer.exe");
    let pid = std::process::id();

    std::process::Command::new(instalador)
        .arg("--producto=cliente")
        .arg(format!("--pid={pid}"))
        .arg(format!("--version-objetivo={version_objetivo}"))
        .arg("--silencioso")
        .spawn()
        .map_err(|e| e.to_string())?;

    app.exit(0);
    Ok(())
}
```

- [ ] **Paso 3: registrar el comando nuevo**

En la lista de `tauri::generate_handler![...]` (línea 674-679), añade `disparar_actualizacion_a_version`
al final:

```rust
        .invoke_handler(tauri::generate_handler![
            pair, pair_card, reconnect, request, start_telemetry, start_task_log,
            start_queue_events, start_indices_events, start_admin_events, start_logs_stream, set_auth,
            upload_images, read_image_as_data_url, upload_avatar_bytes, upload_server_avatar_bytes,
            upload_server_banner_bytes, comprobar_actualizacion, error_actualizacion_pendiente,
            disparar_actualizacion_silenciosa, disparar_actualizacion_a_version
        ])
```

- [ ] **Paso 4: verificar**

Run: `cargo build -p app` (nombre del paquete en `client/src-tauri/Cargo.toml`; si falla por el
nombre, usar `cargo build --manifest-path client/src-tauri/Cargo.toml`)
Expected: compila sin errores.

- [ ] **Paso 5: commit**

```bash
git add client/src-tauri/src/main.rs
git commit -m "feat: cliente bloquea el pairing si la version de lumid no coincide"
```

---

### Task 6: cliente TS — tipos, helper de parseo y disparador de actualización a versión exacta

**Files:**
- Modify: `client/src/lib/api.ts`
- Modify: `client/src/lib/actualizaciones.ts`

**Interfaces:**
- Consumes: nada de otras tareas de código (son tipos/funciones puros del lado TS).
- Produces: `parseVersionMismatch`, `versionMayor` (en `lib/api.ts`), `VersionMismatchInfo`
  (tipo), `dispararActualizacionAVersion` (en `lib/actualizaciones.ts`) — los consume la Tarea 7
  (componente de aviso) y la Tarea 8 (panel de admin).

- [ ] **Paso 1: tipo `VersionMismatchInfo` y variante de `EventoAdmin`**

En `client/src/lib/api.ts`, después de `CreditRequestInfo`/`CreateCreditReq`/`ResolveCreditReq`
(antes de `export type EventoAdmin = ...`, línea 120), añade:

```typescript
export interface VersionMismatchInfo {
  id: number; version_cliente: string; source_ip: string;
  created_at: number; resolved_at: number | null;
}
```

Y añade la variante a la unión `EventoAdmin` (líneas 120-126):

```typescript
export type EventoAdmin =
  | { SolicitudCredito: {
      user_id: number; username: string; tipo: "diario" | "semanal";
      valor_actual: number; valor_propuesto: number;
    } }
  | { SolicitudAcceso: { id: number; display_name: string; message: string } }
  | { SolicitudVersion: { version_cliente: string } }
  | "ColaCambio";
```

- [ ] **Paso 2: `parseVersionMismatch` y `versionMayor`**

En el mismo archivo, cerca de la definición de `Hello` (después de la línea 224, antes del
comentario de `lumi1_...` en la línea 226), añade:

```typescript
/** `partes`/`comparar` de `lumi-proto::actualizacion`, mismo criterio en TS:
 *  tuplas de tres enteros, sin sufijo de pre-release. */
function partesVersion(v: string): [number, number, number] {
  const [a, b, c] = v.trim().split(".");
  return [Number(a) || 0, Number(b) || 0, Number(c) || 0];
}

/** `true` si `a` es estrictamente más nueva que `b`. */
export function versionMayor(a: string, b: string): boolean {
  const pa = partesVersion(a), pb = partesVersion(b);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] > pb[i];
  }
  return false;
}

/** El error que lanza `pair`/`reconnect`/`pair_card` cuando la versión del
 *  cliente y la del servidor no coinciden (ver `connect()` en
 *  `client/src-tauri/src/main.rs`) trae el formato
 *  `version incompatible|<propia>|<servidor>`. `null` si `msg` no es eso. */
export function parseVersionMismatch(msg: string): { propia: string; servidor: string } | null {
  const m = /^version incompatible\|([^|]+)\|([^|]+)$/.exec(msg.trim());
  return m ? { propia: m[1], servidor: m[2] } : null;
}
```

- [ ] **Paso 3: `dispararActualizacionAVersion`**

En `client/src/lib/actualizaciones.ts`, después de `dispararActualizacionSilenciosa` (línea 30-32),
añade:

```typescript
/** Mismo camino que `dispararActualizacionSilenciosa`, pero para igualar
 *  una versión exacta (downgrade, o la versión de un servidor que no es la
 *  última publicada) en vez de "la más nueva". No vuelve — la ventana se
 *  cierra dentro del comando de Rust. */
export function dispararActualizacionAVersion(versionObjetivo: string): Promise<void> {
  return invoke("disparar_actualizacion_a_version", { versionObjetivo });
}
```

- [ ] **Paso 4: verificar**

Run: `cd client && npx tsc -b --noEmit`
Expected: sin errores de tipos.

- [ ] **Paso 5: commit**

```bash
git add client/src/lib/api.ts client/src/lib/actualizaciones.ts
git commit -m "feat: cliente TS gana tipos y helpers para el aviso de version distinta"
```

---

### Task 7: cliente TS — pantalla de aviso en los tres puntos de entrada (login, añadir servidor, wizard)

**Files:**
- Create: `client/src/entry/VersionMismatchNotice.tsx`
- Modify: `client/src/entry/LoginForm.tsx`
- Modify: `client/src/entry/AddServerForm.tsx`
- Modify: `client/src/wizard/PairStep.tsx`

**Interfaces:**
- Consumes: `parseVersionMismatch`, `versionMayor` (Tarea 6), `dispararActualizacionAVersion`
  (Tarea 6), `POST /v1/version-mismatch` (Tarea 3, vía `api.post`).

- [ ] **Paso 1: crear el componente compartido**

Crea `client/src/entry/VersionMismatchNotice.tsx`:

```tsx
import { useState } from "react";
import { api, versionMayor } from "../lib/api";
import { dispararActualizacionAVersion } from "../lib/actualizaciones";
import { Icon } from "../ui/Icon";

/** Se muestra en el sitio del error genérico de conexión (mismo hueco en
 *  `LoginForm`, `AddServerForm` y `PairStep`) cuando `pair`/`reconnect`/
 *  `pair_card` fallan por desajuste de versión — ver `connect()` en
 *  `client/src-tauri/src/main.rs` y la spec de compatibilidad de versión.
 *  Cliente más nuevo: dos caminos (pedir al servidor que actualice, o
 *  descargar la versión del servidor). Servidor más nuevo: uno solo
 *  (actualizar el cliente). */
export function VersionMismatchNotice({ propia, servidor }: { propia: string; servidor: string }) {
  const clienteEsMasNuevo = versionMayor(propia, servidor);
  const [enviada, setEnviada] = useState(false);
  const [errorEnvio, setErrorEnvio] = useState<string | null>(null);

  async function pedirActualizacion() {
    try {
      await api.post("/v1/version-mismatch", { version_cliente: propia });
      setEnviada(true);
    } catch (e) {
      setErrorEnvio(String(e));
    }
  }

  return (
    <>
      <div className="my-3 h-px bg-border" />
      <div className="flex items-start gap-2.5 text-xs text-warning-fg">
        <Icon name="alert" className="mt-0.5" />
        <span className="text-muted">
          Este cliente ({propia}) no coincide con la versión del servidor ({servidor}).
        </span>
      </div>
      {errorEnvio && <p className="mt-2 text-[11px] text-danger-fg">{errorEnvio}</p>}
      <div className="mt-3 flex items-center justify-end gap-2">
        {clienteEsMasNuevo && (
          enviada ? (
            <span className="text-[11px] text-subtle">Solicitud enviada al servidor</span>
          ) : (
            <button onClick={pedirActualizacion}
              className="rounded-lg border border-white/15 px-3 py-1.5 text-[11px] text-fg active:translate-y-px">
              Pedir al servidor que actualice
            </button>
          )
        )}
        <button onClick={() => void dispararActualizacionAVersion(servidor)}
          className="rounded-lg bg-accent px-3 py-1.5 text-[11px] font-medium text-black active:translate-y-px">
          {clienteEsMasNuevo ? "Descargar versión del servidor" : "Actualizar cliente"}
        </button>
      </div>
    </>
  );
}
```

- [ ] **Paso 2: usarlo en `LoginForm.tsx`**

En `client/src/entry/LoginForm.tsx`, añade el import:

```typescript
import { parseVersionMismatch } from "../lib/api";
import { VersionMismatchNotice } from "./VersionMismatchNotice";
```

Y sustituye el bloque `{error && (...)}` (líneas 87-92) por:

```tsx
      {error && parseVersionMismatch(error) ? (
        <VersionMismatchNotice {...parseVersionMismatch(error)!} />
      ) : error && (
        <div className="mt-3.5 flex items-start gap-2.5 text-xs">
          <Icon name="alert" className="mt-0.5 text-danger-fg" />
          <span className="text-muted">{error}</span>
        </div>
      )}
```

- [ ] **Paso 3: usarlo en `AddServerForm.tsx`**

En `client/src/entry/AddServerForm.tsx`, añade el import:

```typescript
import { parseVersionMismatch } from "../lib/api";
import { VersionMismatchNotice } from "./VersionMismatchNotice";
```

Y sustituye el bloque `{error && (...)}` (líneas 104-112) por:

```tsx
      {error && parseVersionMismatch(error) ? (
        <>
          <div className="my-3 h-px bg-border" />
          <VersionMismatchNotice {...parseVersionMismatch(error)!} />
        </>
      ) : error && (
        <>
          <div className="my-3 h-px bg-border" />
          <div className="flex items-start gap-2.5 text-xs text-danger-fg">
            <Icon name="alert" className="mt-0.5" />
            <span className="text-muted">{error}</span>
          </div>
        </>
      )}
```

- [ ] **Paso 4: usarlo en `PairStep.tsx`**

En `client/src/wizard/PairStep.tsx`, añade el import:

```typescript
import { parseVersionMismatch } from "../lib/api";
import { VersionMismatchNotice } from "../entry/VersionMismatchNotice";
```

Y sustituye el bloque `{error && (...)}` (líneas 98-106) por:

```tsx
      {error && parseVersionMismatch(error) ? (
        <>
          <div className="my-3 h-px bg-border" />
          <VersionMismatchNotice {...parseVersionMismatch(error)!} />
        </>
      ) : error && (
        <>
          <div className="my-3 h-px bg-border" />
          <div className="flex items-start gap-2.5 text-xs text-danger-fg">
            <Icon name="alert" className="mt-0.5" />
            <span className="text-muted">{error}</span>
          </div>
        </>
      )}
```

- [ ] **Paso 5: verificar**

Run: `cd client && npm run lint && npx tsc -b --noEmit`
Expected: sin errores de lint ni de tipos.

- [ ] **Paso 6: commit**

```bash
git add client/src/entry/VersionMismatchNotice.tsx client/src/entry/LoginForm.tsx client/src/entry/AddServerForm.tsx client/src/wizard/PairStep.tsx
git commit -m "feat: pantalla de aviso de version distinta en login, anadir servidor y wizard"
```

---

### Task 8: panel de admin — tercer tipo de solicitud y toast

**Files:**
- Modify: `client/src/admin/RequestsView.tsx`
- Modify: `client/src/admin/AdminEventToast.tsx`

**Interfaces:**
- Consumes: `VersionMismatchInfo`, `EventoAdmin` con `SolicitudVersion` (Tarea 6);
  `GET/POST /v1/admin/version-mismatch...` (Tarea 3).

- [ ] **Paso 1: `RequestsView.tsx` gana el tercer tipo**

En `client/src/admin/RequestsView.tsx`:

Cambia el import (línea 2):

```typescript
import { api, type AdminRequest, type CreditRequestInfo, type VersionMismatchInfo } from "../lib/api";
```

Cambia `TipoIcono` (líneas 22-32) para aceptar el tercer tipo:

```tsx
function TipoIcono({ tipo }: { tipo: "acceso" | "credito" | "version" }) {
  if (tipo === "acceso") {
    return (
      <span className="grid h-[22px] w-[22px] shrink-0 place-items-center rounded-full bg-warning/[.12] text-warning-fg">
        <Icon name="shield" size={12} />
      </span>
    );
  }
  if (tipo === "credito") {
    return (
      <span className="grid h-[22px] w-[22px] shrink-0 place-items-center rounded-full bg-draw/[.12] text-draw-fg">
        <Icon name="lock" size={12} />
      </span>
    );
  }
  return (
    <span className="grid h-[22px] w-[22px] shrink-0 place-items-center rounded-full bg-muted/[.12] text-muted">
      <Icon name="refresh" size={12} />
    </span>
  );
}
```

Cambia el tipo `Fila` (líneas 34-36):

```typescript
type Fila =
  | { tipo: "acceso"; r: AdminRequest }
  | { tipo: "credito"; r: CreditRequestInfo }
  | { tipo: "version"; r: VersionMismatchInfo };
```

Añade el estado y la carga (dentro de `RequestsView`, junto a `acceso`/`credito`, líneas 39-49):

```typescript
  const [version, setVersion] = useState<VersionMismatchInfo[]>([]);
```
```typescript
  const load = () => {
    api.get<AdminRequest[]>("/v1/admin/access-requests", token).then(setAcceso).catch((e) => setError(String(e)));
    api.get<CreditRequestInfo[]>("/v1/admin/credit-requests", token).then(setCredito).catch((e) => setError(String(e)));
    api.get<VersionMismatchInfo[]>("/v1/admin/version-mismatch", token).then(setVersion).catch((e) => setError(String(e)));
  };
```

Añade la acción de descarte (junto a `resolveAcceso`/`resolveCredito`, líneas 53-66):

```typescript
  async function descartarVersion(id: number) {
    try {
      await api.post(`/v1/admin/version-mismatch/${id}/resolve`, {}, token);
      load();
    } catch (e) { setError(String(e)); load(); }
  }
```

Nota importante para `VersionMismatchInfo`: no trae `status`, trae `resolved_at: number | null`
— el resto del componente lee `f.r.status` para decidir "pendiente"/opacidad (líneas 79, 99,
137, 178). Como las filas son una unión discriminada, añade una función auxiliar junto a `key`
(línea 80) que normalice esto para las tres:

```typescript
  const pendiente = (f: Fila) => f.tipo === "version" ? f.r.resolved_at === null : f.r.status === "pending";
```

Y sustituye los cuatro usos de `f.r.status !== "pending"` / `f.r.status === "pending"` /
`filas.filter((f) => f.r.status === "pending").length` por `!pendiente(f)` / `pendiente(f)` /
`filas.filter(pendiente).length` respectivamente. Actualiza también `filas` (línea 74-77) para
incluir el tercer tipo:

```typescript
  const filas: Fila[] = [
    ...acceso.map((r): Fila => ({ tipo: "acceso", r })),
    ...credito.map((r): Fila => ({ tipo: "credito", r })),
    ...version.map((r): Fila => ({ tipo: "version", r })),
  ].sort((a, b) => b.r.created_at - a.r.created_at);
```

Y añade una tercera rama al `f.tipo === "acceso" ? ... : (...)` del cuerpo expandido (líneas
124-186), como un `else if` antes del `else` de crédito:

```tsx
                {f.tipo === "acceso" ? (
                  /* ...bloque existente sin cambios... */
                ) : f.tipo === "version" ? (
                  <div className="grid grid-cols-[1fr_262px] gap-5 px-3.5 pb-4 pt-0.5">
                    <div className="flex flex-col">
                      <Dato k="versión del cliente" v={f.r.version_cliente} />
                      <Dato k="dirección" v={f.r.source_ip} />
                    </div>
                    <div className="flex items-end justify-end gap-2">
                      {f.r.resolved_at === null && (
                        <button onClick={() => descartarVersion(f.r.id)}
                          className="rounded-lg border border-white/15 px-3 py-1.5 text-[11px] text-fg active:translate-y-px">
                          Descartar
                        </button>
                      )}
                    </div>
                  </div>
                ) : (
                  /* ...bloque existente de crédito sin cambios... */
                )}
```

Y en la línea 107 (`{f.tipo === "acceso" ? f.r.message.slice(0, 48) : ...}`), añade la tercera
rama:

```tsx
                    {f.tipo === "acceso" ? f.r.message.slice(0, 48)
                      : f.tipo === "version" ? `versión ${f.r.version_cliente}`
                      : `${f.r.tipo} ${f.r.valor_actual} → ${f.r.valor_propuesto}`}
```

Y en la línea 105 (`{f.tipo === "acceso" ? f.r.display_name : f.r.username}`):

```tsx
                  {f.tipo === "acceso" ? f.r.display_name : f.tipo === "version" ? f.r.source_ip : f.r.username}
```

- [ ] **Paso 2: `AdminEventToast.tsx` gana la tercera variante**

En `client/src/admin/AdminEventToast.tsx`, sustituye el cálculo de `titulo`/`detalle` (líneas
36-41):

```tsx
  const titulo = "SolicitudCredito" in ev
    ? `${ev.SolicitudCredito.username} pidió más cupo ${ev.SolicitudCredito.tipo}`
    : "SolicitudAcceso" in ev
    ? `${ev.SolicitudAcceso.display_name} pide una cuenta`
    : `Cliente en versión ${ev.SolicitudVersion.version_cliente} no pudo conectar`;
  const detalle = "SolicitudCredito" in ev
    ? `${ev.SolicitudCredito.valor_actual} → ${ev.SolicitudCredito.valor_propuesto}`
    : "SolicitudAcceso" in ev
    ? ev.SolicitudAcceso.message.slice(0, 48)
    : "actualiza el servidor para que pueda entrar";
```

- [ ] **Paso 3: verificar**

Run: `cd client && npm run lint && npx tsc -b --noEmit`
Expected: sin errores de lint ni de tipos.

- [ ] **Paso 4: commit**

```bash
git add client/src/admin/RequestsView.tsx client/src/admin/AdminEventToast.tsx
git commit -m "feat: panel de admin muestra los avisos de version distinta"
```

---

### Task 9: verificación final de extremo a extremo

**Files:** ninguno (solo verificación).

- [ ] **Paso 1: workspace Rust completo**

Run: `cargo build`
Expected: compila sin errores el workspace entero (`lumi-proto`, `lumi-index`, `lumid`,
`lumi-cli`, `lumi-installer`).

- [ ] **Paso 2: los dos binarios excluidos del workspace**

Run: `cargo build --manifest-path client/src-tauri/Cargo.toml`
Run: `cargo build --manifest-path installer/src-tauri/Cargo.toml`
Expected: ambos compilan sin errores.

- [ ] **Paso 3: tests de `lumi-proto`**

Run: `cargo test -p lumi-proto`
Expected: todos pasan, incluidos `version_exacta_encuentra_solo_la_igual` y
`version_exacta_ignora_retirada`.

- [ ] **Paso 4: frontend del cliente**

Run: `cd client && npm run build`
Expected: compila sin errores (`tsc -b && vite build`).

- [ ] **Paso 5: commit final si algo quedó sin comitear**

```bash
git status --short
```

Si hay cambios sin commitear (por ejemplo un `Cargo.lock` actualizado por los `cargo build` de
arriba), añádelos y comitéalos:

```bash
git add -A
git commit -m "chore: actualizar Cargo.lock tras compatibilidad de version"
```
