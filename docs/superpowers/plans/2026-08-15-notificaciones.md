# Notificaciones Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un administrador escribe avisos (texto enriquecido con negrita/cursiva/color/fuente y
emoji, un icono, prioridad normal/urgente, y un destino — todos, solo administradores, o personas
concretas) desde una nueva sección "Notificaciones" del panel; cada sesión conectada los recibe
en tiempo real por la campana ya existente (`NotificationsPopover.tsx`), filtrados a lo que le
corresponde a ella.

**Architecture:** Dos tablas nuevas (`avisos`, `avisos_usuarios`) y tres rutas admin-only
(crear/listar-todo/borrar). El reparto en vivo no usa una ruta nueva: reutiliza la muestra de
telemetría (`Sample`, ya emitida por SSE cada segundo a toda sesión abierta) añadiéndole
`avisos: Vec<AvisoInfo>` — pero esa muestra deja de ser igual para todo el mundo, porque
`routes::telemetry::sse` ahora resuelve quién pregunta (una vez, al abrir la conexión) y filtra
los avisos a los que le tocan a esa sesión. El contenido rico se guarda como el documento JSON
propio del editor Tiptap, nunca HTML — así nadie renderiza markup arbitrario de otra persona.

**Tech Stack:** Rust (axum 0.7, rusqlite), React 19 + TypeScript (Tauri client), SQLite, Tiptap
(`@tiptap/react`, `@tiptap/pm`, `@tiptap/starter-kit`, `@tiptap/extension-text-style`).

## Global Constraints

- **No tests automáticos fuera de `lumi-proto`.** Cada paso de este plan termina en verificación
  manual (`cargo build`, un `curl`, `npx tsc -b`, o un click-through), no en `#[test]` nuevos en
  `lumid` ni `.test.tsx` en el cliente.
- **Español** en identificadores y comentarios.
- **Sin dependencias nuevas de Cargo.** La única dependencia nueva de este plan es de npm
  (Tiptap), ya acordada en el diseño — explícitamente distinta de la norma de "sin Cargo nuevo".
- **Sin fuentes por CDN.** Las tres fuentes ofrecidas (Sans/Serif/Mono) son o ya están
  vendorizadas (`@fontsource/inter`, ya en `package.json`) o son pilas de fuentes de sistema —
  nada se descarga en tiempo de ejecución.
- **Reutilizar iconos existentes.** El selector de icono de un aviso usa 8 nombres ya presentes
  en `Icon.tsx` (`bell`, `alert`, `wrench`, `boxes`, `cloud`, `shield`, `globe`, `layers`) — no se
  dibuja ningún icono nuevo.

---

### Task 1: Esquema — tablas `avisos` y `avisos_usuarios`

**Files:**
- Modify: `crates/lumid/src/store.rs:207-214` (dentro del const `SCHEMA`)

**Interfaces:**
- Produces: tablas `avisos(id, contenido, icono, prioridad, destino, creado_por, created_at)` y
  `avisos_usuarios(aviso_id, user_id)` — consumidas por Task 3 (rutas) y Task 4 (filtro de
  telemetría).

- [ ] **Step 1: Añadir las dos tablas al final de `SCHEMA`**

En `crates/lumid/src/store.rs`, encuentra:

```rust
CREATE TABLE IF NOT EXISTS ip_denylist (
    ip        TEXT PRIMARY KEY,
    added_at  INTEGER NOT NULL
);
";
```

Reemplaza por (añade las dos tablas nuevas antes del cierre `";`):

```rust
CREATE TABLE IF NOT EXISTS ip_denylist (
    ip        TEXT PRIMARY KEY,
    added_at  INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS avisos (
    id           INTEGER PRIMARY KEY,
    -- Documento JSON del editor Tiptap, NUNCA HTML: quien lo lee en otra
    -- sesión nunca pasa por un render de markup arbitrario.
    contenido    TEXT NOT NULL,
    icono        TEXT NOT NULL,
    prioridad    TEXT NOT NULL,
    destino      TEXT NOT NULL,
    creado_por   TEXT NOT NULL,
    created_at   INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS avisos_usuarios (
    aviso_id  INTEGER NOT NULL,
    user_id   INTEGER NOT NULL,
    PRIMARY KEY (aviso_id, user_id)
);
";
```

- [ ] **Step 2: Verificar que la migración sigue siendo idempotente**

Run:
```bash
cargo test -p lumid store::tests::abrir_dos_veces_migra_sin_romper
```
Expected: `test result: ok`. Este test ya abre el almacén dos veces, lo que vuelve a ejecutar
`SCHEMA` entero — si alguna de las dos tablas nuevas estuviera mal formada, esto falla.

- [ ] **Step 3: Commit**

```bash
git add crates/lumid/src/store.rs
git commit -m "schema: tablas avisos y avisos_usuarios"
```

---

### Task 2: `lumi-proto` — `AvisoInfo`, `CrearAvisoReq`, y `Sample.avisos`

**Files:**
- Modify: `crates/lumi-proto/src/api.rs` (junto a `SecuritySettings`, y dentro de `Sample`)

**Interfaces:**
- Produces: `AvisoInfo { id, contenido, icono, prioridad, destino, creado_por, created_at }`,
  `CrearAvisoReq { contenido, icono, prioridad, destino, usuarios }`, y `Sample.avisos:
  Vec<AvisoInfo>` — consumidos por Task 3 (rutas), Task 4 (filtro de telemetría), y Task 5
  (espejo TypeScript).

- [ ] **Step 1: Añadir los dos structs nuevos**

En `crates/lumi-proto/src/api.rs`, añade junto a `SecuritySettings`:

```rust
#[derive(Debug, Serialize, Clone)]
pub struct AvisoInfo {
    pub id: i64,
    /// Documento JSON de Tiptap — un `serde_json::Value` estructurado, no un
    /// `String` con HTML: así el propio esquema de Tiptap es lo único que
    /// puede llegar a pintarse, nunca markup arbitrario.
    pub contenido: serde_json::Value,
    pub icono: String,
    /// `"normal"` | `"urgente"`.
    pub prioridad: String,
    /// `"todos"` | `"admins"` | `"personas"`.
    pub destino: String,
    pub creado_por: String,
    pub created_at: i64,
}

#[derive(Debug, Deserialize)]
pub struct CrearAvisoReq {
    pub contenido: serde_json::Value,
    pub icono: String,
    pub prioridad: String,
    pub destino: String,
    /// Solo se usa si `destino == "personas"`: usernames a resolver.
    pub usuarios: Vec<String>,
}
```

- [ ] **Step 2: Ampliar `Sample`**

Encuentra:

