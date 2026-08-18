# Configuración de red del servidor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** dar al administrador control sobre el puerto/host/dominio público del
servidor (para NAT, port-forwarding, proxy TCP transparente o dominio en vez
de IP), resolver qué pasa con clientes que ya tenían la dirección vieja
guardada cuando cambia, y añadir un listener QUIC/HTTP3 opcional del lado
servidor.

**Architecture:** cinco escalares nuevos en la tabla `meta` de `lumid`
(mismo patrón que `mantenimiento.rs`), un nuevo endpoint admin
`/v1/admin/network`, un botón de reinicio que difunde el cambio de dirección
por el canal SSE ya existente antes de reiniciar el proceso, y un listener
QUIC adicional (usando `quinn`+`h3`) que sirve únicamente `/v1/hello` — el
resto de rutas se queda en TCP+TLS porque `reqwest` (cliente del lado
`client/src-tauri`) no tiene soporte HTTP/3 estable hoy.

**Tech Stack:** Rust (axum, rusqlite, quinn, h3, h3-quinn, rustls-pemfile),
React/TypeScript (Tauri v2), mismo patrón `Cambio`/SSE ya usado por
`Invitacion`.

## Global Constraints

- **Spec de referencia:** `docs/superpowers/specs/2026-08-18-config-red-design.md`.
- **No hay verde** en ningún control nuevo (DESIGN.md). Los estados de
  capacidad usan blanco/ámbar/gris, igual que el resto del panel.
- **No tests salvo en `lumi-proto`** (convención del proyecto). El único test
  nuevo de este plan vive en `lumi-proto`.
- **Un commit por tarea terminada.**
- `LUMI_PORT` (env) sigue ganando sobre cualquier ajuste guardado — es la vía
  de recuperación ya usada esta sesión para depurar el freeze del daemon.
- El botón "Reiniciar ahora" se bloquea si
  `SELECT COUNT(*) FROM analyses WHERE state = 'en_curso'` > 0.
- Mono font para IPs/puertos/huellas (DESIGN.md) — reutilizar `font-mono`
  como en el resto del panel.

---

### Task 1: Escalares de red en `lumid` (lectura/escritura + helper de dirección efectiva)

**Files:**
- Create: `crates/lumid/src/red.rs`
- Modify: `crates/lumid/src/main.rs:1-20` (añadir `mod red;`)

**Interfaces:**
- Produce: `red::Settings { bind_port: u16, public_host: Option<String>, public_port: Option<u16>, quic_enabled: bool, quic_port: u16 }`,
  `red::leer(store: &store::Store) -> Settings`,
  `red::guardar(store: &store::Store, s: &Settings) -> anyhow::Result<()>`,
  `red::direccion_publica(store: &store::Store) -> String` (host:puerto a
  incrustar en claves/tarjetas nuevas — usada por la Task 5 en `lumi-cli`,
  que hace su propia consulta SQL directa porque es un binario aparte, no
  llama a esta función).

- [ ] **Step 1: Escribir `crates/lumid/src/red.rs`**

```rust
//! Ajustes de red configurables: puerto de escucha, host/puerto públicos (para
//! NAT/port-forwarding/proxy TCP transparente) y el listener QUIC opcional.
//! Mismo patrón que `mantenimiento.rs`: escalares sueltos en la tabla `meta`,
//! sin tabla propia — son cinco valores, no un dominio con su propio ciclo de
//! vida.

use crate::store::Store;
use serde::{Deserialize, Serialize};

pub const DEFAULT_BIND_PORT: u16 = lumi_proto::PORT;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Settings {
    pub bind_port: u16,
    /// `None` = usar la IP LAN autodetectada, como hoy.
    pub public_host: Option<String>,
    /// `None` = igual que `bind_port`.
    pub public_port: Option<u16>,
    pub quic_enabled: bool,
    pub quic_port: u16,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            bind_port: DEFAULT_BIND_PORT,
            public_host: None,
            public_port: None,
            quic_enabled: false,
            quic_port: DEFAULT_BIND_PORT,
        }
    }
}

pub fn leer(store: &Store) -> Settings {
    let d = Settings::default();
    Settings {
        bind_port: store.get_meta("red_bind_port").and_then(|v| v.parse().ok()).unwrap_or(d.bind_port),
        public_host: store.get_meta("red_public_host").filter(|v| !v.is_empty()),
        public_port: store.get_meta("red_public_port").and_then(|v| v.parse().ok()),
        quic_enabled: store.get_meta("red_quic_enabled").as_deref() == Some("1"),
        quic_port: store.get_meta("red_quic_port").and_then(|v| v.parse().ok()).unwrap_or(d.quic_port),
    }
}

pub fn guardar(store: &Store, s: &Settings) -> anyhow::Result<()> {
    store.set_meta("red_bind_port", &s.bind_port.to_string())?;
    store.set_meta("red_public_host", s.public_host.as_deref().unwrap_or(""))?;
    store.set_meta(
        "red_public_port",
        &s.public_port.map(|p| p.to_string()).unwrap_or_default(),
    )?;
    store.set_meta("red_quic_enabled", if s.quic_enabled { "1" } else { "0" })?;
    store.set_meta("red_quic_port", &s.quic_port.to_string())?;
    Ok(())
}

/// El `host:puerto` que se incrusta en claves/tarjetas nuevas. Si no hay
/// `public_host` guardado, cae a la IP LAN autodetectada — mismo cálculo que
/// ya hacía `lumi-cli` antes de que existiera este ajuste.
pub fn direccion_publica(store: &Store) -> String {
    let s = leer(store);
    let host = s.public_host.unwrap_or_else(|| local_ip().unwrap_or_else(|| "127.0.0.1".into()));
    let port = s.public_port.unwrap_or(s.bind_port);
    format!("{host}:{port}")
}

/// Duplica la lógica de `lumi-cli::install::local_ip` a propósito: son
/// binarios distintos que no se enlazan entre sí, y es una única llamada al
/// sistema, no una abstracción que merezca su propio crate compartido.
fn local_ip() -> Option<String> {
    use std::net::UdpSocket;
    let sock = UdpSocket::bind("0.0.0.0:0").ok()?;
    sock.connect("8.8.8.8:80").ok()?;
    sock.local_addr().ok().map(|a| a.ip().to_string())
}
```

- [ ] **Step 2: Registrar el módulo en `main.rs`**

En `crates/lumid/src/main.rs`, junto al resto de `mod` (línea 15, tras `mod
queue;`):

```rust
mod queue;
mod recuperar;
mod red;
mod routes;
```

- [ ] **Step 3: Compilar**

Run: `cargo build -p lumid`
Expected: compila sin errores (nadie llama a `red::` todavía, así que no hay
warnings de "no usado" — `pub` en un binario silencia ese lint).

