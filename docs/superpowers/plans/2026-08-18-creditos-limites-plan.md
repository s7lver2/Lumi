# Créditos, límite semanal y solicitud de más cupo — plan de implementación

> **Para quien ejecute esto:** un solo agente para todo el plan, de principio
> a fin, en este mismo repo (no worktree, no subagente por tarea). Sin tests
> nuevos: `PROJECT-CONVENTIONS.md` dice explícitamente que este proyecto no
> los lleva salvo que se pidan, y no se han pedido aquí. Cada tarea termina
> compilando/tipando limpio; el commit es UNO SOLO al final de todo (no uno
> por tarea — así lo pide este repo: "un commit por feature terminada").

**Objetivo:** tope semanal opcional junto al diario ya existente, solicitud
de más cupo (diario o semanal) integrada en la sección Solicitudes ya
existente, y aviso en tiempo real al administrador vía SSE + toast.

**Arquitectura:** todo reutiliza mecánica ya existente en el repo — el
sistema de dos niveles de `limits.rs`, la tabla/patrón de `access_requests`,
el SSE de `/v1/queue/events`, y los toasts `ModelToasts`/`IndexToast`. No se
introduce ningún concepto nuevo de infraestructura.

**Stack:** Rust (axum, rusqlite, tokio broadcast) en `crates/lumid` y
`crates/lumi-proto`; React+TS+Tailwind en `client/`, puente Tauri en
`client/src-tauri`.

## Global

- Spec de referencia: `docs/superpowers/specs/2026-08-18-creditos-limites-design.md`.
- Ningún nuevo icono: `lock` y `shield` ya existen en `client/src/ui/Icon.tsx`.
- Ninguna tabla nueva de progreso persistido: el aviso SSE se pierde si nadie
  escucha, igual que el resto de la cola — se recupera viendo Solicitudes.

---

### Tarea 1 — `Limits` gana el tope semanal (lumi-proto + limits.rs)

**Archivos:**
- Modificar: `crates/lumi-proto/src/api.rs:259` (struct `Limits`) y `:274` (`impl Default`)
- Modificar: `crates/lumid/src/limits.rs:14` (`KEYS`) y `:43` (`apply`)

**Interfaces:**
- Produce: `Limits.weekly_enabled: bool`, `Limits.max_weekly: i64` — los
  consume la Tarea 4 (comprobación en `analyses::create`) y la Tarea 9
  (frontend, `LEVERS`).

- [ ] **Paso 1: añadir los dos campos a `Limits`**

En `crates/lumi-proto/src/api.rs`, dentro de `pub struct Limits { ... }`
(línea 259), añade tras `pub background_jobs: bool,`:

```rust
    /// Igual que `max_daily` pero sobre los últimos 7 días, y apagable: el
    /// administrador puede no querer un segundo tope en absoluto, no solo
    /// uno muy alto.
    pub weekly_enabled: bool,
    pub max_weekly: i64,
```

Y en `impl Default for Limits`, tras `background_jobs: false,`:

```rust
            weekly_enabled: false,
            max_weekly: 300,
```

- [ ] **Paso 2: las dos claves nuevas en `limits::KEYS` y `apply()`**

En `crates/lumid/src/limits.rs`, `KEYS` pasa de `[&str; 7]` a `[&str; 9]`
(línea 14), añadiendo dos entradas:

```rust
pub const KEYS: [&str; 9] = [
    "models",
    "max_concurrent",
    "max_daily",
    "max_storage_gb",
    "queue_priority",
    "can_create_projects",
    "background_jobs",
    "weekly_enabled",
    "max_weekly",
];
```

Y en `fn apply(l: &mut Limits, k: &str, v: &Value)` (línea 43), añade dos
brazos antes del `_ => {}` final:

```rust
        "weekly_enabled" => l.weekly_enabled = v.as_bool().unwrap_or(l.weekly_enabled),
        "max_weekly" => l.max_weekly = v.as_i64().unwrap_or(l.max_weekly),
```

- [ ] **Paso 3: compilar y correr el test existente de límites**

```bash
cargo test -p lumid limits:: 2>&1 | tail -20
```

Esperado: `la_anulacion_gana_al_global_y_el_resto_se_hereda ... ok` (el test
existente no toca las claves nuevas, así que debe seguir pasando tal cual).

---

### Tarea 2 — tabla `credit_requests` y tope semanal en `analyses::create`

**Archivos:**
- Modificar: `crates/lumid/src/store.rs` (constante `SCHEMA`, tras el bloque `access_requests`)
- Modificar: `crates/lumid/src/routes/analyses.rs:173-196` (bloque `if !is_admin`)

**Interfaces:**
- Produce: tabla `credit_requests` — la consume la Tarea 3 (rutas).
- Consume: `crate::limits::effective` (ya existe).

- [ ] **Paso 1: la tabla, en `SCHEMA`**

En `crates/lumid/src/store.rs`, justo después del bloque `CREATE TABLE IF
NOT EXISTS access_requests (...)` (líneas 39-52), añade:

```sql
CREATE TABLE IF NOT EXISTS credit_requests (
    id              INTEGER PRIMARY KEY,
    user_id         INTEGER NOT NULL REFERENCES users(id),
    tipo            TEXT NOT NULL,
    valor_actual    INTEGER NOT NULL,
    valor_propuesto INTEGER NOT NULL,
    mensaje         TEXT,
    status          TEXT NOT NULL,
    reason          TEXT,
    created_at      INTEGER NOT NULL,
    resolved_at     INTEGER,
    resolved_by     INTEGER
);
```

- [ ] **Paso 2: el tope semanal, junto al diario**

En `crates/lumid/src/routes/analyses.rs`, dentro de `pub async fn create`,
el bloque `if !is_admin { ... }` (líneas 173-196) comprueba hoy solo
`max_daily`. Añade la comprobación semanal justo después (antes de la llave
de cierre del `if !is_admin`):

```rust
        if l.weekly_enabled {
            let semana: i64 = app
                .store
                .conn()
                .query_row(
                    "SELECT COUNT(*) FROM analyses WHERE requested_by = ?1 AND created_at > ?2",
                    rusqlite::params![uid, now() - 7 * 86400],
                    |r| r.get(0),
                )
                .unwrap_or(0);
            if semana >= l.max_weekly {
                return Err(err(
                    StatusCode::TOO_MANY_REQUESTS,
                    &format!("has llegado a tu tope de {} análisis semanales", l.max_weekly),
                ));
            }
        }
```