```rust
pub struct Sample {
    pub gpus: Vec<GpuSample>,
    pub cpu_pct: f32,
    pub ram_used_mb: u64,
    pub disk_free_mb: u64,
    pub queue_depth: u32,
    pub queue_paused: bool,
    /// Va también aquí, no solo en `SecuritySettings`: esta muestra ya llega
    /// a toda la app (cliente entero, no solo el panel de administración)
    /// una vez por segundo, así que es el transporte natural para que la
    /// tira de aviso se vea desde cualquier pantalla, no solo Seguridad.
    pub maintenance: bool,
    pub maintenance_message: String,
}
```

Reemplaza por:

```rust
pub struct Sample {
    pub gpus: Vec<GpuSample>,
    pub cpu_pct: f32,
    pub ram_used_mb: u64,
    pub disk_free_mb: u64,
    pub queue_depth: u32,
    pub queue_paused: bool,
    /// Va también aquí, no solo en `SecuritySettings`: esta muestra ya llega
    /// a toda la app (cliente entero, no solo el panel de administración)
    /// una vez por segundo, así que es el transporte natural para que la
    /// tira de aviso se vea desde cualquier pantalla, no solo Seguridad.
    pub maintenance: bool,
    pub maintenance_message: String,
    /// Ya filtrados por `routes::telemetry::sse` según quién abrió esta
    /// conexión — lo que llega aquí es exactamente lo que le toca ver a esa
    /// sesión, ordenado con los urgentes primero.
    pub avisos: Vec<AvisoInfo>,
}
```

- [ ] **Step 3: Verificar que `lumi-proto` compila y sus tests pasan**

Run:
```bash
cargo test -p lumi-proto
```
Expected: `test result: ok` (5 tests existentes, sin cambios — los structs nuevos son datos
planos).

- [ ] **Step 4: Commit**

```bash
git add crates/lumi-proto/src/api.rs
git commit -m "feat: tipos de avisos y Sample.avisos"
```

---

### Task 3: Rutas — `routes/avisos.rs`

**Files:**
- Create: `crates/lumid/src/routes/avisos.rs`
- Modify: `crates/lumid/src/routes/mod.rs`
- Modify: `crates/lumid/src/main.rs` (registro de rutas)

**Interfaces:**
- Consumes: `crate::routes::auth::{bearer, require_admin}`, `crate::routes::access::now`,
  `lumi_proto::api::{AvisoInfo, CrearAvisoReq}` (Task 2).
- Produces: `list_all`, `create`, `remove` — registradas como rutas en este mismo Task, y
  consumidas por el cliente en Tasks 7-8.

- [ ] **Step 1: Escribir los handlers**

Create `crates/lumid/src/routes/avisos.rs`:

```rust
//! Avisos del administrador: broadcast, solo-admins, o dirigidos a personas
//! concretas. El contenido es el documento JSON de Tiptap — se guarda y se
//! devuelve tal cual, como valor JSON anidado, nunca como una cadena HTML
//! que alguna pantalla tuviera que interpretar.

use crate::routes::access::now;
use crate::routes::auth::{bearer, require_admin};
use crate::App;
use axum::extract::{Path, State};
use axum::{http::HeaderMap, http::StatusCode, Json};
use lumi_proto::api::{AvisoInfo, CrearAvisoReq};

const SELECT_AVISO: &str =
    "SELECT id, contenido, icono, prioridad, destino, creado_por, created_at FROM avisos";

fn map_row(r: &rusqlite::Row) -> rusqlite::Result<AvisoInfo> {
    let contenido_texto: String = r.get(1)?;
    Ok(AvisoInfo {
        id: r.get(0)?,
        contenido: serde_json::from_str(&contenido_texto).unwrap_or(serde_json::Value::Null),
        icono: r.get(2)?,
        prioridad: r.get(3)?,
        destino: r.get(4)?,
        creado_por: r.get(5)?,
        created_at: r.get(6)?,
    })
}

/// Sin filtrar por destino: solo la pantalla de gestión llama a esto, y
/// necesita ver y poder borrar cualquier aviso, esté dirigido a quien esté
/// — a diferencia de la campana, que recibe la lista ya filtrada por
/// `telemetry::sample` (Task 4).
pub async fn list_all(State(app): State<App>, headers: HeaderMap) -> Result<Json<Vec<AvisoInfo>>, StatusCode> {
    require_admin(&app, &bearer(&headers))?;
    let c = app.store.conn();
    let mut q = c
        .prepare(&format!("{SELECT_AVISO} ORDER BY created_at DESC"))
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let filas = q.query_map([], map_row).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(filas.flatten().collect()))
}

pub async fn create(
    State(app): State<App>,
    headers: HeaderMap,
    Json(req): Json<CrearAvisoReq>,
) -> Result<Json<AvisoInfo>, (StatusCode, String)> {
    let uid = require_admin(&app, &bearer(&headers)).map_err(|c| (c, "hace falta ser administrador".to_string()))?;
    if !["todos", "admins", "personas"].contains(&req.destino.as_str()) {
        return Err((StatusCode::BAD_REQUEST, "destino desconocido".to_string()));
    }
    if req.destino == "personas" && req.usuarios.is_empty() {
        return Err((StatusCode::BAD_REQUEST, "faltan los destinatarios".to_string()));
    }

    let c = app.store.conn();
    let creado_por: String = c
        .query_row("SELECT username FROM users WHERE id = ?1", [uid], |r| r.get(0))
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let t = now();
    let contenido_texto = serde_json::to_string(&req.contenido).unwrap_or_default();
    c.execute(
        "INSERT INTO avisos (contenido, icono, prioridad, destino, creado_por, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        rusqlite::params![contenido_texto, req.icono, req.prioridad, req.destino, creado_por, t],
    )
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let id = c.last_insert_rowid();

    if req.destino == "personas" {
        for username in &req.usuarios {
            let uid: Option<i64> = c
                .query_row("SELECT id FROM users WHERE username = ?1", [username], |r| r.get(0))
                .ok();
            if let Some(uid) = uid {
                c.execute(
                    "INSERT OR IGNORE INTO avisos_usuarios (aviso_id, user_id) VALUES (?1, ?2)",
                    rusqlite::params![id, uid],
                )
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
            }
        }
    }

    c.query_row(&format!("{SELECT_AVISO} WHERE id = ?1"), [id], map_row)
        .map(Json)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))
}

/// Cualquier administrador puede borrar cualquier aviso, no solo quien lo
/// escribió — mismo criterio que el resto del panel, que no distingue entre
/// administradores.
pub async fn remove(State(app): State<App>, Path(id): Path<i64>, headers: HeaderMap) -> Result<StatusCode, StatusCode> {
    require_admin(&app, &bearer(&headers))?;
    let c = app.store.conn();
    let n = c
        .execute("DELETE FROM avisos WHERE id = ?1", [id])
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    c.execute("DELETE FROM avisos_usuarios WHERE aviso_id = ?1", [id]).ok();
    if n == 0 {
        return Err(StatusCode::NOT_FOUND);
    }
    Ok(StatusCode::NO_CONTENT)
}
```

- [ ] **Step 2: Declarar el módulo**

En `crates/lumid/src/routes/mod.rs`, añade a la lista (orden alfabético, entre `auth` y `cases`):