- [ ] **Step 4: Commit**

```bash
git add crates/lumid/src/red.rs crates/lumid/src/main.rs
git commit -m "feat: escalares de configuración de red en lumid (aún sin exponer)"
```

---

### Task 2: Puerto de bind resuelto desde `meta`, con `LUMI_PORT` como override

**Files:**
- Modify: `crates/lumid/src/main.rs:226-231`

**Interfaces:**
- Consume: `red::leer` (Task 1).

- [ ] **Step 1: Cambiar la resolución del puerto**

En `crates/lumid/src/main.rs`, sustituir:

```rust
    let port: u16 = std::env::var("LUMI_PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(lumi_proto::PORT);
```

por:

```rust
    // LUMI_PORT (env) es la escotilla de emergencia: gana siempre sobre lo
    // guardado en `meta`, igual que ya ganaba sobre la constante fija antes
    // de que existiera un ajuste editable desde el panel.
    let port: u16 = std::env::var("LUMI_PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or_else(|| red::leer(&app.store).bind_port);
```

Esta línea vive DESPUÉS de que `app` ya exista (la construcción de `App` está
unas líneas antes, en torno a la línea 80) — si al editar el fichero la
línea del puerto queda antes de `let app = App { ... };`, muévela a justo
después de esa construcción, antes de `let addr = SocketAddr::from(...)`.

- [ ] **Step 2: Compilar y arrancar en local para comprobar el valor por defecto**

Run: `cargo build -p lumid`
Expected: compila.

Run (con una carpeta `LUMI_DATA` de prueba vacía, para no tocar datos reales):
```bash
mkdir -p /tmp/lumi-test-red && LUMI_DATA=/tmp/lumi-test-red cargo run -p lumid &
sleep 2
curl -sk https://127.0.0.1:7717/v1/hello | head -c 80
kill %1
```
Expected: responde JSON (arrancó en 7717, el valor por defecto, porque `meta`
está vacía en una carpeta nueva).

- [ ] **Step 3: Commit**

```bash
git add crates/lumid/src/main.rs
git commit -m "feat: el puerto de escucha de lumid se lee de meta, con LUMI_PORT como override"
```

---

### Task 3: `Cambio::Red` en `lumi-proto` y difusión antes de reiniciar

**Files:**
- Modify: `crates/lumi-proto/src/api.rs:765-802`

**Interfaces:**
- Produce: variante `Cambio::Red { user_id, nuevo_addr }`, usada por Task 4.

- [ ] **Step 1: Añadir la variante**

En `crates/lumi-proto/src/api.rs`, dentro de `pub enum Cambio` (tras
`Invitacion { ... },`, antes del `}` que cierra el enum en la línea 792):

```rust
    /// Aviso de que el servidor va a cambiar de dirección (puerto/host
    /// público), emitido justo ANTES de reiniciar el proceso — mientras el
    /// daemon todavía es alcanzable en la dirección vieja — para que quien
    /// esté conectado en ese momento actualice su dirección guardada sin
    /// tener que pedir una tarjeta nueva. Quien esté desconectado en ese
    /// instante no recibe esto: para ese caso la recuperación es pedir una
    /// tarjeta de servidor nueva, ver `AddServerForm`.
    Red {
        #[serde(skip)]
        user_id: i64,
        nuevo_addr: String,
    },
```

Y en `impl Cambio { pub fn user_id(&self) -> i64 { match self { ... } } }`
(línea ~795), añadir la rama:

```rust
    pub fn user_id(&self) -> i64 {
        match self {
            Cambio::Estado { user_id, .. }
            | Cambio::Progreso { user_id, .. }
            | Cambio::Invitacion { user_id, .. }
            | Cambio::Red { user_id, .. } => *user_id,
        }
    }
```

- [ ] **Step 2: Compilar**

Run: `cargo build -p lumi-proto`
Expected: compila. (El resto del workspace que hace `match` exhaustivo sobre
`Cambio` en Rust — solo `impl Cambio` lo hace hoy — así que no hay más sitios
que tocar.)

- [ ] **Step 3: Commit**

```bash
git add crates/lumi-proto/src/api.rs
git commit -m "feat: Cambio::Red para avisar de un cambio de dirección antes de reiniciar"
```

---

### Task 4: Endpoint `/v1/admin/network` (leer/guardar/reiniciar)

**Files:**
- Create: `crates/lumid/src/routes/network.rs`
- Modify: `crates/lumid/src/routes/mod.rs` (añadir `pub mod network;`)
- Modify: `crates/lumid/src/main.rs` (registrar tres rutas)

**Interfaces:**
- Consume: `red::Settings`, `red::leer`, `red::guardar`, `red::direccion_publica`
  (Task 1); `queue.difundir(Cambio::Red { .. })` (`crates/lumid/src/queue/mod.rs:266`);
  `require_admin`, `bearer` (`crates/lumid/src/routes/auth.rs`).
- Produce: `GET /v1/admin/network` → `{ settings: Settings, server_card: String,
  restart_blocked_reason: Option<String> }`; `PATCH /v1/admin/network` (body:
  `Settings`) → mismo shape; `POST /v1/admin/network/restart` → `204` o `409`
  con el motivo si hay trabajo en curso.

- [ ] **Step 1: Escribir `crates/lumid/src/routes/network.rs`**