El mensaje `"has llegado a tu tope de {} análisis semanales"` es a
propósito casi idéntico al del diario (`"has llegado a tu tope de {}
análisis diarios"`, ya existente unas líneas antes) — el frontend (Tarea
10) distingue el tipo mirando si el texto contiene "diarios" o "semanales".
No cambies esa redacción sin actualizar también `CaseView.tsx`.

- [ ] **Paso 3: compilar**

```bash
cargo build -p lumid 2>&1 | tail -20
```

Esperado: compila sin error (puede haber warnings preexistentes ajenos,
como el de `PuntoCurva` en `hardware.rs` — ignóralos, no son de este plan).

---

### Tarea 3 — tipos y rutas de `credit_requests`

**Archivos:**
- Modificar: `crates/lumi-proto/src/api.rs` (tras `AcceptLicensesReq`, línea 323)
- Crear: `crates/lumid/src/routes/credit_requests.rs`
- Modificar: `crates/lumid/src/routes/mod.rs` (declarar el módulo)
- Modificar: `crates/lumid/src/main.rs` (registrar rutas + campo `admin_eventos` en `App`)

**Interfaces:**
- Consume: `crate::limits::{effective, set}`, `crate::routes::auth::{bearer, require_session, require_admin}`, `crate::routes::access::now`, `crate::routes::projects::{err, Fail}` (mismo patrón que el resto de `routes/`).
- Produce: `CreditRequestInfo`, `CreateCreditReq`, `ResolveCreditReq`, `EventoAdmin` (tipos en `lumi_proto::api`) — los consume la Tarea 6 (bridge Tauri) y la Tarea 7 (frontend).

- [ ] **Paso 1: los tipos, en `lumi-proto`**

En `crates/lumi-proto/src/api.rs`, justo después de `AcceptLicensesReq`
(línea 323), añade:

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreditRequestInfo {
    pub id: i64,
    pub user_id: i64,
    pub username: String,
    pub tipo: String,
    pub valor_actual: i64,
    pub valor_propuesto: i64,
    pub mensaje: Option<String>,
    pub status: String,
    pub reason: Option<String>,
    pub created_at: i64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CreateCreditReq {
    pub tipo: String,
    pub valor_propuesto: i64,
    pub mensaje: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ResolveCreditReq {
    pub approve: bool,
    /// El admin puede aprobar con un valor distinto al propuesto. `None`
    /// con `approve: true` usa el propuesto tal cual.
    pub valor_final: Option<i64>,
    pub reason: Option<String>,
}

/// Lo que llega por `/v1/admin/events`. Un solo tipo hoy: nace pensado para
/// crecer, igual que `Cambio` en la cola.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum EventoAdmin {
    SolicitudCredito {
        user_id: i64,
        username: String,
        tipo: String,
        valor_actual: i64,
        valor_propuesto: i64,
    },
}
```

- [ ] **Paso 2: el fichero de rutas**

Crea `crates/lumid/src/routes/credit_requests.rs`:

```rust
//! Solicitudes de más cupo (diario o semanal). Mismo patrón que
//! `access_requests`: una tabla, un estado, "la primera resolución gana".
//! Vive en su propio fichero porque el estado que gestiona (una tabla y su
//! ciclo de vida) es distinto del de `admin.rs`, que es superficie de
//! administración variada.

use crate::routes::access::now;
use crate::routes::auth::{bearer, require_admin, require_session};
use crate::routes::projects::{err, Fail};
use crate::App;
use axum::extract::{Path, State};
use axum::{http::HeaderMap, http::StatusCode, Json};
use lumi_proto::api::{CreateCreditReq, CreditRequestInfo, EventoAdmin, ResolveCreditReq};

const SELECT: &str = "SELECT cr.id, cr.user_id, u.username, cr.tipo, cr.valor_actual,
    cr.valor_propuesto, cr.mensaje, cr.status, cr.reason, cr.created_at
    FROM credit_requests cr JOIN users u ON u.id = cr.user_id";

fn map_row(r: &rusqlite::Row) -> rusqlite::Result<CreditRequestInfo> {
    Ok(CreditRequestInfo {
        id: r.get(0)?,
        user_id: r.get(1)?,
        username: r.get(2)?,
        tipo: r.get(3)?,
        valor_actual: r.get(4)?,
        valor_propuesto: r.get(5)?,
        mensaje: r.get(6)?,
        status: r.get(7)?,
        reason: r.get(8)?,
        created_at: r.get(9)?,
    })
}

pub async fn create(
    State(app): State<App>,
    headers: HeaderMap,
    Json(req): Json<CreateCreditReq>,
) -> Result<Json<CreditRequestInfo>, Fail> {
    let (uid, _) =
        require_session(&app, &bearer(&headers)).map_err(|c| (c, "sesión inválida".to_string()))?;
    if req.tipo != "diario" && req.tipo != "semanal" {
        return Err(err(StatusCode::BAD_REQUEST, "tipo desconocido"));
    }
    let c = app.store.conn();
    // Solo una pendiente a la vez por tipo, mismo criterio que
    // "la primera resolución gana" de access_requests.
    let ya: i64 = c
        .query_row(
            "SELECT COUNT(*) FROM credit_requests WHERE user_id = ?1 AND tipo = ?2 AND status = 'pending'",
            rusqlite::params![uid, req.tipo],
            |r| r.get(0),
        )
        .unwrap_or(0);
    if ya > 0 {
        return Err(err(StatusCode::CONFLICT, "ya tienes una solicitud pendiente de este tipo"));
    }
    let l = crate::limits::effective(&app.store, uid);
    let valor_actual = if req.tipo == "diario" { l.max_daily } else { l.max_weekly };
    let t = now();
    c.execute(
        "INSERT INTO credit_requests
            (user_id, tipo, valor_actual, valor_propuesto, mensaje, status, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, 'pending', ?6)",
        rusqlite::params![uid, req.tipo, valor_actual, req.valor_propuesto, req.mensaje, t],
    )
    .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;
    let id = c.last_insert_rowid();
    let info = c
        .query_row(&format!("{SELECT} WHERE cr.id = ?1"), [id], map_row)
        .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;

    let username: String = c
        .query_row("SELECT username FROM users WHERE id = ?1", [uid], |r| r.get(0))
        .unwrap_or_default();
    let _ = app.admin_eventos.send(EventoAdmin::SolicitudCredito {
        user_id: uid,
        username,
        tipo: info.tipo.clone(),
        valor_actual: info.valor_actual,
        valor_propuesto: info.valor_propuesto,
    });

    Ok(Json(info))
}

pub async fn list_all(
    State(app): State<App>,
    headers: HeaderMap,
) -> Result<Json<Vec<CreditRequestInfo>>, StatusCode> {
    require_admin(&app, &bearer(&headers))?;
    let c = app.store.conn();
    let mut q = c
        .prepare(&format!("{SELECT} ORDER BY cr.created_at DESC"))
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let rows = q.query_map([], map_row).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(rows.flatten().collect()))
}