```rust
pub mod avisos;
```

- [ ] **Step 3: Registrar las rutas**

En `crates/lumid/src/main.rs`, añade justo después del bloque de `security` (después de la línea
`.route("/v1/admin/security/denylist", ...)`) y antes de `/v1/projects`:

```rust
        .route("/v1/admin/avisos", get(routes::avisos::list_all).post(routes::avisos::create))
        .route("/v1/avisos/:id", axum::routing::delete(routes::avisos::remove))
```

- [ ] **Step 4: Verificar que compila**

Run:
```bash
cargo build -p lumid
```
Expected: builds clean.

- [ ] **Step 5: Verificar manualmente contra un daemon corriendo**

Con `lumid` corriendo y `$TOKEN` una sesión de administrador:

```bash
curl -sk -X POST https://localhost:7717/v1/admin/avisos \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"contenido":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"prueba"}]}]},"icono":"bell","prioridad":"normal","destino":"todos","usuarios":[]}'
```
Expected: un JSON con `"icono":"bell"`, `"prioridad":"normal"`, `"destino":"todos"`, y
`"contenido"` como objeto anidado (no una cadena escapada).

```bash
curl -sk https://localhost:7717/v1/admin/avisos -H "Authorization: Bearer $TOKEN"
```
Expected: un array con ese aviso.

```bash
curl -sk -X DELETE https://localhost:7717/v1/avisos/1 -H "Authorization: Bearer $TOKEN"
curl -sk https://localhost:7717/v1/admin/avisos -H "Authorization: Bearer $TOKEN"
```
Expected: `204` en el borrado, luego un array vacío.

- [ ] **Step 6: Commit**

```bash
git add crates/lumid/src/routes/avisos.rs crates/lumid/src/routes/mod.rs crates/lumid/src/main.rs
git commit -m "feat: rutas de gestion de avisos (crear, listar, borrar)"
```

---

### Task 4: Telemetría consciente del destinatario

**Files:**
- Modify: `crates/lumid/src/telemetry.rs`
- Modify: `crates/lumid/src/routes/telemetry.rs`

**Interfaces:**
- Consumes: `crate::routes::auth::{bearer, require_session}`.
- Produces: `telemetry::sample(app: &App, visto_por: Option<(i64, bool)>) -> Sample` (firma
  cambiada — antes solo tomaba `&App`), consumido por `routes::telemetry::sse` en este mismo
  Task.

- [ ] **Step 1: Cambiar la firma de `sample` y filtrar avisos**

En `crates/lumid/src/telemetry.rs`, encuentra:

```rust
use crate::App;
use lumi_proto::api::{GpuSample, Sample};

pub fn sample(app: &App) -> Sample {
```

Reemplaza por:

```rust
use crate::App;
use lumi_proto::api::{AvisoInfo, GpuSample, Sample};

pub fn sample(app: &App, visto_por: Option<(i64, bool)>) -> Sample {
```

Encuentra el final de la función:

```rust
        queue_paused: !app.queue.hay_trabajadores(),
        maintenance: crate::mantenimiento::activo(app),
        maintenance_message: crate::mantenimiento::mensaje(app),
    }
}
```

Reemplaza por:

```rust
        queue_paused: !app.queue.hay_trabajadores(),
        maintenance: crate::mantenimiento::activo(app),
        maintenance_message: crate::mantenimiento::mensaje(app),
        avisos: avisos_para(app, visto_por),
    }
}

/// `None` (sesión inválida o sin token) significa "sin avisos" — el resto de
/// la muestra sigue llegando igual, esto es lo único que depende de quién
/// pregunta. Se resuelve una vez al abrir la conexión SSE
/// (`routes::telemetry::sse`), no en cada muestra: la identidad de una
/// sesión no cambia mientras el stream sigue abierto.
fn avisos_para(app: &App, visto_por: Option<(i64, bool)>) -> Vec<AvisoInfo> {
    let Some((user_id, is_admin)) = visto_por else { return Vec::new() };
    let c = app.store.conn();
    let Ok(mut q) = c.prepare(
        "SELECT id, contenido, icono, prioridad, destino, creado_por, created_at
         FROM avisos ORDER BY created_at DESC",
    ) else {
        return Vec::new();
    };
    let Ok(filas) = q.query_map([], |r| {
        let contenido_texto: String = r.get(1)?;
        Ok(AvisoInfo {
            id: r.get(0)?,
            contenido: serde_json::from_str(&contenido_texto).unwrap_or(serde_json::Value::Null),
            icono: r.get(2)?,
            prioridad: r.get(3)?,
            destino: r.get(4)?,
            creado_por: r.get(5)?,
            created_at: r.get(6)?,
        })
    }) else {
        return Vec::new();
    };
    let mut avisos: Vec<AvisoInfo> = filas
        .flatten()
        .filter(|a| {
            a.destino == "todos"
                || (a.destino == "admins" && is_admin)
                || (a.destino == "personas" && incluye_a(app, a.id, user_id))
        })
        .collect();
    // Los urgentes van primero, pero conservando el orden por fecha DENTRO
    // de cada grupo — `sort_by_key` es estable, y la consulta ya vino
    // ordenada por `created_at DESC`.
    avisos.sort_by_key(|a| a.prioridad != "urgente");
    avisos
}

fn incluye_a(app: &App, aviso_id: i64, user_id: i64) -> bool {
    app.store
        .conn()
        .query_row(
            "SELECT 1 FROM avisos_usuarios WHERE aviso_id = ?1 AND user_id = ?2",
            rusqlite::params![aviso_id, user_id],
            |_| Ok(()),
        )
        .is_ok()
}
```

- [ ] **Step 2: Resolver la identidad una vez al abrir la conexión SSE**

En `crates/lumid/src/routes/telemetry.rs`, reemplaza el fichero entero por:

```rust
use crate::routes::auth::{bearer, require_session};
use crate::{telemetry, App};
use axum::extract::State;
use axum::http::HeaderMap;
use axum::response::sse::{Event, KeepAlive, Sse};
use futures::stream::Stream;
use std::convert::Infallible;
use std::time::Duration;

pub async fn sse(State(app): State<App>, headers: HeaderMap) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    // Se resuelve UNA VEZ, no en cada muestra: quién es esta conexión no
    // cambia mientras el stream sigue abierto. `None` (sin token, o token
    // caducado) no rompe la telemetría — solo deja `avisos` vacío, el resto
    // de la muestra (GPU, cola, mantenimiento) sigue sin depender de esto,
    // igual que en `LOCKED`.
    let visto_por = require_session(&app, &bearer(&headers)).ok();
    let stream = async_stream::stream! {
        loop {
            let s = telemetry::sample(&app, visto_por);
            yield Ok(Event::default().json_data(&s).unwrap_or_default());
            tokio::time::sleep(Duration::from_secs(1)).await;
        }
    };
    Sse::new(stream).keep_alive(KeepAlive::default())
}
```