```rust
//! Ajustes de red del panel: puerto de escucha, host/puerto públicos y el
//! interruptor de QUIC. Reiniciar es la única acción con efectos de verdad:
//! el resto son lecturas/escrituras normales sobre `meta`.

use crate::routes::auth::{bearer, require_admin};
use crate::{red, App};
use axum::{extract::State, http::HeaderMap, http::StatusCode, Json};
use lumi_proto::key::ServerCard;
use serde::Serialize;
use std::time::Duration;

#[derive(Serialize)]
pub struct NetworkView {
    settings: red::Settings,
    server_card: String,
    /// `Some(motivo)` si "Reiniciar ahora" debe salir deshabilitado.
    restart_blocked_reason: Option<String>,
}

fn tarjeta(app: &App) -> String {
    let der = std::fs::read(app.dir.join("cert.der")).unwrap_or_default();
    ServerCard::new(&red::direccion_publica(&app.store), &der).to_string()
}

fn motivo_bloqueo(app: &App) -> Option<String> {
    let en_curso: i64 = app
        .store
        .conn()
        .query_row("SELECT COUNT(*) FROM analyses WHERE state = 'en_curso'", [], |r| r.get(0))
        .unwrap_or(0);
    if en_curso > 0 {
        Some(format!(
            "hay {en_curso} análisis en curso; reiniciar ahora los cortaría a medias"
        ))
    } else {
        None
    }
}

pub async fn get(State(app): State<App>, headers: HeaderMap) -> Result<Json<NetworkView>, StatusCode> {
    require_admin(&app, &bearer(&headers))?;
    Ok(Json(NetworkView {
        settings: red::leer(&app.store),
        server_card: tarjeta(&app),
        restart_blocked_reason: motivo_bloqueo(&app),
    }))
}

pub async fn patch(
    State(app): State<App>,
    headers: HeaderMap,
    Json(s): Json<red::Settings>,
) -> Result<Json<NetworkView>, (StatusCode, String)> {
    require_admin(&app, &bearer(&headers)).map_err(|c| (c, "hace falta ser administrador".to_string()))?;
    red::guardar(&app.store, &s).map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(NetworkView {
        settings: red::leer(&app.store),
        server_card: tarjeta(&app),
        restart_blocked_reason: motivo_bloqueo(&app),
    }))
}

/// Espera antes de reiniciar de verdad, para dar tiempo a que el aviso por
/// SSE llegue a cualquier sesión conectada mientras el daemon todavía
/// responde en la dirección vieja.
const AVISO_ANTES_DE_REINICIAR: Duration = Duration::from_secs(5);

pub async fn restart(State(app): State<App>, headers: HeaderMap) -> Result<StatusCode, (StatusCode, String)> {
    require_admin(&app, &bearer(&headers)).map_err(|c| (c, "hace falta ser administrador".to_string()))?;
    if let Some(motivo) = motivo_bloqueo(&app) {
        return Err((StatusCode::CONFLICT, motivo));
    }
    let nuevo_addr = red::direccion_publica(&app.store);
    // Difunde a TODAS las sesiones conectadas (el filtro por user_id lo hace
    // cada handler de SSE en `routes::queue::events`, no aquí).
    app.queue.difundir(lumi_proto::api::Cambio::Red { user_id: 0, nuevo_addr });
    tokio::spawn(async move {
        tokio::time::sleep(AVISO_ANTES_DE_REINICIAR).await;
        // Salida con código distinto de cero A PROPÓSITO: la unit de systemd
        // usa `Restart=on-failure`, así que un `exit(0)` no relanzaría el
        // proceso. Esto no es un fallo real, es la única palanca que
        // systemd entiende como "vuelve a arrancarme".
        std::process::exit(1);
    });
    Ok(StatusCode::NO_CONTENT)
}
```

- [ ] **Step 2: Registrar el módulo de rutas**

En `crates/lumid/src/routes/mod.rs`, añadir la línea `pub mod network;` junto
al resto de `pub mod` (alfabético o al final, siguiendo lo que ya haya en el
fichero).

- [ ] **Step 3: Registrar las rutas en `main.rs`**

En `crates/lumid/src/main.rs`, junto a las rutas de admin ya existentes
(cerca de la línea 138, tras `.route("/v1/admin/resumen", ...)`):

```rust
        .route(
            "/v1/admin/network",
            get(routes::network::get).patch(routes::network::patch),
        )
        .route("/v1/admin/network/restart", post(routes::network::restart))
```

- [ ] **Step 4: Compilar**

Run: `cargo build -p lumid -p lumi-proto`
Expected: compila. `Cambio::Red { user_id: 0, .. }` es válido porque
`#[serde(skip)]` no exige que el valor tenga sentido de negocio — aquí es un
broadcast a todo el mundo, no filtrado por usuario, así que `0` es un valor
sin uso real, solo para satisfacer el tipo.

- [ ] **Step 5: Probar a mano**

Run (con el daemon de la Task 2 arrancado, y una sesión de admin ya creada —
usa el flujo normal de `/v1/claim` + `/v1/admin` si la carpeta es nueva):
```bash
curl -sk https://127.0.0.1:7717/v1/admin/network -H "Authorization: Bearer $TOKEN"
```
Expected: JSON con `settings.bind_port == 7717`, `server_card` empezando por
`lumi1s_`, `restart_blocked_reason: null`.

- [ ] **Step 6: Commit**

```bash
git add crates/lumid/src/routes/network.rs crates/lumid/src/routes/mod.rs crates/lumid/src/main.rs
git commit -m "feat: endpoint /v1/admin/network (leer, guardar, reiniciar)"
```

---

### Task 5: `lumi-cli` lee `red_public_host`/`red_public_port` al emitir claves/tarjetas

**Files:**
- Modify: `crates/lumi-cli/src/install.rs:223-224` (función `run`)
- Modify: `crates/lumi-cli/src/install.rs:542-549` (función `reissue`)
- Modify: `crates/lumi-cli/src/admin.rs:21-24` (función `card`)

**Interfaces:**
- Consume: tabla `meta` de `lumi.db` (consulta SQL directa — `lumi-cli` no
  enlaza con `lumid`, así que no puede llamar a `red::direccion_publica`;
  duplica el mismo cálculo mínimo por SQL).

- [ ] **Step 1: Helper compartido dentro de `lumi-cli`**

En `crates/lumi-cli/src/install.rs`, añadir esta función cerca de
`local_ip()` (que ya existe en el fichero):

```rust
/// Igual que `lumid::red::direccion_publica`, pero por SQL directa: este
/// binario no enlaza con `lumid`. Si no hay ajuste guardado (servidor recién
/// instalado, o admin que nunca tocó "Red"), cae al mismo cálculo de
/// siempre: IP LAN + `lumi_proto::PORT`.
pub fn direccion_publica(db: &rusqlite::Connection) -> String {
    let leer = |k: &str| -> Option<String> {
        db.query_row("SELECT v FROM meta WHERE k = ?1", [k], |r| r.get(0)).ok()
    };
    let host = leer("red_public_host")
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| local_ip().unwrap_or_else(|| "127.0.0.1".into()));
    let port = leer("red_public_port")
        .and_then(|v| v.parse::<u16>().ok())
        .or_else(|| leer("red_bind_port").and_then(|v| v.parse().ok()))
        .unwrap_or(lumi_proto::PORT);
    format!("{host}:{port}")
}
```

- [ ] **Step 2: Usarlo en `reissue()`**

En `crates/lumi-cli/src/install.rs`, dentro de `pub fn reissue()`, sustituir:

```rust
    let addr = format!(
        "{}:{}",
        local_ip().unwrap_or_else(|| "127.0.0.1".into()),
        lumi_proto::PORT
    );
    let key = PairKey::generate(&addr, &der);
    let db = rusqlite::Connection::open(format!("{DATA}/lumi.db"))?;
    db.busy_timeout(std::time::Duration::from_secs(5))?;
```

por (nótese que la conexión a la DB se abre ANTES de calcular `addr`, para
poder leer `meta` — antes se abría después):