pub async fn resolve(
    State(app): State<App>,
    Path(id): Path<i64>,
    headers: HeaderMap,
    Json(req): Json<ResolveCreditReq>,
) -> Result<StatusCode, Fail> {
    let admin = require_admin(&app, &bearer(&headers))
        .map_err(|c| (c, "hace falta ser administrador".to_string()))?;
    let c = app.store.conn();
    let (status, user_id, tipo, propuesto): (String, i64, String, i64) = c
        .query_row(
            "SELECT status, user_id, tipo, valor_propuesto FROM credit_requests WHERE id = ?1",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .map_err(|_| err(StatusCode::NOT_FOUND, "no existe esa solicitud"))?;
    if status != "pending" {
        return Err(err(StatusCode::CONFLICT, &format!("esa solicitud ya está {status}")));
    }
    let t = now();
    if req.approve {
        let valor = req.valor_final.unwrap_or(propuesto);
        let key = if tipo == "diario" { "max_daily" } else { "max_weekly" };
        crate::limits::set(&app.store, Some(user_id), key, &serde_json::json!(valor))
            .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;
        c.execute(
            "UPDATE credit_requests SET status = 'approved', resolved_at = ?1, resolved_by = ?2 WHERE id = ?3",
            rusqlite::params![t, admin, id],
        )
    } else {
        c.execute(
            "UPDATE credit_requests SET status = 'rejected', reason = ?1, resolved_at = ?2, resolved_by = ?3 WHERE id = ?4",
            rusqlite::params![req.reason, t, admin, id],
        )
    }
    .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;
    Ok(StatusCode::NO_CONTENT)
}
```

- [ ] **Paso 3: declarar el módulo**

En `crates/lumid/src/routes/mod.rs`, añade la línea del módulo junto a las
demás (busca `pub mod admin;` o similar y añade al lado, en orden
alfabético con el resto):

```rust
pub mod credit_requests;
```

- [ ] **Paso 4: el canal SSE en `App` y su inicialización**

En `crates/lumid/src/main.rs`, dentro de `pub struct App { ... }` (línea
32), añade tras `pub indices_en_curso: indices::EnCurso,`:

```rust
    /// Un solo tipo de evento hoy (`EventoAdmin::SolicitudCredito`). Igual
    /// que `queue::Queue.difusion`, pero sin actor propio: no hace falta
    /// nada más que un canal de difusión, así que no se crea una estructura
    /// para envolverlo.
    pub admin_eventos: tokio::sync::broadcast::Sender<lumi_proto::api::EventoAdmin>,
```

En `fn main()`, justo antes de `let app = App {` (donde se construye
`queue`), añade:

```rust
    let (admin_eventos, _) = tokio::sync::broadcast::channel(64);
```

Y dentro de la construcción de `let app = App { ... };`, añade el campo:

```rust
        admin_eventos,
```

- [ ] **Paso 5: registrar las tres rutas + la SSE**

En `crates/lumid/src/main.rs`, junto a las demás rutas `/v1/admin/...`
(cerca de la línea 123, después de
`.route("/v1/admin/access-requests/:id/resolve", ...)`, añade:

```rust
        .route("/v1/me/credit-requests", post(routes::credit_requests::create))
        .route("/v1/admin/credit-requests", get(routes::credit_requests::list_all))
        .route("/v1/admin/credit-requests/:id/resolve", post(routes::credit_requests::resolve))
        .route("/v1/admin/events", get(routes::admin::events))
```

(La ruta `/v1/admin/events` la implementa la Tarea 5, en `routes/admin.rs`;
se registra aquí porque el resto de la lista de rutas está toda junta en
`main.rs`, no dispersa por módulo.)

- [ ] **Paso 6: compilar (fallará hasta la Tarea 5 — es esperado)**

```bash
cargo build -p lumid 2>&1 | tail -30
```

Esperado: error `no function or associated item named 'events' found for
routes::admin` — es correcto, esa función se escribe en la Tarea 5. Sigue
adelante.

---

### Tarea 4 — el SSE `/v1/admin/events`

**Archivos:**
- Modificar: `crates/lumid/src/routes/admin.rs` (añadir `pub async fn events`)

**Interfaces:**
- Consume: `app.admin_eventos` (Tarea 3), `require_session` (para saber si
  es admin sin tumbar la conexión si no lo es).

- [ ] **Paso 1: el handler SSE, mismo patrón que `routes/queue.rs::events`**

Al final de `crates/lumid/src/routes/admin.rs`, añade:

```rust
/// Mismo patrón que `routes::queue::events`, pero el filtro es "la sesión es
/// admin", no "es el dueño del job" — por eso no reutiliza ese canal: son dos
/// preguntas distintas sobre el mismo tipo de conexión persistente.
pub async fn events(
    State(app): State<App>,
    headers: HeaderMap,
) -> Result<axum::response::sse::Sse<impl futures::stream::Stream<Item = Result<axum::response::sse::Event, std::convert::Infallible>>>, StatusCode> {
    require_admin(&app, &bearer(&headers))?;
    let mut rx = app.admin_eventos.subscribe();
    let stream = async_stream::stream! {
        loop {
            match rx.recv().await {
                Ok(ev) => yield Ok(axum::response::sse::Event::default().json_data(&ev).unwrap_or_default()),
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {}
                Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
            }
        }
    };
    Ok(axum::response::sse::Sse::new(stream).keep_alive(axum::response::sse::KeepAlive::default()))
}
```

Añade a los `use` de arriba del fichero (junto a los que ya hay):

```rust
use futures;
```

(`async_stream` y `futures` ya son dependencias del workspace — se usan
igual en `routes/queue.rs`; no hace falta tocar ningún `Cargo.toml`.)

- [ ] **Paso 2: compilar y correr todos los tests de `lumid`**

```bash
cargo build -p lumid 2>&1 | tail -30 && cargo test -p lumid 2>&1 | tail -30
```

Esperado: compila limpio; los tests existentes (27 antes de este plan)
siguen en verde — este plan no toca ninguno de los ficheros que tienen
`#[cfg(test)]`.

---

### Tarea 5 — puente Tauri para el SSE de admin

**Archivos:**
- Modificar: `client/src-tauri/src/main.rs` (nuevo comando `start_admin_events`, junto a `start_indices_events`)
- Modificar: `client/src/lib/bridge.ts` (nueva función `startAdminEvents`)

**Interfaces:**
- Produce: evento Tauri `"admin-events"` con el payload `EventoAdmin`
  serializado — lo consume la Tarea 8 (`CreditToast.tsx`).

- [ ] **Paso 1: el comando Tauri**

En `client/src-tauri/src/main.rs`, justo después de `start_indices_events`
(tras su llave de cierre, tal como se leyó en la exploración), añade:

```rust
/// Mismo puente que `start_indices_events`: el webview no puede autenticar
/// un `EventSource`, así que Rust hace la conexión real y TS solo escucha
/// `admin-events`.
#[tauri::command]
async fn start_admin_events(
    token: String, app: tauri::AppHandle, state: tauri::State<'_, Shared>,
) -> Result<(), String> {
    use futures_util::StreamExt;
    use tauri::Emitter;
    let (base, client) = {
        let c = state.lock().unwrap();
        (c.base.clone().ok_or("sin servidor")?, c.client.clone().ok_or("sin cliente")?)
    };
    tokio::spawn(async move {
        let Ok(res) = client.get(format!("{base}/v1/admin/events")).bearer_auth(&token).send().await else {
            return;
        };
        let mut stream = res.bytes_stream();
        let mut buf = String::new();
        while let Some(Ok(chunk)) = stream.next().await {
            buf.push_str(&String::from_utf8_lossy(&chunk));
            while let Some(i) = buf.find("\n\n") {
                let frame = buf[..i].to_string();
                buf.drain(..i + 2);
                if let Some(d) = frame.strip_prefix("data: ") {
                    if let Ok(v) = serde_json::from_str::<serde_json::Value>(d) {
                        let _ = app.emit("admin-events", v);
                    }
                }
            }
        }
    });
    Ok(())
}
```

- [ ] **Paso 2: registrarlo en `invoke_handler`**

En la lista `tauri::generate_handler![...]` (cerca de la línea 432),
añade `start_admin_events` junto a `start_indices_events`:

```rust
            pair, pair_card, reconnect, request, start_telemetry, start_task_log,
            start_queue_events, start_indices_events, start_admin_events, set_auth, upload_images
```

- [ ] **Paso 3: la función TS del puente**

En `client/src/lib/bridge.ts`, junto a `startIndicesEvents` (línea 39),
añade:

```typescript
export const startAdminEvents = (token: string) => invoke("start_admin_events", { token });
```

- [ ] **Paso 4: compilar el lado Rust del cliente**

```bash
cd "client/src-tauri" && cargo build 2>&1 | tail -30
```

Esperado: compila limpio (usa las mismas dependencias que
`start_indices_events`, ya presentes en `Cargo.toml`).

---

### Tarea 6 — tipos TS + métodos de `api.ts`

**Archivos:**
- Modificar: `client/src/lib/api.ts`

**Interfaces:**
- Produce: `CreditRequestInfo`, `CreateCreditReq`, `ResolveCreditReq`,
  `EventoAdmin` (tipos TS) — los consumen las Tareas 7, 8 y 9.

- [ ] **Paso 1: los tipos**

En `client/src/lib/api.ts`, junto a `export interface AdminRequest { ... }`
(línea 88), añade:

```typescript
export interface CreditRequestInfo {
  id: number; user_id: number; username: string;
  tipo: "diario" | "semanal";
  valor_actual: number; valor_propuesto: number;
  mensaje: string | null; status: string; reason: string | null;
  created_at: number;
}
export interface CreateCreditReq {
  tipo: "diario" | "semanal"; valor_propuesto: number; mensaje: string | null;
}
export interface ResolveCreditReq {
  approve: boolean; valor_final?: number; reason?: string;
}
export type EventoAdmin = {
  SolicitudCredito: {
    user_id: number; username: string; tipo: "diario" | "semanal";
    valor_actual: number; valor_propuesto: number;
  };
};
```

(`EventoAdmin` se serializa desde un `enum` de Rust con una sola variante
por serde por defecto como `{ "SolicitudCredito": { ... } }` — de ahí la
forma del tipo TS.)

- [ ] **Paso 2: `Limits` gana los dos campos nuevos**

En la misma `client/src/lib/api.ts`, en `export interface Limits { ... }`
(línea 77), añade tras `background_jobs: boolean;`:

```typescript
  weekly_enabled: boolean;
  max_weekly: number;
```

- [ ] **Paso 3: comprobar tipos**

```bash
cd client && npx tsc -b 2>&1 | tail -30
```

Esperado: sin nuevos errores (los tipos añadidos aún no se usan en ningún
componente, así que no puede haber desajuste todavía).

---

### Tarea 7 — `RequestsView` mezcla acceso y crédito

**Archivos:**
- Modificar: `client/src/admin/RequestsView.tsx` (reescritura completa del cuerpo, misma cabecera de fichero)
- Modificar: `client/src/admin/AdminPanel.tsx:58` (título de la sección)

**Interfaces:**
- Consume: `api.get<CreditRequestInfo[]>("/v1/admin/credit-requests", token)`,
  `api.post("/v1/admin/credit-requests/{id}/resolve", ...)` (Tarea 3),
  `Icon` con `name="lock"`/`name="shield"` (ya existen).

- [ ] **Paso 1: reescribir `RequestsView.tsx`**

Sustituye el contenido completo de `client/src/admin/RequestsView.tsx` por:

```tsx
import { useEffect, useState } from "react";
import { api, type AdminRequest, type CreditRequestInfo } from "../lib/api";
import { KNOWN_MODELS as MODELS } from "../lib/models";
import { Icon } from "../ui/Icon";

function cuando(ts: number): string {
  return new Date(ts * 1000).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function Dato({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-border py-[5px] text-[10px] last:border-none">
      <span className="tracking-[.03em] text-subtle">{k}</span>
      <b className="text-right font-mono font-normal text-muted">{v}</b>
    </div>
  );
}

/** Icono circular por tipo, mismo tratamiento que ya usa
 *  `NotificationsPopover` para distinguir acceso/aviso — nunca una columna
 *  nueva en el grid, que ya está ajustado a mano para 4. */
function TipoIcono({ tipo }: { tipo: "acceso" | "credito" }) {
  return tipo === "acceso" ? (
    <span className="grid h-[22px] w-[22px] shrink-0 place-items-center rounded-full bg-warning/[.12] text-warning-fg">
      <Icon name="shield" size={12} />
    </span>
  ) : (
    <span className="grid h-[22px] w-[22px] shrink-0 place-items-center rounded-full bg-draw/[.12] text-draw-fg">
      <Icon name="lock" size={12} />
    </span>
  );
}

type Fila =
  | { tipo: "acceso"; r: AdminRequest }
  | { tipo: "credito"; r: CreditRequestInfo };

export function RequestsView({ token }: { token: string }) {
  const [acceso, setAcceso] = useState<AdminRequest[]>([]);
  const [credito, setCredito] = useState<CreditRequestInfo[]>([]);
  const [granted, setGranted] = useState<Record<number, string[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [abierta, setAbierta] = useState<string | null>(null);

  const load = () => {
    api.get<AdminRequest[]>("/v1/admin/access-requests", token).then(setAcceso).catch((e) => setError(String(e)));
    api.get<CreditRequestInfo[]>("/v1/admin/credit-requests", token).then(setCredito).catch((e) => setError(String(e)));
  };

  useEffect(() => { load(); }, []);

  async function resolveAcceso(id: number, approve: boolean) {
    try {
      await api.post(`/v1/admin/access-requests/${id}/resolve`,
        { approve, granted_models: approve ? granted[id] ?? ["mini"] : undefined }, token);
      load();
    } catch (e) { setError(String(e)); load(); }
  }

  async function resolveCredito(id: number, approve: boolean) {
    try {
      await api.post(`/v1/admin/credit-requests/${id}/resolve`, { approve }, token);
      load();
    } catch (e) { setError(String(e)); load(); }
  }

  const toggle = (id: number, m: string) =>
    setGranted((g) => {
      const cur = g[id] ?? ["mini"];
      return { ...g, [id]: cur.includes(m) ? cur.filter((x) => x !== m) : [...cur, m] };
    });

  const filas: Fila[] = [
    ...acceso.map((r): Fila => ({ tipo: "acceso", r })),
    ...credito.map((r): Fila => ({ tipo: "credito", r })),
  ].sort((a, b) => b.r.created_at - a.r.created_at);

  const pendientes = filas.filter((f) => f.r.status === "pending").length;
  const key = (f: Fila) => `${f.tipo}:${f.r.id}`;

  return (
    <>
      <p className="mb-4 text-xs text-muted">
        {pendientes} pendientes · provisional, el panel llega en el subsistema 3.
      </p>
      {error && <p className="mb-3 text-xs text-danger-fg">{error}</p>}

      {filas.length === 0 && (
        <div className="flex items-center gap-2.5 text-xs text-muted">
          <Icon name="user" /> No hay solicitudes.
        </div>
      )}

      {filas.map((f) => {
        const k = key(f);
        const abiertaAqui = abierta === k;
        return (
          <div key={k} className={`border-t border-border first:border-t-0 ${f.r.status !== "pending" ? "opacity-45" : ""}`}>
            <button onClick={() => setAbierta(abiertaAqui ? null : k)}
              className="grid w-full grid-cols-[1fr_122px_92px_22px] items-center gap-3 px-3.5 py-3 text-left transition-[background-color,padding-left] duration-[400ms] ease-expo hover:bg-white/[.03] hover:pl-[17px]">
              <span className="flex min-w-0 items-center gap-2 text-[11.5px] text-fg">
                <TipoIcono tipo={f.tipo} />
                <span className="flex min-w-0 items-baseline gap-2">
                  {f.tipo === "acceso" ? f.r.display_name : f.r.username}
                  <small className="truncate text-[9.5px] text-subtle">
                    {f.tipo === "acceso" ? f.r.message.slice(0, 48) : `${f.r.tipo} ${f.r.valor_actual} → ${f.r.valor_propuesto}`}
                  </small>
                </span>
              </span>
              <span className="font-mono text-[10.5px] text-muted">{cuando(f.r.created_at)}</span>
              <span className="text-right">
                <span className="rounded-[5px] border border-warning/40 px-1.5 py-px text-[8.5px] tracking-[.05em] text-warning-fg">
                  esperando
                </span>
              </span>
              <span className={`flex justify-end text-subtle transition-transform duration-500 ease-expo ${abiertaAqui ? "rotate-180 text-fg" : ""}`}>
                <Icon name="chevron" size={13} />
              </span>
            </button>

            <div className={`grid transition-[grid-template-rows] duration-[550ms] ease-expo ${abiertaAqui ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}>
              <div className="overflow-hidden">
                {f.tipo === "acceso" ? (
                  <div className="grid grid-cols-[1fr_262px] gap-5 px-3.5 pb-4 pt-0.5">
                    <div>
                      <span className="mb-1.5 block text-[8.5px] uppercase tracking-[.15em] text-subtle">Lo que escribió</span>
                      <p className="border-l-2 border-border py-0.5 pl-3 text-[11.5px] italic leading-[1.75] text-muted">{f.r.message}</p>
                    </div>
                    <div className="flex flex-col">
                      <Dato k="dispositivo" v={f.r.device ?? "no consta"} />
                      <Dato k="dirección" v={`${f.r.source_ip} · ${f.r.external ? "fuera de la red local" : "red local"}`} />
                      <Dato k="solicitado" v={new Date(f.r.created_at * 1000).toISOString().slice(0, 16).replace("T", " ")} />
                    </div>
                    <div className="col-span-2 flex items-center gap-2.5 pt-1">
                      <span className="mr-auto text-[10px] text-subtle">Al aprobar entra con los límites globales; se ajustan luego en Usuarios.</span>
                      {f.r.status === "pending" && (
                        <div className="flex items-center gap-2">
                          <button onClick={() => resolveAcceso(f.r.id, true)} className="rounded-lg bg-accent px-3 py-1.5 text-[11px] font-medium text-black active:translate-y-px">Aprobar</button>
                          <button onClick={() => resolveAcceso(f.r.id, false)} className="rounded-lg border border-white/15 px-3 py-1.5 text-[11px] text-fg active:translate-y-px">Rechazar</button>
                          <span className="ml-auto flex items-center gap-1.5 text-[11px] text-subtle">
                            conceder:
                            {MODELS.map((m) => {
                              const on = (granted[f.r.id] ?? ["mini"]).includes(m);
                              return (
                                <button key={m} onClick={() => toggle(f.r.id, m)}
                                  className={`rounded border px-1.5 py-0.5 text-[10.5px] transition-colors duration-300 ease-expo ${on ? "border-accent text-fg" : "border-border text-subtle"}`}>
                                  {m}
                                </button>
                              );
                            })}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-[1fr_262px] gap-5 px-3.5 pb-4 pt-0.5">
                    <div className="flex flex-col">
                      <Dato k="valor actual" v={`${f.r.valor_actual} / ${f.r.tipo === "diario" ? "día" : "semana"}`} />
                      <Dato k="valor propuesto" v={`${f.r.valor_propuesto} / ${f.r.tipo === "diario" ? "día" : "semana"}`} />
                      {f.r.mensaje && <Dato k="motivo" v={f.r.mensaje} />}
                    </div>
                    <div className="flex items-end justify-end gap-2">
                      {f.r.status === "pending" && (
                        <>
                          <button onClick={() => resolveCredito(f.r.id, false)} className="rounded-lg border border-white/15 px-3 py-1.5 text-[11px] text-fg active:translate-y-px">Rechazar</button>
                          <button onClick={() => resolveCredito(f.r.id, true)} className="rounded-lg bg-accent px-3 py-1.5 text-[11px] font-medium text-black active:translate-y-px">Aprobar</button>
                        </>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </>
  );
}
```

- [ ] **Paso 2: el título de la sección ya no es solo "de acceso"**

En `client/src/admin/AdminPanel.tsx:58`, cambia:

```tsx
: seccion === "solicitudes" ? <Seccion titulo="Solicitudes de acceso" grupo="Personas">
```

por:

```tsx
: seccion === "solicitudes" ? <Seccion titulo="Solicitudes" grupo="Personas">
```

- [ ] **Paso 3: comprobar tipos**

```bash
cd client && npx tsc -b 2>&1 | tail -30
```

Esperado: sin errores.

---

### Tarea 8 — `CreditToast`

**Archivos:**
- Crear: `client/src/admin/CreditToast.tsx`
- Modificar: `client/src/admin/AdminPanel.tsx` (montarlo junto a `ModelToasts`/`IndexToast`)

**Interfaces:**
- Consume: `startAdminEvents` (Tarea 5), evento Tauri `"admin-events"` con
  payload `EventoAdmin` (Tarea 6).

- [ ] **Paso 1: el componente**

Crea `client/src/admin/CreditToast.tsx`:

```tsx
import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { type EventoAdmin } from "../lib/api";
import { startAdminEvents } from "../lib/bridge";
import type { Seccion } from "./Sidebar";

/** Mismo patrón que IndexToast: se monta una vez en AdminPanel para que
 *  navegar de sección no lo oculte. Un evento reemplaza al anterior — no
 *  hay cola de toasts, igual que IndexToast tampoco la tiene. */
export function CreditToast({ token, onIr }: { token: string; onIr: (s: Seccion) => void }) {
  const [ev, setEv] = useState<EventoAdmin["SolicitudCredito"] | null>(null);
  const [cerrado, setCerrado] = useState(false);

  useEffect(() => {
    let vivo = true;
    void startAdminEvents(token);
    const un = listen<EventoAdmin>("admin-events", (e) => {
      if (!vivo) return;
      setCerrado(false);
      setEv(e.payload.SolicitudCredito);
    });
    return () => { vivo = false; void un.then((f) => f()); };
  }, [token]);

  if (!ev || cerrado) return null;

  return (
    <div className="jg-press pointer-events-auto flex items-start gap-2.5 rounded-[11px] border border-white/[.14]
        bg-[rgba(20,22,26,.97)] p-[11px_12px] text-left shadow-lg shadow-black/40 backdrop-blur-xl"
      style={{ animation: "jg-fade-rise .5s cubic-bezier(.16,1,.3,1) both" }}>
      <button onClick={() => onIr("solicitudes")} className="min-w-0 flex-1 text-left">
        <div className="text-[11.5px] text-fg">{ev.username} pidió más cupo {ev.tipo}</div>
        <div className="mt-0.5 truncate font-mono text-[9.5px] text-subtle">
          {ev.valor_actual} → {ev.valor_propuesto}
        </div>
      </button>
      <button onClick={() => setCerrado(true)} className="shrink-0 text-[11px] text-subtle hover:text-fg">✕</button>
    </div>
  );
}
```

- [ ] **Paso 2: montarlo en `AdminPanel.tsx`**

En `client/src/admin/AdminPanel.tsx`, añade el import junto a los demás:

```tsx
import { CreditToast } from "./CreditToast";
```

Y en el contenedor de toasts (línea 86-89), añade junto a los otros dos:

```tsx
      <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col gap-2.5" style={{ width: 308 }}>
        <ModelToasts token={token} onIr={setSeccion} licenciasPendientes={licenciasPendientes} />
        <IndexToast token={token} onIr={setSeccion} />
        <CreditToast token={token} onIr={setSeccion} />
      </div>
```

- [ ] **Paso 3: comprobar tipos**

```bash
cd client && npx tsc -b 2>&1 | tail -30
```

Esperado: sin errores.

---

### Tarea 9 — el tope semanal en la tarjeta de límites de `UsersView`

**Archivos:**
- Modificar: `client/src/admin/UsersView.tsx:228` (`LEVERS`)

**Interfaces:**
- Consume: `Limits.weekly_enabled`/`Limits.max_weekly` (Tarea 6).

- [ ] **Paso 1: dos filas más, mismo patrón que las otras seis**

En `client/src/admin/UsersView.tsx`, `const LEVERS: [string, string][] = [
... ]` (línea 228), añade dos entradas:

```tsx
const LEVERS: [string, string][] = [
  ["models", "Modelos"],
  ["max_concurrent", "Concurrentes"],
  ["max_daily", "Al día"],
  ["max_storage_gb", "Almacenamiento (GB)"],
  ["queue_priority", "Prioridad"],
  ["can_create_projects", "Crear proyectos"],
  ["weekly_enabled", "Tope semanal activo"],
  ["max_weekly", "A la semana"],
];
```

No hace falta ningún otro cambio: la fila ya existente en `UsersView.tsx`
(líneas 76-98) renderiza cualquier clave de `LEVERS` genéricamente vía
`JSON.stringify`, igual que ya hace con `can_create_projects` (booleano).

- [ ] **Paso 2: comprobar tipos**

```bash
cd client && npx tsc -b 2>&1 | tail -30
```

Esperado: sin errores.

---

### Tarea 10 — diálogo "Pedir más cupo" + enganche en `CaseView`

**Archivos:**
- Crear: `client/src/work/CreditRequestDialog.tsx`
- Modificar: `client/src/work/CaseView.tsx` (detectar el 429, mostrar el botón, montar el diálogo)

**Interfaces:**
- Consume: `api.post<CreditRequestInfo>("/v1/me/credit-requests", ...)` (Tarea 3/6).

- [ ] **Paso 1: el diálogo**

Crea `client/src/work/CreditRequestDialog.tsx`:

```tsx
import { useState } from "react";
import { api, type CreateCreditReq } from "../lib/api";
import { useDismissable } from "../lib/useDismissable";
import { Backdrop, Pop } from "../ui/FloatingCard";
import { Icon } from "../ui/Icon";
import { Center } from "../ui/layout";

/** Mismo patrón visual que PromptDialog, pero con más de un campo — vive
 *  aparte porque PromptDialog está pensado para "un solo campo de texto" y
 *  forzar esto ahí lo complicaría para todos sus otros usos (crear
 *  proyecto, crear caso). */
export function CreditRequestDialog({
  open, tipoInicial, valorActual, token, onDone, onClose,
}: {
  open: boolean;
  tipoInicial: "diario" | "semanal";
  valorActual: number;
  token: string;
  onDone: () => void;
  onClose: () => void;
}) {
  const [tipo, setTipo] = useState<"diario" | "semanal">(tipoInicial);
  const [valor, setValor] = useState(String(valorActual * 2));
  const [mensaje, setMensaje] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { rendered, closing } = useDismissable(open, 180);
  if (!rendered) return null;

  const numero = Number(valor);
  const puede = Number.isFinite(numero) && numero > valorActual && !busy;

  async function enviar() {
    if (!puede) return;
    setBusy(true); setError(null);
    try {
      const req: CreateCreditReq = { tipo, valor_propuesto: numero, mensaje: mensaje.trim() || null };
      await api.post("/v1/me/credit-requests", req, token);
      onDone();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Backdrop closing={closing} onClick={busy ? undefined : onClose} />
      <Center className="z-[45]">
        <Pop closing={closing} className="w-[340px]">
          <div className="rounded-card border border-white/[.13] bg-[rgba(16,19,25,.92)] p-4 shadow-lg shadow-black/50 backdrop-blur-xl">
            <div className="mb-3.5 flex items-center gap-2.5">
              <span className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-[9px] bg-white/[.06] text-fg">
                <Icon name="lock" size={15} />
              </span>
              <p className="truncate text-[12.5px] font-medium text-fg">Pedir más cupo</p>
            </div>

            <div className="mb-3 flex gap-1.5">
              {(["diario", "semanal"] as const).map((t) => (
                <button key={t} onClick={() => setTipo(t)} disabled={busy}
                  className={`flex-1 rounded border px-2 py-1.5 text-[10.5px] transition-colors duration-300 ease-expo ${
                    tipo === t ? "border-draw text-fg" : "border-border text-subtle"}`}>
                  {t}
                </button>
              ))}
            </div>

            <div className="mb-2 flex items-baseline justify-between border-b border-border py-[5px] text-[10px]">
              <span className="text-subtle">tu tope actual</span>
              <b className="font-mono font-normal text-muted">{valorActual}</b>
            </div>

            <input autoFocus type="number" min={valorActual + 1} value={valor} disabled={busy}
              onChange={(e) => setValor(e.target.value)}
              className="mt-2 w-full rounded-[9px] border border-border bg-[#0d0f12] px-[11px] py-[9px] text-[13px] text-fg outline-none transition-colors duration-300 ease-expo focus:border-white/40" />

            <textarea value={mensaje} disabled={busy} rows={2} placeholder="Motivo (opcional)"
              onChange={(e) => setMensaje(e.target.value)}
              className="mt-2 w-full resize-none rounded-[9px] border border-border bg-[#0d0f12] px-[11px] py-[9px] text-[12.5px] text-fg outline-none transition-colors duration-300 ease-expo placeholder:text-subtle focus:border-white/40" />

            {error && <p className="mt-1.5 text-[10.5px] leading-snug text-danger-fg">{error}</p>}

            <div className="mt-3.5 flex items-center gap-2">
              <span className="mr-auto font-mono text-[10px] text-[#4a4d52]">esc cancelar</span>
              <button onClick={onClose} disabled={busy} className="jg-press rounded-[9px] border border-white/15 px-3.5 py-[7px] text-[11.5px] text-fg disabled:opacity-40">Cancelar</button>
              <button onClick={enviar} disabled={!puede} className="jg-press rounded-[9px] bg-accent px-4 py-[7px] text-[11.5px] font-medium text-black disabled:opacity-40">
                {busy ? "Un momento…" : "Enviar"}
              </button>
            </div>
          </div>
        </Pop>
      </Center>
    </>
  );
}
```

Si `Center`/`Backdrop`/`Pop`/`useDismissable` no se importan exactamente
así en otros ficheros de `work/` (algunos importan `Center` desde
`../ui/layout`, ver `PromptDialog.tsx`), respeta esa misma ruta — ya está
escrita arriba igual que en `PromptDialog.tsx`.

- [ ] **Paso 2: detectar el tope agotado y ofrecer el botón, en `CaseView.tsx`**

En `client/src/work/CaseView.tsx`, añade el import junto a los demás:

```tsx
import { CreditRequestDialog } from "./CreditRequestDialog";
```

Añade un estado nuevo junto a `const [error, setError] = useState<string | null>(null);` (línea 43):

```tsx
  const [topeAlcanzado, setTopeAlcanzado] = useState<{ tipo: "diario" | "semanal"; valor: number } | null>(null);
  const [pidiendoCupo, setPidiendoCupo] = useState(false);
```

En `async function analyze(...)` (línea 166), el bloque `catch`:

```tsx
    } catch (e) {
      setError(String(e));
    } finally {
```

pasa a:

```tsx
    } catch (e) {
      const msg = String(e);
      setError(msg);
      // El backend no manda el código de estado por este puente (ver
      // `client/src-tauri/src/main.rs::request`, que solo devuelve el
      // cuerpo de texto) — se detecta por el mensaje exacto que emite
      // `analyses::create` (`crates/lumid/src/routes/analyses.rs`). Si
      // cambia esa redacción, esto deja de detectarlo.
      if (msg.includes("has llegado a tu tope de")) {
        setTopeAlcanzado({ tipo: msg.includes("diarios") ? "diario" : "semanal", valor: 0 });
      } else {
        setTopeAlcanzado(null);
      }
    } finally {
```

En el toast de error ya existente (líneas 331-338), añade el botón:

```tsx
      {error !== null && staged === null && (
        <div className="absolute bottom-[66px] left-1/2 z-30 flex max-w-[420px] -translate-x-1/2 items-start
          gap-2 rounded-lg border border-danger/40 bg-[rgba(24,18,18,.94)] px-3 py-2 backdrop-blur"
          style={{ animation: "jg-toast-in 240ms cubic-bezier(.16,1,.3,1) both" }}>
          <p className="text-[10.5px] leading-snug text-danger-fg">{error}</p>
          {topeAlcanzado && (
            <button onClick={() => setPidiendoCupo(true)}
              className="jg-press shrink-0 rounded-md border border-white/15 px-2 py-1 text-[10px] text-fg">
              Pedir más cupo
            </button>
          )}
          <button onClick={() => setError(null)} className="jg-press shrink-0 text-subtle hover:text-fg">✕</button>
        </div>
      )}
```

Y monta el diálogo al final del componente, junto a los otros popups
(cerca de `<ResultsDrawer .../>` o `<UploadPopup .../>`):

```tsx
      {topeAlcanzado && token && (
        <CreditRequestDialog
          open={pidiendoCupo}
          tipoInicial={topeAlcanzado.tipo}
          valorActual={topeAlcanzado.tipo === "diario" ? (useServer.getState().limits?.max_daily ?? 50) : (useServer.getState().limits?.max_weekly ?? 300)}
          token={token}
          onDone={() => { setPidiendoCupo(false); setError(null); setTopeAlcanzado(null); }}
          onClose={() => setPidiendoCupo(false)} />
      )}
```

- [ ] **Paso 3: comprobar tipos**

```bash
cd client && npx tsc -b 2>&1 | tail -30
```

Esperado: sin errores.

---

### Tarea 11 — verificación final y commit único

- [ ] **Paso 1: build completo del workspace Rust**

```bash
cargo build 2>&1 | tail -40
```

Esperado: compila limpio (aparte de warnings preexistentes ajenos a este
plan, como el de `PuntoCurva`).

- [ ] **Paso 2: tests de `lumid` y `lumi-proto`**

```bash
cargo test -p lumid -p lumi-proto 2>&1 | tail -40
```

Esperado: todo en verde, mismo número de tests que antes de este plan más
ninguno nuevo (no se han añadido tests, por convención del proyecto).

- [ ] **Paso 3: tipos y lint del cliente**

```bash
cd client && npx tsc -b 2>&1 | tail -40 && npm run lint 2>&1 | tail -40
```

Esperado: sin errores de tipos; el lint puede señalar preexistentes ajenos,
no nuevos en los ficheros tocados por este plan.

- [ ] **Paso 4: un solo commit**

```bash
git add crates/lumi-proto/src/api.rs crates/lumid/src/limits.rs \
  crates/lumid/src/store.rs crates/lumid/src/routes/analyses.rs \
  crates/lumid/src/routes/credit_requests.rs crates/lumid/src/routes/mod.rs \
  crates/lumid/src/routes/admin.rs crates/lumid/src/main.rs \
  client/src-tauri/src/main.rs client/src/lib/bridge.ts client/src/lib/api.ts \
  client/src/admin/RequestsView.tsx client/src/admin/AdminPanel.tsx \
  client/src/admin/CreditToast.tsx client/src/admin/UsersView.tsx \
  client/src/work/CreditRequestDialog.tsx client/src/work/CaseView.tsx
git commit -m "$(cat <<'EOF'
feat: tope semanal, solicitud de más cupo y aviso al admin

Tope semanal opcional junto al diario ya existente (limits.rs, misma
mecánica de dos niveles). Las solicitudes de más cupo se integran en la
sección Solicitudes ya existente junto a las de acceso, distinguidas por
icono en vez de una columna nueva. El admin recibe un toast en tiempo
real vía un SSE nuevo (/v1/admin/events), mismo patrón que la cola.
EOF
)"
```

## Cobertura de la spec

- A (tope semanal): Tareas 1, 2 (paso 2), 9.
- B (solicitud de más cupo): Tareas 2 (paso 1), 3, 10.
- C (integración en Solicitudes): Tarea 7.
- D (aviso SSE + toast): Tareas 3 (pasos 4-5), 4, 5, 8.
- E (diálogo de usuario): Tarea 10.
- API keys ya cubiertas: sin tarea, confirmado en la spec que no requiere cambio.