- [ ] **Step 3: Verificar que compila**

Run:
```bash
cargo build -p lumid
```
Expected: builds clean. (`main.rs` no necesita cambios — la ruta `/v1/telemetry` ya está
registrada y axum resuelve los extractors nuevos del handler automáticamente.)

- [ ] **Step 4: Verificar el filtrado manualmente**

Con `lumid` corriendo, `$TOKEN` un admin, y un usuario no-admin `ana` con token `$TOKEN_ANA`: crea
un aviso dirigido solo a `admins` (Task 3 Step 5, con `"destino":"admins"`), y observa un instante
de cada stream:

```bash
curl -sk --max-time 2 https://localhost:7717/v1/telemetry -H "Authorization: Bearer $TOKEN"
curl -sk --max-time 2 https://localhost:7717/v1/telemetry -H "Authorization: Bearer $TOKEN_ANA"
```
Expected: el primero incluye el aviso en su campo `avisos`; el segundo, `"avisos":[]`. Repite
creando uno con `"destino":"personas","usuarios":["ana"]` — ahora debe aparecer en el segundo pero
no en el primero (a menos que el admin también esté en la lista).

- [ ] **Step 5: Commit**

```bash
git add crates/lumid/src/telemetry.rs crates/lumid/src/routes/telemetry.rs
git commit -m "feat: telemetria filtra avisos segun quien pregunta"
```

---

### Task 5: Cliente — dependencia de Tiptap y tipos

**Files:**
- Modify: `client/package.json` (vía `npm install`)
- Modify: `client/src/lib/api.ts`

**Interfaces:**
- Produces: `AvisoInfo`, `CrearAvisoReq` (TS, espejo de Task 2), `Sample.avisos: AvisoInfo[]` —
  consumidos por Tasks 6-8.

- [ ] **Step 1: Instalar Tiptap**

```bash
cd client && npm install @tiptap/react @tiptap/pm @tiptap/starter-kit @tiptap/extension-text-style
```
Expected: cuatro paquetes nuevos en `dependencies` de `client/package.json`, sin errores de
peer-dependency (React 19 ya está en el proyecto y Tiptap lo soporta).

- [ ] **Step 2: Añadir los tipos TS**

En `client/src/lib/api.ts`, añade junto a `SecuritySettings`:

```ts
export interface AvisoInfo {
  id: number;
  /** Documento JSON de Tiptap — opaco para el resto del cliente, solo lo
   *  entiende `AvisoEditor`. */
  contenido: unknown;
  icono: string;
  prioridad: "normal" | "urgente";
  destino: "todos" | "admins" | "personas";
  creado_por: string;
  created_at: number;
}
export interface CrearAvisoReq {
  contenido: unknown;
  icono: string;
  prioridad: "normal" | "urgente";
  destino: "todos" | "admins" | "personas";
  usuarios: string[];
}
```

Luego, en la interfaz `Sample` ya existente, añade el campo:

```ts
export interface Sample {
  gpus: GpuSample[];
  cpu_pct: number;
  ram_used_mb: number;
  disk_free_mb: number;
  queue_depth: number;
  queue_paused: boolean;
  maintenance: boolean;
  maintenance_message: string;
  avisos: AvisoInfo[];
}
```

- [ ] **Step 3: Verificar que typechecka**

Run:
```bash
cd client && npx tsc -b
```
Expected: sin errores (tipos nuevos sin usar todavía, lo que TypeScript no marca).

- [ ] **Step 4: Commit**

```bash
git add client/package.json client/package-lock.json client/src/lib/api.ts
git commit -m "feat: dependencia de Tiptap y tipos de avisos"
```

---

### Task 6: `AvisoEditor.tsx` — envoltorio de Tiptap (compositor y lectura)

**Files:**
- Create: `client/src/admin/AvisoEditor.tsx`

**Interfaces:**
- Consumes: `@tiptap/react`, `@tiptap/starter-kit`, `@tiptap/extension-text-style` (Task 5).
- Produces: `<AvisoEditor contenido={unknown} onChange={(json) => void} editable={boolean} />` —
  consumido por `NotificacionesView.tsx` (Task 7, en ambos modos) y
  `NotificationsPopover.tsx` (Task 8, solo lectura).

- [ ] **Step 1: Escribir el componente**

Create `client/src/admin/AvisoEditor.tsx`:

```tsx
import { useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import { StarterKit } from "@tiptap/starter-kit";
import { Color, FontFamily, TextStyle } from "@tiptap/extension-text-style";

const FUENTES = [
  { label: "Sans", value: "" },
  { label: "Serif", value: "Georgia, 'Times New Roman', serif" },
  { label: "Mono", value: "ui-monospace, SFMono-Regular, Menlo, monospace" },
];
const COLORES = ["#e8e8e6", "#85b7eb", "#efb968", "#e88f8f"];
const EMOJIS = ["🔔", "⚠️", "🔧", "📦", "☁️", "🚀", "🎉", "✅", "📅", "💬", "🛡️", "⭐"];

const DOC_VACIO = { type: "doc", content: [{ type: "paragraph" }] };

/** Un solo componente para escribir y para leer: en modo lectura
 *  (`editable={false}`) es exactamente el mismo esquema de Tiptap sin la
 *  barra, nunca un `dangerouslySetInnerHTML` aparte — así lo que un
 *  administrador escribe no puede convertirse en markup arbitrario en la
 *  pantalla de otra persona. */
export function AvisoEditor({ contenido, onChange, editable = true }: {
  contenido: unknown; onChange?: (json: unknown) => void; editable?: boolean;
}) {
  const [emojiAbierto, setEmojiAbierto] = useState(false);
  const editor = useEditor({
    extensions: [StarterKit, TextStyle, Color, FontFamily],
    content: (contenido ?? DOC_VACIO) as never,
    editable,
    onUpdate: ({ editor }) => onChange?.(editor.getJSON()),
  });

  if (!editor) return null;

  if (!editable) {
    return <div className="aviso-lectura text-[12px] leading-[1.55] text-fg"><EditorContent editor={editor} /></div>;
  }

  return (
    <div className="overflow-hidden rounded-card border border-border bg-panel">
      <div className="flex flex-wrap items-center gap-0.5 border-b border-border bg-elevated px-2 py-1.5">
        <button type="button" onClick={() => editor.chain().focus().toggleBold().run()}
          className={`grid h-6 w-6 place-items-center rounded-md text-[12px] font-bold ${
            editor.isActive("bold") ? "bg-white/[.09] text-fg" : "text-muted"}`}>B</button>
        <button type="button" onClick={() => editor.chain().focus().toggleItalic().run()}
          className={`grid h-6 w-6 place-items-center rounded-md text-[12px] italic ${
            editor.isActive("italic") ? "bg-white/[.09] text-fg" : "text-muted"}`}>i</button>
        <span className="mx-1.5 h-4 w-px bg-border" />
        <div className="flex gap-1">
          {COLORES.map((c) => (
            <button key={c} type="button" onClick={() => editor.chain().focus().setColor(c).run()}
              className="h-[15px] w-[15px] rounded border border-white/15" style={{ background: c }} />
          ))}
        </div>
        <span className="mx-1.5 h-4 w-px bg-border" />
        <select onChange={(e) => editor.chain().focus().setFontFamily(e.target.value).run()}
          defaultValue="" className="h-6 rounded-md border border-border bg-panel px-1.5 text-[10.5px] text-fg">
          {FUENTES.map((f) => <option key={f.label} value={f.value}>{f.label}</option>)}
        </select>
        <span className="mx-1.5 h-4 w-px bg-border" />
        <div className="relative">
          <button type="button" onClick={() => setEmojiAbierto((v) => !v)}
            className="grid h-6 w-6 place-items-center rounded-md text-[12px] text-muted hover:text-fg">🙂</button>
          {emojiAbierto && (
            <div className="absolute left-0 top-[calc(100%+4px)] z-10 grid grid-cols-6 gap-0.5
              rounded-lg border border-white/15 bg-[rgba(20,22,26,.98)] p-1.5 shadow-lg shadow-black/50">
              {EMOJIS.map((e) => (
                <button key={e} type="button"
                  onClick={() => { editor.chain().focus().insertContent(e).run(); setEmojiAbierto(false); }}
                  className="grid h-6 w-6 place-items-center rounded text-[13px] hover:bg-white/[.07]">{e}</button>
              ))}
            </div>
          )}
        </div>
      </div>
      <EditorContent editor={editor} className="px-3 py-2.5 text-[12px] text-fg" />
    </div>
  );
}
```