```rust
    let db = rusqlite::Connection::open(format!("{DATA}/lumi.db"))?;
    db.busy_timeout(std::time::Duration::from_secs(5))?;
    let addr = direccion_publica(&db);
    let key = PairKey::generate(&addr, &der);
```

- [ ] **Step 3: Usarlo en `run()`**

En `crates/lumi-cli/src/install.rs`, dentro de `pub fn run(...)`, la línea:

```rust
    let addr = format!("{}:{}", local_ip().unwrap_or_else(|| "127.0.0.1".into()), lumi_proto::PORT);
    let key = PairKey::generate(&addr, &der);
```

se queda IGUAL — en la instalación inicial la base de datos todavía no tiene
ajustes guardados (se crea unas líneas más abajo, en `let db =
rusqlite::Connection::open(...)`), así que no hay nada que leer todavía y el
cálculo de siempre ya es correcto. No hay cambio en este paso — es
intencional, lo que evita es que alguien intente "optimizarlo" sin saber por
qué no hace falta.

- [ ] **Step 4: Usarlo en `admin::card()`**

En `crates/lumi-cli/src/admin.rs`, sustituir:

```rust
pub fn card() -> Result<ServerCard> {
    let der = std::fs::read(format!("{DATA}/cert.der")).context("el servidor no está instalado")?;
    let addr = format!("{}:{}", crate::install::local_ip().unwrap_or_else(|| "127.0.0.1".into()), lumi_proto::PORT);
    Ok(ServerCard::new(&addr, &der))
}
```

por:

```rust
pub fn card() -> Result<ServerCard> {
    let der = std::fs::read(format!("{DATA}/cert.der")).context("el servidor no está instalado")?;
    let addr = crate::install::direccion_publica(&db()?);
    Ok(ServerCard::new(&addr, &der))
}
```

- [ ] **Step 5: Compilar**

Run: `cargo build -p lumi-cli`
Expected: compila.

- [ ] **Step 6: Commit**

```bash
git add crates/lumi-cli/src/install.rs crates/lumi-cli/src/admin.rs
git commit -m "feat: lumi key reissue y lumi card usan el host/puerto público configurado"
```

---

### Task 6: Tipos TypeScript + funciones de API para `/v1/admin/network`

**Files:**
- Modify: `client/src/lib/api.ts`

**Interfaces:**
- Produce: `NetworkSettings`, `NetworkView`, `api.networkGet`, `api.networkPatch`,
  `api.networkRestart`; variante `{ tipo: "red"; nuevo_addr: string }` en el
  tipo `Cambio`.

- [ ] **Step 1: Añadir los tipos**

En `client/src/lib/api.ts`, junto a `export interface SecuritySettings { ...
}` (línea ~128-133), añadir:

```typescript
export interface NetworkSettings {
  bind_port: number;
  public_host: string | null;
  public_port: number | null;
  quic_enabled: boolean;
  quic_port: number;
}
export interface NetworkView {
  settings: NetworkSettings;
  server_card: string;
  restart_blocked_reason: string | null;
}
```

- [ ] **Step 2: Extender el tipo `Cambio`**

En `client/src/lib/api.ts` (línea 310-313), sustituir:

```typescript
export type Cambio =
  | { tipo: "estado"; analysis_id: number; case_id: number; estado: Analysis["state"] }
  | { tipo: "progreso"; analysis_id: number; fase: string; pct: number }
  | { tipo: "invitacion"; project_id: number; project_name: string; invited_by: string };
```

por:

```typescript
export type Cambio =
  | { tipo: "estado"; analysis_id: number; case_id: number; estado: Analysis["state"] }
  | { tipo: "progreso"; analysis_id: number; fase: string; pct: number }
  | { tipo: "invitacion"; project_id: number; project_name: string; invited_by: string }
  | { tipo: "red"; nuevo_addr: string };
```

- [ ] **Step 3: Añadir las funciones a `api`**

En `client/src/lib/api.ts`, dentro de `export const api = { ... }` (junto a
`cpuAplicar` al final, línea ~356), añadir:

```typescript
  networkGet: (token: string) => api.get<NetworkView>("/v1/admin/network", token),
  networkPatch: (s: NetworkSettings, token: string) => api.patch<NetworkView>("/v1/admin/network", s, token),
  networkRestart: (token: string) => api.post<null>("/v1/admin/network/restart", {}, token),
```

- [ ] **Step 4: Comprobar tipos**

Run: `cd client && npx tsc -b`
Expected: sin salida (nadie más usa estos tipos todavía, así que no hay
comprobación cruzada que pueda fallar en este paso).

- [ ] **Step 5: Commit**

```bash
git add client/src/lib/api.ts
git commit -m "feat: tipos y funciones de API para la configuración de red"
```

---

### Task 7: Vista "Red" en el panel de administración

**Files:**
- Create: `client/src/admin/NetworkView.tsx`
- Modify: `client/src/admin/Sidebar.tsx:6-8` (tipo `Seccion` y grupo "Servidor")
- Modify: `client/src/admin/AdminPanel.tsx:59-70` (rama de render)

**Interfaces:**
- Consume: `api.networkGet`, `api.networkPatch`, `api.networkRestart`,
  `NetworkSettings`, `NetworkView` (Task 6); `Seccion` (`./AdminPanel.tsx`,
  el wrapper de cabecera, no confundir con el tipo `Seccion` de `Sidebar.tsx`
  — mismo nombre, dos cosas distintas, igual que ya conviven hoy en
  `AdminPanel.tsx`).

- [ ] **Step 1: Escribir `client/src/admin/NetworkView.tsx`**

```tsx
import { useEffect, useState } from "react";
import { api, type NetworkSettings, type NetworkView as NetworkViewData } from "../lib/api";
import { Icon } from "../ui/Icon";
import { Seccion } from "./AdminPanel";

/** Copia al portapapeles con feedback textual de 1.5s — no hay toast propio
 *  para esto, y no hace falta uno: es una acción de un solo paso. */
function useCopiado() {
  const [copiado, setCopiado] = useState(false);
  return {
    copiado,
    copiar: (texto: string) => {
      void navigator.clipboard.writeText(texto);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 1500);
    },
  };
}

export function NetworkView({ token }: { token: string }) {
  const [data, setData] = useState<NetworkViewData | null>(null);
  const [borrador, setBorrador] = useState<NetworkSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { copiado, copiar } = useCopiado();

  const load = () =>
    api.networkGet(token).then((d) => { setData(d); setBorrador(d.settings); }).catch((e) => setError(String(e)));

  useEffect(() => { void load(); }, [token]);

  async function guardar() {
    if (!borrador) return;
    setBusy(true); setError(null);
    try {
      const d = await api.networkPatch(borrador, token);
      setData(d); setBorrador(d.settings);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function reiniciar() {
    setBusy(true); setError(null);
    try {
      await api.networkRestart(token);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!data || !borrador) {
    return (
      <Seccion titulo="Red" grupo="Servidor">
        <p className="text-[11px] text-subtle">cargando</p>
      </Seccion>
    );
  }

  const cambiado = JSON.stringify(borrador) !== JSON.stringify(data.settings);

  return (
    <Seccion titulo="Red" grupo="Servidor">
      <div className="rounded-[11px] border border-border bg-panel p-[13px_15px]">
        <div className="mb-2.5 text-[8.5px] uppercase tracking-[.15em] text-subtle">Escucha y dirección pública</div>
        <Fila etiqueta="Puerto de escucha (TCP)">
          <input type="number" min={1} max={65535} value={borrador.bind_port}
            onChange={(e) => setBorrador({ ...borrador, bind_port: e.target.valueAsNumber || 0 })}
            className="w-[100px] rounded-[9px] border border-border bg-[#0d0f12] px-[11px] py-[6px] font-mono text-[12.5px] text-fg outline-none focus:border-white/40" />
        </Fila>
        <Fila etiqueta="Host público (dominio o IP)">
          <input type="text" placeholder="autodetectada" value={borrador.public_host ?? ""}
            onChange={(e) => setBorrador({ ...borrador, public_host: e.target.value || null })}
            className="w-[220px] rounded-[9px] border border-border bg-[#0d0f12] px-[11px] py-[6px] font-mono text-[12.5px] text-fg outline-none focus:border-white/40" />
        </Fila>
        <Fila etiqueta="Puerto público (si hay port-forwarding)">
          <input type="number" min={1} max={65535} placeholder={String(borrador.bind_port)}
            value={borrador.public_port ?? ""}
            onChange={(e) => setBorrador({ ...borrador, public_port: e.target.valueAsNumber || null })}
            className="w-[100px] rounded-[9px] border border-border bg-[#0d0f12] px-[11px] py-[6px] font-mono text-[12.5px] text-fg outline-none focus:border-white/40" />
        </Fila>
        <p className="mt-2 max-w-[54ch] text-[10.5px] text-subtle">
          El host/puerto público es lo que se incrusta en claves y tarjetas nuevas.
          Distinto del puerto de escucha solo si hay NAT, port-forwarding o un proxy TCP transparente de por medio.
        </p>
      </div>

      <div className="mt-4 rounded-[11px] border border-border bg-panel p-[13px_15px]">
        <div className="mb-2.5 text-[8.5px] uppercase tracking-[.15em] text-subtle">QUIC / HTTP-3 (opcional)</div>
        <Fila etiqueta="Activado">
          <div className="flex gap-1.5">
            {([true, false] as const).map((v) => (
              <button key={String(v)} onClick={() => setBorrador({ ...borrador, quic_enabled: v })}
                className={`rounded border px-2 py-1 text-[10.5px] transition-colors duration-300 ease-expo ${
                  borrador.quic_enabled === v ? "border-accent text-fg" : "border-border text-subtle"}`}>
                {v ? "activado" : "desactivado"}
              </button>
            ))}
          </div>
        </Fila>
        <Fila etiqueta="Puerto UDP">
          <input type="number" min={1} max={65535} value={borrador.quic_port}
            onChange={(e) => setBorrador({ ...borrador, quic_port: e.target.valueAsNumber || 0 })}
            className="w-[100px] rounded-[9px] border border-border bg-[#0d0f12] px-[11px] py-[6px] font-mono text-[12.5px] text-fg outline-none focus:border-white/40" />
        </Fila>
        <p className="mt-2 max-w-[54ch] text-[10.5px] text-subtle">
          El cliente de Lumi Station todavía habla TCP+TLS exclusivamente — activar esto
          no cambia nada para él hoy. Es infraestructura para el futuro, anunciada en /v1/hello.
        </p>
      </div>

      <div className="mt-4 rounded-[11px] border border-border bg-panel p-[13px_15px]">
        <div className="mb-2.5 text-[8.5px] uppercase tracking-[.15em] text-subtle">Tarjeta de servidor actual</div>
        <div className="flex items-center gap-2">
          <code className="flex-1 truncate rounded-[9px] border border-border bg-[#0d0f12] px-[11px] py-[6px] font-mono text-[11px] text-fg">
            {data.server_card}
          </code>
          <button onClick={() => copiar(data.server_card)}
            className="jg-press shrink-0 rounded-lg border border-white/15 px-2.5 py-1.5 text-[10.5px] text-fg">
            {copiado ? "Copiada" : "Copiar"}
          </button>
        </div>
        <p className="mt-2 text-[10.5px] text-subtle">
          Compártela con quien necesite reconectar tras un cambio de dirección — sustituye a pedir acceso por SSH.
        </p>
      </div>

      {error && <p className="mt-3 text-[11px] text-danger-fg">{error}</p>}

      <div className="mt-4 flex gap-2">
        <button onClick={guardar} disabled={busy || !cambiado}
          className="jg-press rounded-lg bg-accent px-3.5 py-1.5 text-[11px] font-medium text-black disabled:opacity-40">
          Guardar cambios
        </button>
        <button onClick={reiniciar} disabled={busy || !!data.restart_blocked_reason}
          title={data.restart_blocked_reason ?? undefined}
          className="jg-press rounded-lg border border-white/15 px-3.5 py-1.5 text-[11px] text-fg disabled:opacity-40">
          Reiniciar ahora
        </button>
        {data.restart_blocked_reason && (
          <span className="flex items-center gap-1.5 text-[10.5px] text-warning-fg">
            <Icon name="alert" size={11} /> {data.restart_blocked_reason}
          </span>
        )}
      </div>
      {cambiado && (
        <p className="mt-2 text-[10.5px] text-subtle">
          Cambiar puerto de escucha o QUIC exige reiniciar para aplicarse.
        </p>
      )}
    </Seccion>
  );
}

function Fila({ etiqueta, children }: { etiqueta: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 border-b border-border py-[9px] text-[11px] last:border-none">
      <span className="w-[220px] shrink-0 text-subtle">{etiqueta}</span>
      {children}
    </div>
  );
}
```

- [ ] **Step 2: Añadir la sección al tipo `Seccion` de `Sidebar.tsx`**

En `client/src/admin/Sidebar.tsx`, línea 5-8, sustituir:

```typescript
export type Seccion =
  | "resumen" | "modelos" | "personalizacion" | "indices" | "seguridad" | "claves"
  | "solicitudes" | "usuarios"
  | "cola" | "notificaciones" | "hardware";
```

por:

```typescript
export type Seccion =
  | "resumen" | "modelos" | "personalizacion" | "indices" | "seguridad" | "claves" | "red"
  | "solicitudes" | "usuarios"
  | "cola" | "notificaciones" | "hardware";
```