- [ ] **Step 2: Verificar que typechecka**

Run:
```bash
cd client && npx tsc -b
```
Expected: sin errores.

- [ ] **Step 3: Verificar visualmente**

```bash
cd client && npm run dev
```
Monta temporalmente `<AvisoEditor contenido={null} onChange={console.log} />` en cualquier
pantalla ya abierta (por ejemplo al principio de `ResumenView.tsx`), confirma que la barra
responde (negrita, cursiva, color, fuente, emoji) y que `onChange` imprime un documento JSON en
consola al escribir. Quita el montaje temporal antes de seguir.

- [ ] **Step 4: Commit**

```bash
git add client/src/admin/AvisoEditor.tsx
git commit -m "feat: AvisoEditor, envoltorio de Tiptap para componer y leer avisos"
```

---

### Task 7: `NotificacionesView.tsx` y conexión en el panel

**Files:**
- Create: `client/src/admin/NotificacionesView.tsx`
- Modify: `client/src/admin/AdminPanel.tsx`
- Modify: `client/src/admin/Hueco.tsx`

**Interfaces:**
- Consumes: `AvisoEditor` (Task 6), `AvisoInfo`/`CrearAvisoReq`/`UserSummary` (Task 5, y
  `UserSummary` ya existente), `/v1/admin/avisos` + `/v1/avisos/:id` (Task 3),
  `/v1/users/search?q=` (ya existente, mismo patrón que `InviteDrawer.tsx`).
- Produces: `<NotificacionesView token={string} />`, conectada en `AdminPanel.tsx` en lugar del
  `Hueco` de esa sección.

- [ ] **Step 1: Escribir el componente**

Create `client/src/admin/NotificacionesView.tsx`:

```tsx
import { useEffect, useState } from "react";
import { api, type AvisoInfo, type UserSummary } from "../lib/api";
import { Icon, type IconName } from "../ui/Icon";
import { AvisoEditor } from "./AvisoEditor";
import { Seccion } from "./AdminPanel";

const ICONOS: IconName[] = ["bell", "alert", "wrench", "boxes", "cloud", "shield", "globe", "layers"];
const DOC_VACIO = { type: "doc", content: [{ type: "paragraph" }] };

function ago(ts: number): string {
  const s = Math.max(0, Math.floor(Date.now() / 1000) - ts);
  if (s < 60) return "ahora";
  if (s < 3600) return `${Math.floor(s / 60)} min`;
  if (s < 86400) return `${Math.floor(s / 3600)} h`;
  return `${Math.floor(s / 86400)} d`;
}

export function NotificacionesView({ token }: { token: string }) {
  const [avisos, setAvisos] = useState<AvisoInfo[] | null>(null);
  const [contenido, setContenido] = useState<unknown>(DOC_VACIO);
  const [icono, setIcono] = useState<IconName>("bell");
  const [prioridad, setPrioridad] = useState<"normal" | "urgente">("normal");
  const [destino, setDestino] = useState<"todos" | "admins" | "personas">("todos");
  const [usuarios, setUsuarios] = useState<string[]>([]);
  const [busca, setBusca] = useState("");
  const [sugerencias, setSugerencias] = useState<UserSummary[]>([]);

  function cargar() { return api.get<AvisoInfo[]>("/v1/admin/avisos", token).then(setAvisos); }
  useEffect(() => { void cargar(); }, [token]);

  useEffect(() => {
    const t = setTimeout(() => {
      if (!busca.trim()) { setSugerencias([]); return; }
      api.get<UserSummary[]>(`/v1/users/search?q=${encodeURIComponent(busca.trim())}`, token)
        .then((all) => setSugerencias(all.filter((u) => !usuarios.includes(u.username))))
        .catch(() => setSugerencias([]));
    }, 200);
    return () => clearTimeout(t);
  }, [busca, token, usuarios]);

  async function publicar() {
    const body = { contenido, icono, prioridad, destino, usuarios: destino === "personas" ? usuarios : [] };
    await api.post<AvisoInfo>("/v1/admin/avisos", body, token);
    setContenido(DOC_VACIO);
    setUsuarios([]);
    void cargar();
  }

  async function borrar(id: number) {
    await api.del(`/v1/avisos/${id}`, token);
    void cargar();
  }

  return (
    <Seccion titulo="Notificaciones" grupo="Operación">
      <p className="text-[11px] text-muted">Avisos escritos por ti para quien esté conectado.</p>

      <div className="mt-4">
        <AvisoEditor contenido={contenido} onChange={setContenido} />

        <div className="mt-2.5 flex flex-wrap items-center gap-4 rounded-card border border-border bg-panel p-3">
          <div className="flex items-center gap-1.5">
            <span className="text-[9px] uppercase tracking-[.06em] text-muted">Icono</span>
            {ICONOS.map((i) => (
              <button key={i} onClick={() => setIcono(i)}
                className={`grid h-6 w-6 place-items-center rounded-md border ${
                  icono === i ? "border-white/35 bg-white/[.07] text-fg" : "border-border text-muted"}`}>
                <Icon name={i} size={12} />
              </button>
            ))}
          </div>
          <div className="flex overflow-hidden rounded-lg border border-border">
            <button onClick={() => setPrioridad("normal")}
              className={`px-2.5 py-1 text-[10px] ${
                prioridad === "normal" ? "bg-draw/[.15] text-draw-fg" : "bg-elevated text-muted"}`}>Normal</button>
            <button onClick={() => setPrioridad("urgente")}
              className={`px-2.5 py-1 text-[10px] ${
                prioridad === "urgente" ? "bg-danger/[.18] text-danger-fg" : "bg-elevated text-muted"}`}>Urgente</button>
          </div>
        </div>

        <div className="mt-2.5 rounded-card border border-border bg-panel p-3">
          <div className="mb-2 flex gap-1.5">
            {(["todos", "admins", "personas"] as const).map((d) => (
              <button key={d} onClick={() => setDestino(d)}
                className={`rounded-lg border px-2.5 py-1 text-[10px] ${
                  destino === d ? "border-white/35 bg-white/[.07] text-fg" : "border-border text-muted"}`}>
                {d === "todos" ? "Todos" : d === "admins" ? "Administradores" : "Personas concretas"}
              </button>
            ))}
          </div>
          {destino === "personas" && (
            <div className="relative">
              <div className="mb-1.5 flex flex-wrap gap-1.5">
                {usuarios.map((u) => (
                  <span key={u} className="flex items-center gap-1.5 rounded-full border border-border
                    bg-elevated py-1 pl-2.5 pr-1 text-[10.5px] text-fg">
                    {u}
                    <button onClick={() => setUsuarios((us) => us.filter((x) => x !== u))}
                      className="text-subtle hover:text-danger-fg"><Icon name="x" size={9} /></button>
                  </span>
                ))}
              </div>
              <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="buscar usuario…"
                className="w-full rounded-lg border border-border bg-elevated px-2.5 py-1.5 text-[11px]
                  text-fg outline-none focus:border-white/40" />
              {sugerencias.length > 0 && (
                <div className="absolute inset-x-0 top-[calc(100%+4px)] z-10 max-h-[150px] overflow-y-auto
                  rounded-lg border border-white/10 bg-[rgba(20,22,26,.98)] p-1 shadow-lg shadow-black/50">
                  {sugerencias.map((u) => (
                    <button key={u.id}
                      onMouseDown={() => { setUsuarios((us) => [...us, u.username]); setBusca(""); setSugerencias([]); }}
                      className="flex w-full items-center gap-2 rounded-md p-1.5 text-left text-[11px]
                        text-fg hover:bg-white/[.05]">{u.username}</button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="mt-2.5 flex items-center gap-3">
          <p className="text-[9.5px] text-subtle">Llega a quien corresponda en cuanto se publica, sin recargar.</p>
          <button onClick={() => void publicar()}
            className="ml-auto rounded-lg bg-accent px-3 py-1.5 text-[11px] font-medium text-black">Publicar</button>
        </div>
      </div>

      <h3 className="mb-1.5 mt-6 text-[12.5px] font-medium">Avisos activos</h3>
      <div className="rounded-card border border-border bg-panel">
        {(avisos ?? []).length === 0 && <p className="p-6 text-center text-[11px] text-subtle">Sin avisos.</p>}
        {(avisos ?? []).map((a) => (
          <div key={a.id} className={`flex items-start gap-3 border-b border-border p-[12px_16px] last:border-b-0 ${
            a.prioridad === "urgente" ? "bg-danger/[.04]" : ""}`}>
            <span className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full ${
              a.prioridad === "urgente" ? "bg-danger/[.15] text-danger-fg" : "bg-draw/[.12] text-draw-fg"}`}>
              <Icon name={a.icono as IconName} size={12} />
            </span>
            <div className="min-w-0 flex-1">
              <AvisoEditor contenido={a.contenido} editable={false} />
              <p className="mt-1.5 flex items-center gap-2 text-[10px] text-subtle">
                {a.creado_por} · hace {ago(a.created_at)}
                {a.prioridad === "urgente" && (
                  <span className="rounded bg-danger/[.18] px-1.5 py-px text-[8.5px] uppercase text-danger-fg">urgente</span>
                )}
                <span className="rounded border border-border bg-elevated px-1.5 py-px text-[8.5px] text-subtle">{a.destino}</span>
              </p>
            </div>
            <button onClick={() => void borrar(a.id)}
              className="shrink-0 rounded-lg border border-danger/40 px-2.5 py-1 text-[9.5px] text-danger-fg">Eliminar</button>
          </div>
        ))}
      </div>
    </Seccion>
  );
}
```

- [ ] **Step 2: Conectarla en `AdminPanel.tsx`**

En `client/src/admin/AdminPanel.tsx`, cambia el import de `Hueco`:

```tsx
import { Hueco } from "./Hueco";
```

Añade justo debajo:

```tsx
import { NotificacionesView } from "./NotificacionesView";
```

Cambia:

```tsx
const PRONTO: Seccion[] = ["notificaciones", "hardware"];
```

por:

```tsx
const PRONTO: Seccion[] = ["hardware"];
```

Y añade una rama antes de la rama por defecto de índices (justo después de la rama `"cola"`):

```tsx
          : seccion === "cola" ? <Seccion titulo="Cola" grupo="Operación">
              <QueueRow token={token} /></Seccion>
          : seccion === "notificaciones" ? <NotificacionesView token={token} />
                    : <Seccion titulo="Índices instalados" grupo="Servidor"