Y en el grupo "Servidor" (línea 15-24), añadir la entrada tras "claves":

```typescript
      { id: "claves", label: "API Keys", icon: "key" },
      { id: "red", label: "Red", icon: "globe" },
```

(Revisa `client/src/ui/Icon.tsx` — si `"globe"` ya se usa en otra entrada de
este mismo `GRUPOS` como en "personalizacion", usa un icono hermano de la
misma familia visual que no se repita en el mismo grupo, p. ej. `"grid"` si
`"globe"` ya está tomado en este grupo; el objetivo es que dos entradas del
grupo "Servidor" no compartan icono, no un icono concreto.)

- [ ] **Step 3: Registrar la vista en `AdminPanel.tsx`**

En `client/src/admin/AdminPanel.tsx`, añadir el import junto al resto (línea
19, tras `import { UsersView } from "./UsersView";`):

```typescript
import { NetworkView } from "./NetworkView";
```

Y añadir la rama de render (línea ~64, junto a `seccion === "personalizacion"`):

```tsx
          : seccion === "personalizacion" ? <CustomizacionView token={token} />
          : seccion === "red" ? <NetworkView token={token} />
```

- [ ] **Step 4: Comprobar tipos**

Run: `cd client && npx tsc -b`
Expected: sin salida.

- [ ] **Step 5: Verificación manual**

Con `lumid` corriendo (Task 4) y `npm run tauri dev` en `client/`: entrar como
admin, ir a "Red" en el panel, comprobar que se ven los cinco campos con sus
valores por defecto y la tarjeta de servidor empezando por `lumi1s_`.

- [ ] **Step 6: Commit**

```bash
git add client/src/admin/NetworkView.tsx client/src/admin/Sidebar.tsx client/src/admin/AdminPanel.tsx
git commit -m "feat: vista Red en el panel de administración"
```

---

### Task 8: Aviso en vivo a clientes conectados + pista de recuperación en login

**Files:**
- Modify: `client/src/ui/NotificationsPopover.tsx:110-115`
- Modify: `client/src/lib/session.ts` (nueva función)
- Modify: `client/src/entry/LoginForm.tsx:49-54`

**Interfaces:**
- Consume: evento Tauri `queue-change` con payload `Cambio` (tipo `"red"`,
  Task 6); `updateSession`, `addServer`, `forgetServer`, `loadSession`
  (`client/src/lib/session.ts`, ya existentes).
- Produce: `session.ts::migrarDireccion(nuevoAddr: string): void`.

- [ ] **Step 1: Añadir `migrarDireccion` a `session.ts`**

En `client/src/lib/session.ts`, junto a `forgetServer` (tras la línea 105),
añadir:

```typescript
/** El servidor avisó (por `Cambio::Red`, mientras todavía era alcanzable en
 *  la dirección vieja) de que se muda a `nuevoAddr`. La huella no cambia —
 *  mismo certificado, no ha habido rotación — así que basta con mover la
 *  sesión activa y la entrada de la lista de servidores recordados a la
 *  dirección nueva, sin pedir nada al usuario. */
export function migrarDireccion(nuevoAddr: string) {
  const s = loadSession();
  if (!s?.addr) return;
  const fingerprint = s.fingerprint;
  updateSession({ addr: nuevoAddr });
  const viejo = loadServers().find((x) => x.addr === s.addr);
  forgetServer(s.addr);
  addServer({ addr: nuevoAddr, fingerprint, label: viejo?.label ?? nuevoAddr });
}
```

- [ ] **Step 2: Escuchar `tipo: "red"` en `NotificationsPopover.tsx`**

En `client/src/ui/NotificationsPopover.tsx`, sustituir el efecto (línea
110-115):

```typescript
  useEffect(() => {
    const un = listen<Cambio>("queue-change", (e) => {
      if (e.payload.tipo === "invitacion") void load();
    });
    return () => { un.then((f) => f()); };
  }, []);
```

por:

```typescript
  useEffect(() => {
    const un = listen<Cambio>("queue-change", (e) => {
      if (e.payload.tipo === "invitacion") void load();
      // El servidor avisó de un cambio de dirección: se actualiza la sesión
      // en silencio (ver `migrarDireccion`) y se muestra un toast — no hay
      // nada que aceptar ni rechazar, ya está aplicado.
      if (e.payload.tipo === "red") {
        migrarDireccion(e.payload.nuevo_addr);
        setAvisoRed(e.payload.nuevo_addr);
      }
    });
    return () => { un.then((f) => f()); };
  }, []);
```

Y añade el import y el estado nuevo junto a los ya existentes (línea 1-9,
línea 67-69):

```typescript
import { migrarDireccion } from "../lib/session";
```

```typescript
  const [avisoRed, setAvisoRed] = useState<string | null>(null);
```

Y el toast en el JSX, justo antes del `return` final del componente (tras el
cierre de la última `</div>` del popover, dentro del `return (<div
ref={box}...>...)`, como hermano del `button` de la campana — añade este
bloque justo después del `</button>` de la campana, antes de `{open && (`):

```tsx
      {avisoRed && (
        <div className="absolute right-0 top-[30px] z-[70] w-[260px] rounded-[11px] border border-white/[.14]
          bg-[rgba(20,22,26,.97)] p-[11px_12px] text-[11px] text-muted shadow-lg shadow-black/40 backdrop-blur-xl"
          style={{ animation: "jg-fade-rise .5s cubic-bezier(.16,1,.3,1) both" }}>
          El servidor se movió a <b className="font-mono text-fg">{avisoRed}</b>. Ya está actualizado.
          <button onClick={() => setAvisoRed(null)} className="mt-2 block text-[10.5px] text-subtle hover:text-fg">
            Entendido
          </button>
        </div>
      )}
```

- [ ] **Step 3: Pista de recuperación en `LoginForm.tsx`**

En `client/src/entry/LoginForm.tsx`, dentro de `submit()`, el bloque
`catch (e) { setError(String(e)); }` (línea 49-51) pasa a:

```typescript
    } catch (e) {
      const msg = String(e);
      // El error de conexión trae este prefijo (ver `client_for`/`connect`
      // en `client/src-tauri/src/main.rs`) cuando la dirección guardada ya
      // no responde — puede ser un corte de red normal, o que el admin
      // cambió el puerto/host y esta sesión no estaba conectada para
      // recibir el aviso en vivo. La pista cubre ese segundo caso sin
      // afirmar que sea la causa segura.
      setError(
        msg.includes("no se pudo conectar")
          ? `${msg}. ¿Cambió de dirección el servidor? Pide una tarjeta nueva y añádela.`
          : msg
      );
    } finally {
```

- [ ] **Step 4: Comprobar tipos**

Run: `cd client && npx tsc -b`
Expected: sin salida.

- [ ] **Step 5: Commit**

```bash
git add client/src/ui/NotificationsPopover.tsx client/src/lib/session.ts client/src/entry/LoginForm.tsx
git commit -m "feat: aviso en vivo de cambio de dirección + pista de recuperación en login"
```

---

### Task 9: Listener QUIC/HTTP-3 opcional (solo `/v1/hello`)

**Files:**
- Modify: `crates/lumid/Cargo.toml`
- Create: `crates/lumid/src/quic.rs`
- Modify: `crates/lumid/src/main.rs` (`mod quic;`, arranque condicional,
  capacidad en `/v1/hello`)
- Modify: `crates/lumid/src/routes/hello.rs`

**Interfaces:**
- Consume: `red::leer` (Task 1), `app.dir` (cert.der/key.pem), `app.fingerprint`.
- Produce: `quic::arrancar_si_procede(app: &App) -> anyhow::Result<()>`
  (spawnea su propia tarea si `quic_enabled`, no bloquea; no devuelve nada
  que el resto del sistema consuma).

**ponytail:** este listener sirve ÚNICAMENTE `/v1/hello` sobre HTTP/3, no
replica las ~50 rutas de la API sobre `h3`. Reimplementar el router de axum
entero sobre `h3` es un proyecto en sí mismo, y hoy no hay ningún cliente
capaz de hablarlo (`reqwest` no tiene soporte HTTP/3 estable) — construir
ese router completo sería trabajo sin nadie que lo ejercite. La salida,
cuando haga falta, es ampliar este módulo ruta a ruta el día que un
consumidor real lo necesite.

- [ ] **Step 1: Añadir dependencias a `crates/lumid/Cargo.toml`**

```toml
quinn = "0.11"
h3 = "0.0.6"
h3-quinn = "0.0.7"
http = "1"
rustls-pemfile = "2"
```

- [ ] **Step 2: Escribir `crates/lumid/src/quic.rs`**

```rust
//! Listener QUIC/HTTP-3 opcional. Sirve solo `/v1/hello` — ver la nota
//! ponytail en el plan de implementación de esta feature para el porqué.
//! Mismo certificado que el listener TCP+TLS: la huella que ancla la clave
//! de vinculación es una sola, no una por transporte.

use crate::App;
use bytes::Bytes;
use rustls_pki_types::{CertificateDer, PrivateKeyDer};
use std::sync::Arc;

fn cargar_identidad(dir: &std::path::Path) -> anyhow::Result<(Vec<CertificateDer<'static>>, PrivateKeyDer<'static>)> {
    let der = std::fs::read(dir.join("cert.der"))?;
    let cert = CertificateDer::from(der).into_owned();
    let key_pem = std::fs::read(dir.join("key.pem"))?;
    let mut reader = std::io::Cursor::new(key_pem);
    let key = rustls_pemfile::pkcs8_private_keys(&mut reader)
        .next()
        .ok_or_else(|| anyhow::anyhow!("key.pem sin clave PKCS8"))??;
    Ok((vec![cert], PrivateKeyDer::Pkcs8(key)))
}

pub async fn arrancar_si_procede(app: App) -> anyhow::Result<()> {
    let s = crate::red::leer(&app.store);
    if !s.quic_enabled {
        return Ok(());
    }
    let (certs, key) = cargar_identidad(&app.dir)?;
    let mut rustls_cfg = rustls::ServerConfig::builder()
        .with_no_client_auth()
        .with_single_cert(certs, key)?;
    rustls_cfg.alpn_protocols = vec![b"h3".to_vec()];
    let quic_cfg = quinn::crypto::rustls::QuicServerConfig::try_from(rustls_cfg)?;
    let server_cfg = quinn::ServerConfig::with_crypto(Arc::new(quic_cfg));
    let addr: std::net::SocketAddr = ([0, 0, 0, 0], s.quic_port).into();
    let endpoint = quinn::Endpoint::server(server_cfg, addr)?;
    tracing::info!("lumid (QUIC/HTTP-3, solo /v1/hello) escuchando en udp:{}", s.quic_port);

    let hello_json = serde_json::to_vec(&app_hello(&app).await)?;
    while let Some(conectando) = endpoint.accept().await {
        let hello_json = hello_json.clone();
        tokio::spawn(async move {
            if let Err(e) = atender(conectando, hello_json).await {
                tracing::warn!("conexión QUIC caída: {e}");
            }
        });
    }
    Ok(())
}

async fn atender(conectando: quinn::Incoming, hello_json: Vec<u8>) -> anyhow::Result<()> {
    let conn = conectando.await?;
    let mut h3_conn = h3::server::Connection::<_, Bytes>::new(h3_quinn::Connection::new(conn)).await?;
    while let Some((_req, mut stream)) = h3_conn.accept().await? {
        let resp = http::Response::builder()
            .status(200)
            .header("content-type", "application/json")
            .body(())?;
        stream.send_response(resp).await?;
        stream.send_data(Bytes::from(hello_json.clone())).await?;
        stream.finish().await?;
    }
    Ok(())
}

/// `/v1/hello` no cambia mientras el proceso vive (capacidades, huella,
/// versión) salvo por el estado de bloqueo — que sobre QUIC no hace falta
/// perseguir en vivo todavía: es una única ruta de prueba de que el
/// transporte funciona, no la superficie completa.
async fn app_hello(app: &App) -> lumi_proto::api::Hello {
    let hw = crate::hardware::capacidades().await;
    lumi_proto::api::Hello {
        version: env!("CARGO_PKG_VERSION").into(),
        state: app.store.state(),
        mode: app.mode,
        locked: app.master.read().await.is_none(),
        fingerprint: app.fingerprint.clone(),
        capabilities: lumi_proto::caps::matrix(app.mode, app.gpus.len(), false, &hw),
        gpus: app.gpus.clone(),
    }
}
```

Añade `bytes = "1"` a `crates/lumid/Cargo.toml` si no está ya en el árbol de
dependencias (`cargo build` lo dirá si falta; añádelo bajo las demás líneas
del `[dependencies]`).

- [ ] **Step 3: Registrar el módulo y arrancarlo tras construir `App`**

En `crates/lumid/src/main.rs`, añadir `mod quic;` junto a `mod queue;` /
`mod red;` (Task 1).

Tras el bloque `tokio::spawn({ let app = app.clone(); async move { ...
reaplicar_al_arrancar ... } });` (línea ~97-103), añadir:

```rust
    tokio::spawn({
        let app = app.clone();
        async move {
            if let Err(e) = quic::arrancar_si_procede(app).await {
                tracing::warn!("no se pudo levantar el listener QUIC: {e}");
            }
        }
    });
```

- [ ] **Step 4: Anunciar la capacidad en `/v1/hello`**