```

(Reemplaza el `: seccion === "cola" ? ... : <Seccion titulo="Índices instalados" ...` existente
por el bloque de tres líneas de arriba — el resto de esa rama de índices sigue igual, solo se
inserta la nueva rama en medio.)

- [ ] **Step 3: Quitar la entrada de `Hueco.tsx`**

En `client/src/admin/Hueco.tsx`, encuentra:

```tsx
  notificaciones: {
    titulo: "Notificaciones", grupo: "Operación", ciclo: "ciclo 3c",
    que: "Avisos escritos por el administrador para quien esté conectado.",
  },
  hardware: {
```

Reemplaza por (quita solo la entrada `notificaciones`):

```tsx
  hardware: {
```

- [ ] **Step 4: Verificar que typechecka**

Run:
```bash
cd client && npx tsc -b
```
Expected: sin errores.

- [ ] **Step 5: Verificar visualmente**

```bash
cd client && npm run tauri dev
```
Como administrador: abre Notificaciones, escribe un aviso con negrita y un emoji, elige icono
`wrench` y prioridad `urgente`, destino "Personas concretas" con tu propio usuario añadido, y
publica. Debe aparecer en la lista de abajo al instante (recarga tras publicar), con el tinte
rojo de urgente y las etiquetas correctas. Bórralo y confirma que desaparece.

- [ ] **Step 6: Commit**

```bash
git add client/src/admin/NotificacionesView.tsx client/src/admin/AdminPanel.tsx client/src/admin/Hueco.tsx
git commit -m "feat: pantalla Notificaciones (componer, iconos, prioridad, destinatarios)"
```

---

### Task 8: Campana — nuevo tipo de item `aviso`

**Files:**
- Modify: `client/src/ui/NotificationsPopover.tsx` (reescritura completa)

**Interfaces:**
- Consumes: `useServer(s => s.sample?.avisos)` (Task 2/5, ya fluyendo por telemetría),
  `AvisoEditor` (Task 6, en modo lectura).
- Produces: sin cambio de firma — `<NotificationsPopover onOpenAdmin onProjectAccepted />` sigue
  igual, ya montada en `TitleBar.tsx`.

- [ ] **Step 1: Reemplazar el fichero entero**

Create (sobrescribiendo) `client/src/ui/NotificationsPopover.tsx`:

```tsx
import { useEffect, useState } from "react";
import { api, type AdminRequest, type Invite } from "../lib/api";
import { useServer } from "../lib/store";
import { AvisoEditor } from "../admin/AvisoEditor";
import { Avatar } from "./Avatar";
import { Icon, type IconName } from "./Icon";
import { usePopover } from "./TitleBar";

function ago(ts: number): string {
  const s = Math.max(0, Math.floor(Date.now() / 1000) - ts);
  if (s < 60) return "ahora";
  if (s < 3600) return `${Math.floor(s / 60)} min`;
  if (s < 86400) return `${Math.floor(s / 3600)} h`;
  return `${Math.floor(s / 86400)} d`;
}

interface ItemBase { id: number; who: string; at: number }
/** `kind` decide el icono y qué botones salen: una invitación se acepta,
 *  una solicitud se aprueba, un aviso solo se lee — no hay nada que
 *  decidir, así que no lleva fila de acciones. */
type Item =
  | (ItemBase & { kind: "invite"; text: string })
  | (ItemBase & { kind: "access"; text: string })
  | (ItemBase & { kind: "aviso"; contenido: unknown; icono: IconName; prioridad: "normal" | "urgente" });

/** La campana no es un atajo al panel de administración: es la bandeja de todo
 *  lo que te espera. Para cualquiera, las invitaciones a proyectos y los
 *  avisos del administrador; para el administrador, además, las solicitudes
 *  de cuenta. Los avisos no vienen de una petición propia — ya llegan por la
 *  misma telemetría que alimenta la tira de mantenimiento, filtrados por el
 *  propio servidor a lo que le toca ver a esta sesión.
 *
 *  Filas, no tarjetas: cuatro tarjetas con borde propio en 300 px de ancho son
 *  cuatro cajas compitiendo. Lo no leído se marca con un punto en el margen y
 *  no con un fondo de color — cuatro fondos distintos harían un semáforo. */
export function NotificationsPopover({ onOpenAdmin, onProjectAccepted }: {
  onOpenAdmin: () => void;
  /** Aceptar una invitación cambia la lista de proyectos de otro componente,
   *  que no se entera por su cuenta. */
  onProjectAccepted?: () => void;
}) {
  const token = useServer((s) => s.token) ?? undefined;
  const isAdmin = useServer((s) => s.isAdmin);
  const sampleAvisos = useServer((s) => s.sample?.avisos ?? []);
  const [items, setItems] = useState<Item[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [leido, setLeido] = useState<Set<string>>(new Set());
  const [open, setOpen, box] = usePopover();

  async function load() {
    const out: Item[] = [];
    // Cada fuente en su propio try: que el administrador no pueda leer una lista
    // no es motivo para dejarle sin la otra.
    try {
      const invites = await api.get<Invite[]>("/v1/me/invites", token);
      invites.forEach((i) => out.push({
        kind: "invite", id: i.project_id, who: i.invited_by,
        text: `te invitó a «${i.project_name}»`, at: i.added_at,
      }));
    } catch { /* sin invitaciones legibles */ }
    if (isAdmin) {
      try {
        const reqs = await api.get<AdminRequest[]>("/v1/admin/access-requests", token);
        reqs.filter((r) => r.status === "pending").forEach((r) => out.push({
          kind: "access", id: r.id, who: r.display_name,
          text: "pide una cuenta", at: r.created_at,
        }));
      } catch { /* idem */ }
    }
    out.sort((a, b) => b.at - a.at);
    setItems(out);
  }

  useEffect(() => {
    void load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [isAdmin, token]);

  const key = (i: Item) => `${i.kind}:${i.id}`;

  async function resolver(i: Item, si: boolean) {
    if (i.kind === "aviso") return;
    setBusy(key(i));
    try {
      if (i.kind === "invite") {
        await api.post(`/v1/invites/${i.id}/${si ? "accept" : "decline"}`, {}, token);
        // El selector de proyectos ya está montado desde antes de que esto
        // pase y solo carga su lista una vez: sin avisarle, el proyecto
        // nuevo no aparecía hasta salir a un proyecto y volver, que es lo
        // único que lo remonta.
        if (si) onProjectAccepted?.();
      } else {
        await api.post(`/v1/admin/access-requests/${i.id}/resolve`,
          { approve: si, granted_models: si ? ["mini"] : undefined }, token);
      }
      await load();
    } finally {
      setBusy(null);
    }
  }

  const avisoItems: Item[] = sampleAvisos.map((a) => ({
    kind: "aviso", id: a.id, who: a.creado_por, at: a.created_at,
    contenido: a.contenido, icono: a.icono as IconName, prioridad: a.prioridad,
  }));
  // Los avisos urgentes van primero (el servidor ya los ordena así dentro de
  // sí mismos); el resto, invitaciones/solicitudes/avisos normales, por
  // fecha — mismo criterio que la lista de gestión de Notificaciones.
  const todos = [...avisoItems, ...(items ?? [])].sort((a, b) => {
    const au = a.kind === "aviso" && a.prioridad === "urgente";
    const bu = b.kind === "aviso" && b.prioridad === "urgente";
    if (au !== bu) return au ? -1 : 1;
    return b.at - a.at;
  });

  const pendientes = todos.filter((i) => !leido.has(key(i))).length;

  return (
    <div ref={box} className="relative">
      <button onClick={() => setOpen(!open)} aria-label="Notificaciones"
        className="relative grid h-[26px] w-[26px] place-items-center rounded-[7px] text-subtle
          transition-colors duration-300 ease-expo hover:bg-white/[.05] hover:text-fg">
        <Icon name="bell" size={14} />
        {pendientes > 0 && (
          <span className="absolute right-[3px] top-[3px] h-[6px] w-[6px] rounded-full bg-draw-fg"
            style={{ animation: "jg-core-pulse 1.8s ease-in-out infinite" }} />
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-[30px] z-[70] w-[308px] overflow-hidden rounded-[11px]
          border border-white/[.12] bg-[rgba(20,22,26,.97)] shadow-lg shadow-black/50 backdrop-blur-xl"
          style={{ animation: "jg-popup-scale-in 180ms cubic-bezier(.2,.85,.35,1) both" }}>

          <div className="flex items-center gap-2 border-b border-border px-[11px] py-2.5">
            <span className="flex-1 text-[11.5px] text-fg">Notificaciones</span>
            {pendientes > 0 && (
              <button onClick={() => setLeido(new Set(todos.map(key)))}
                className="text-[10.5px] text-subtle transition-colors hover:text-fg">
                Marcar todas
              </button>
            )}
          </div>

          <div className="max-h-[290px] overflow-y-auto p-1">
            {items === null && <p className="py-5 text-center text-[11px] text-subtle">cargando</p>}
            {items !== null && todos.length === 0 && (
              <p className="py-5 text-center text-[11px] text-subtle">nada que atender</p>
            )}

            {todos.map((i) => {
              const k = key(i);
              return (
                <div key={k}
                  className={`relative flex gap-[9px] rounded-[9px] py-2 pl-3 pr-[9px]
                    transition-colors duration-300 hover:bg-white/[.04] ${
                    i.kind === "aviso" && i.prioridad === "urgente" ? "bg-danger/[.06]" : ""}`}>
                  {!leido.has(k) && (
                    <span className="absolute left-1 top-[15px] h-[4px] w-[4px] rounded-full bg-draw" />
                  )}
                  {i.kind === "invite" ? (
                    <Avatar name={i.who} size={22} />
                  ) : i.kind === "access" ? (
                    <span className="grid h-[22px] w-[22px] shrink-0 place-items-center rounded-full
                      bg-warning/[.12] text-warning-fg">
                      <Icon name="shield" size={12} />
                    </span>
                  ) : (
                    <span className={`grid h-[22px] w-[22px] shrink-0 place-items-center rounded-full ${
                      i.prioridad === "urgente" ? "bg-danger/[.15] text-danger-fg" : "bg-draw/[.12] text-draw-fg"}`}>
                      <Icon name={i.icono} size={12} />
                    </span>
                  )}

                  <div className="min-w-0 flex-1">
                    {i.kind === "aviso" ? (
                      <div className="text-[11.5px] leading-snug text-muted">
                        <b className="font-medium text-fg">{i.who}</b>{" "}
                        <AvisoEditor contenido={i.contenido} editable={false} />
                      </div>
                    ) : (
                      <p className="text-[11.5px] leading-snug text-muted">
                        <b className="font-medium text-fg">{i.who}</b> {i.text}
                      </p>
                    )}
                    {i.kind !== "aviso" && (
                      <div className="mt-[7px] flex gap-1.5">
                        <button disabled={busy === k} onClick={() => void resolver(i, true)}
                          className="jg-press rounded-md bg-accent px-2.5 py-1 text-[10.5px] font-medium
                            text-black disabled:opacity-40">
                          {i.kind === "invite" ? "Aceptar" : "Aprobar"}
                        </button>
                        <button disabled={busy === k} onClick={() => void resolver(i, false)}
                          className="jg-press rounded-md border border-white/15 px-2.5 py-[3px]
                            text-[10.5px] text-fg disabled:opacity-40">
                          Rechazar
                        </button>
                      </div>
                    )}
                  </div>

                  <span className="shrink-0 pt-0.5 font-mono text-[9.5px] text-[#4a4d52]">{ago(i.at)}</span>
                </div>
              );
            })}
          </div>

          {isAdmin && (
            <div className="border-t border-border p-2 text-center">
              <button onClick={() => { setOpen(false); onOpenAdmin(); }}
                className="text-[10.5px] text-subtle transition-colors hover:text-fg">
                Ver todo en Administración
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verificar que typechecka**

Run:
```bash
cd client && npx tsc -b
```
Expected: sin errores.

- [ ] **Step 3: Verificar visualmente**

```bash
cd client && npm run tauri dev
```
Publica un aviso dirigido a "Todos" desde Notificaciones (Task 7); abre la campana desde
cualquier otra pantalla (proyecto, selector) y confirma que aparece sin recargar, sin fila de
Aceptar/Rechazar, con su icono y su color de prioridad. Publica uno urgente y confirma que sube
al principio de la lista, por delante de invitaciones más recientes.

- [ ] **Step 4: Commit**

```bash
git add client/src/ui/NotificationsPopover.tsx
git commit -m "feat: la campana muestra avisos del administrador, sin accion que tomar"
```

---

### Task 9: Documentación

**Files:**
- Modify: `FUTURO.md`

- [ ] **Step 1: Quitar "las notificaciones redactadas por el admin" de la lista de pendientes**

Busca, bajo "### Panel de administración real":

```
Es el subsistema 3 y está planificado, no aparcado. Se anota aquí solo lo que se le ha ido
prometiendo por el camino: rediseñar desde cero las vistas provisionales de solicitudes y
usuarios del subsistema 2, la fila de configuración del mapa del subsistema 6, las
notificaciones redactadas por el admin
```

Reemplaza por (quita solo la cláusula ya hecha):

```
Es el subsistema 3 y está planificado, no aparcado. Se anota aquí solo lo que se le ha ido
prometiendo por el camino: rediseñar desde cero las vistas provisionales de solicitudes y
usuarios del subsistema 2, la fila de configuración del mapa del subsistema 6
```

- [ ] **Step 2: Commit**

```bash
git add FUTURO.md
git commit -m "docs: notificaciones implementadas, quita la clausula de FUTURO.md"
```

---

## Self-Review Notes

- **Cobertura de la spec:** esquema (Task 1), tipos + `Sample.avisos` (Task 2), rutas
  crear/listar/borrar (Task 3), telemetría consciente del destinatario — el cambio de
  arquitectura central de la spec (Task 4), dependencia de Tiptap + tipos cliente (Task 5),
  editor con negrita/cursiva/color/fuente/emoji en un componente reusado para escribir y leer
  (Task 6), icono personalizable + prioridad + destino (todos/admins/personas con buscador de
  usuarios) en la pantalla de gestión (Task 7), integración en la campana sin fila de acciones y
  con orden urgente-primero (Task 8), limpieza de `FUTURO.md` (Task 9). Todo cubierto.
- **Sin placeholders:** cada paso de código trae el fichero completo o el diff exacto — incluidos
  los tres ficheros reescritos enteros (`NotificationsPopover.tsx` en Task 8, análogo a como se
  reescribió `SecurityView.tsx` en el plan de mantenimiento).
- **Consistencia de tipos:** `AvisoInfo`/`CrearAvisoReq` tienen los mismos campos y nombres en
  `lumi-proto` (Task 2), `routes/avisos.rs` (Task 3), y el espejo TypeScript (Task 5); `prioridad`
  (`"normal"`/`"urgente"`) y `destino` (`"todos"`/`"admins"`/`"personas"`) se usan como los mismos
  literales en el esquema SQL, el filtro de `telemetry::avisos_para` (Task 4), y la UI de
  `NotificacionesView.tsx`/`NotificationsPopover.tsx` (Tasks 7-8) — si un valor no coincide entre
  ellos, el filtrado o el tinte de color de esa fila dejarían de funcionar en silencio.