En `crates/lumid/src/routes/hello.rs`, tras construir `capabilities` con
`lumi_proto::caps::matrix(...)` (dentro del bloque que arma `Json(Hello {
...})`), añade la capacidad `quic` al vector resultante. Sustituye:

```rust
        capabilities: {
            let hw = crate::hardware::capacidades().await;
            let (cpu_intel, cpu_intel_reason, cpu_amd, cpu_amd_reason, cpu_temp, cpu_temp_reason) =
                crate::hardware_cpu::capacidades().await;
            lumi_proto::caps::matrix(
                app.mode,
                app.gpus.len(),
                qdrant_vivo,
                &lumi_proto::caps::HardwareCaps {
                    cpu_potencia_intel: cpu_intel,
                    cpu_potencia_intel_reason: cpu_intel_reason,
                    cpu_potencia_amd: cpu_amd,
                    cpu_potencia_amd_reason: cpu_amd_reason,
                    cpu_temperatura: cpu_temp,
                    cpu_temperatura_reason: cpu_temp_reason,
                    ..hw
                },
            )
        },
```

por:

```rust
        capabilities: {
            let hw = crate::hardware::capacidades().await;
            let (cpu_intel, cpu_intel_reason, cpu_amd, cpu_amd_reason, cpu_temp, cpu_temp_reason) =
                crate::hardware_cpu::capacidades().await;
            let mut caps = lumi_proto::caps::matrix(
                app.mode,
                app.gpus.len(),
                qdrant_vivo,
                &lumi_proto::caps::HardwareCaps {
                    cpu_potencia_intel: cpu_intel,
                    cpu_potencia_intel_reason: cpu_intel_reason,
                    cpu_potencia_amd: cpu_amd,
                    cpu_potencia_amd_reason: cpu_amd_reason,
                    cpu_temperatura: cpu_temp,
                    cpu_temperatura_reason: cpu_temp_reason,
                    ..hw
                },
            );
            let red = crate::red::leer(&app.store);
            caps.push(lumi_proto::caps::Capability {
                id: "quic".into(),
                label: "Transporte QUIC/HTTP-3 (solo /v1/hello por ahora)".into(),
                state: if red.quic_enabled { lumi_proto::caps::CapState::Partial } else { lumi_proto::caps::CapState::Off },
                reason: Some(if red.quic_enabled {
                    "activo, pero el cliente oficial todavía no lo consume (reqwest sin soporte HTTP/3 estable)".into()
                } else {
                    "desactivado en Red".into()
                }),
            });
            caps
        },
```

- [ ] **Step 5: Compilar**

Run: `cargo build -p lumid`
Expected: compila. Si `h3`/`h3-quinn`/`quinn` no resuelven a versiones
compatibles entre sí (el ecosistema QUIC en Rust todavía mueve versión con
cierta frecuencia), ajusta los números de versión del Step 1 a las últimas
compatibles entre `quinn`, `h3` y `h3-quinn` publicadas en crates.io en el
momento de ejecutar este plan — la API de `h3::server::Connection::accept`
y `quinn::Endpoint::server` es estable en su forma desde hace varias
versiones, así que el ajuste esperable es de números, no de estructura del
código.

- [ ] **Step 6: Probar a mano (activar QUIC y comprobar que levanta)**

```bash
curl -sk -X PATCH https://127.0.0.1:7717/v1/admin/network \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"bind_port":7717,"public_host":null,"public_port":null,"quic_enabled":true,"quic_port":7717}'
```
Reinicia el proceso a mano (Ctrl+C y `cargo run -p lumid` de nuevo, o
`/v1/admin/network/restart`) y revisa el log:
Expected: aparece la línea `lumid (QUIC/HTTP-3, solo /v1/hello) escuchando
en udp:7717`.

Si tienes `curl` compilado con soporte HTTP/3 (`curl --version | grep -i
http3`):
```bash
curl --http3 -sk https://127.0.0.1:7717/v1/hello
```
Expected: el mismo JSON que la ruta TCP. Si tu `curl` no tiene HTTP/3, este
paso de verificación se salta — la línea de log del Step anterior ya
confirma que el listener levantó y aceptó la configuración TLS.

- [ ] **Step 7: Commit**

```bash
git add crates/lumid/Cargo.toml crates/lumid/src/quic.rs crates/lumid/src/main.rs crates/lumid/src/routes/hello.rs
git commit -m "feat: listener QUIC/HTTP-3 opcional (solo /v1/hello), anunciado en capacidades"
```

---

### Task 10: Anotar en FUTURO.md lo que queda fuera

**Files:**
- Modify: `FUTURO.md`

- [ ] **Step 1: Añadir la entrada**

Añade, siguiendo el formato de las entradas existentes de `FUTURO.md`:

```markdown
- **QUIC/HTTP-3 de extremo a extremo**: hoy el listener QUIC de `lumid`
  sirve solo `/v1/hello` (ver `crates/lumid/src/quic.rs`) porque `reqwest`
  (cliente del lado `client/src-tauri`) no tiene soporte HTTP/3 estable.
  Cuando lo tenga, ampliar el listener ruta a ruta y hacer que el cliente
  intente QUIC primero con fallback a TCP+TLS.
- **Proxies TLS-terminating**: la configuración de red (`docs/superpowers/specs/2026-08-18-config-red-design.md`)
  asume un proxy/port-forward transparente a nivel TCP. Un proxy que
  descifra y vuelve a cifrar rompe el anclaje de huella de certificado —
  no está soportado ni se detecta activamente.
```

- [ ] **Step 2: Commit**

```bash
git add FUTURO.md
git commit -m "docs: anota QUIC de extremo a extremo y proxies TLS-terminating en FUTURO.md"
```

---

## Self-Review

**Cobertura de la spec:**
- §1 (ajustes de red) → Tasks 1, 2, 4, 5, 7.
- §2 (compatibilidad con clientes ya emparejados) → Tasks 3, 4, 8.
- §3 (QUIC/HTTP3 opcional, con el límite de `reqwest` aceptado explícitamente) → Task 9.
- Fuera de alcance → Task 10 (FUTURO.md).

**Placeholders:** ninguno — cada paso trae el código completo a escribir.

**Consistencia de tipos:** `red::Settings` (Rust, Task 1) ↔ `NetworkSettings`
(TS, Task 6) tienen los mismos cinco campos con los mismos nombres
(`bind_port`, `public_host`, `public_port`, `quic_enabled`, `quic_port`).
`Cambio::Red { nuevo_addr }` (Rust, Task 3) ↔ `{ tipo: "red"; nuevo_addr:
string }` (TS, Task 6) coinciden. `NetworkView`/`server_card`/
`restart_blocked_reason` se usan igual en Task 4 (Rust) y Task 7 (TS).
