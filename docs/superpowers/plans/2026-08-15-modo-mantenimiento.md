# Modo mantenimiento Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un administrador puede activar "modo mantenimiento" desde Seguridad: por defecto bloquea
toda la API salvo un núcleo mínimo y a sí mismo, pero puede reactivar servicios concretos
(modelos, índices, customización, cola, proyectos, personas, claves) y opcionalmente bloquear
incluso el login de usuarios no-admin. Una tira animada en el panel de administración avisa
cuando está activo.

**Architecture:** Mismo patrón que Zero Trust: un módulo `mantenimiento.rs` con funciones puras
sobre `meta` (sin tabla nueva) más un middleware (`mantenimiento_gate`) que se cuelga del router
completo junto a `zero_trust_gate`. El login es la única excepción: como el gateo genérico solo ve
la ruta (no si las credenciales son válidas ni si la cuenta es admin), su restricción vive dentro
de `routes::auth::login` en vez del middleware. El endpoint `/v1/admin/security` ya existente
(de Zero Trust) se amplía con los cuatro campos nuevos en vez de crear una ruta aparte.

**Tech Stack:** Rust (axum 0.7, rusqlite), React + TypeScript (Tauri client), SQLite.

## Global Constraints

- **No tests automáticos fuera de `lumi-proto`.** Este plan no toca `lumi-proto`'s lógica (solo
  añade campos planos a structs existentes), así que ningún paso de este plan añade un `#[test]`
  nuevo a `lumid` — cada paso termina en verificación manual (`cargo build`, un `curl`, o un
  click-through).
- **Español** en identificadores y comentarios, igual que el resto del código.
- **Sin dependencias nuevas de Cargo.**
- **Reutilizar, no reinventar:** el icono de la tira es `alert` (ya existe en `Icon.tsx`), y su
  pulso reutiliza `@keyframes jg-alert-pulse` (ya existe en `index.css`) en vez de crear una
  animación de icono nueva.

---

### Task 1: `lumi-proto` — campos nuevos en `SecuritySettings`/`PatchSecurityReq`

**Files:**
- Modify: `crates/lumi-proto/src/api.rs:132-144`

**Interfaces:**
- Produces: `SecuritySettings.{maintenance, maintenance_message, maintenance_block_login,
  maintenance_services}`, `PatchSecurityReq.{maintenance, maintenance_message,
  maintenance_block_login, maintenance_services}` — consumidos por Task 3 (`routes/security.rs`),
  Task 2 (`mantenimiento.rs` lee los mismos conceptos desde `meta` directamente, no desde estos
  tipos), y Task 6/7 en el cliente (mismo shape espejado en TypeScript).

- [ ] **Step 1: Ampliar los dos structs**

En `crates/lumi-proto/src/api.rs`, reemplaza:

```rust
#[derive(Debug, Serialize, Clone)]
pub struct SecuritySettings {
    pub zero_trust: bool,
    pub self_service_ip: bool,
    pub allowlist: Vec<String>,
    pub denylist: Vec<String>,
}

#[derive(Debug, Deserialize)]
pub struct PatchSecurityReq {
    pub zero_trust: Option<bool>,
    pub self_service_ip: Option<bool>,
}
```

por:

```rust
#[derive(Debug, Serialize, Clone)]
pub struct SecuritySettings {
    pub zero_trust: bool,
    pub self_service_ip: bool,
    pub allowlist: Vec<String>,
    pub denylist: Vec<String>,
    pub maintenance: bool,
    pub maintenance_message: String,
    pub maintenance_block_login: bool,
    /// Ids de servicio que se mantienen ALCANZABLES mientras dura el
    /// mantenimiento (p.ej. "mapa", "modelos"). Vacío = todo bloqueado salvo
    /// el núcleo fijo y los administradores.
    pub maintenance_services: Vec<String>,
}

#[derive(Debug, Deserialize)]
pub struct PatchSecurityReq {
    pub zero_trust: Option<bool>,
    pub self_service_ip: Option<bool>,
    pub maintenance: Option<bool>,
    pub maintenance_message: Option<String>,
    pub maintenance_block_login: Option<bool>,
    pub maintenance_services: Option<Vec<String>>,
}
```

- [ ] **Step 2: Verificar que `lumi-proto` compila y sus propios tests pasan**

Run:
```bash
cargo test -p lumi-proto
```
Expected: `test result: ok` (los structs nuevos son datos planos sin lógica, igual que el resto de
`api.rs` — no hace falta test nuevo).

- [ ] **Step 3: Commit**

```bash
git add crates/lumi-proto/src/api.rs
git commit -m "feat: campos de modo mantenimiento en SecuritySettings"
```

---

### Task 2: `crates/lumid/src/mantenimiento.rs` — lógica pura y middleware

**Files:**
- Create: `crates/lumid/src/mantenimiento.rs`
- Modify: `crates/lumid/src/main.rs:17` (declaración del módulo — el registro en el router es
  Task 3)

**Interfaces:**
- Consumes: `App` (`.store.get_meta`/`.set_meta`), `crate::routes::auth::{bearer,
  require_session}`.
- Produces: `activo`, `mensaje`, `bloquea_login`, `servicios_habilitados`, `set_activo`,
  `set_mensaje`, `set_bloquea_login`, `set_servicios`, `servicio_de_ruta`, `mantenimiento_gate` —
  usados por Task 3 (rutas de ajustes) y Task 4 (chequeo dentro de `login()`).

- [ ] **Step 1: Escribir el módulo**

Create `crates/lumid/src/mantenimiento.rs`:

```rust
//! Modo mantenimiento: por defecto bloquea toda la API salvo un núcleo fijo
//! y quien ya es administrador; el propio admin decide qué servicios
//! reactivar. `/v1/auth/login` es la única ruta que este módulo NO gatea
//! directamente — necesita saber si la cuenta es admin, y eso solo se sabe
//! tras verificar la contraseña dentro del propio handler de login
//! (`routes::auth::login`), así que la restricción de login vive allí.
//!
//! Mismo patrón que `zero_trust.rs`: funciones puras sobre datos ya leídos,
//! y un único middleware que las junta.

use crate::App;
use axum::extract::{Request, State};
use axum::http::{HeaderMap, StatusCode};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};

pub fn activo(app: &App) -> bool {
    app.store.get_meta("mantenimiento").as_deref() == Some("1")
}

pub fn mensaje(app: &App) -> String {
    app.store.get_meta("mantenimiento_mensaje").unwrap_or_default()
}

pub fn bloquea_login(app: &App) -> bool {
    app.store.get_meta("mantenimiento_bloquea_login").as_deref() == Some("1")
}

pub fn servicios_habilitados(app: &App) -> Vec<String> {
    app.store
        .get_meta("mantenimiento_servicios")
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

pub fn set_activo(app: &App, on: bool) -> anyhow::Result<()> {
    app.store.set_meta("mantenimiento", if on { "1" } else { "0" })
}

pub fn set_mensaje(app: &App, msg: &str) -> anyhow::Result<()> {
    app.store.set_meta("mantenimiento_mensaje", msg)
}

pub fn set_bloquea_login(app: &App, on: bool) -> anyhow::Result<()> {
    app.store.set_meta("mantenimiento_bloquea_login", if on { "1" } else { "0" })
}

pub fn set_servicios(app: &App, ids: &[String]) -> anyhow::Result<()> {
    app.store.set_meta("mantenimiento_servicios", &serde_json::to_string(ids)?)
}

/// Rutas que SIEMPRE se dejan pasar hacia el handler, tenga o no permiso su
/// llamante: sin ellas ni un admin podría revertir el modo, ni un usuario
/// normal podría saber quién es o cerrar su sesión. `/v1/auth/login` va
/// aparte: no es que esté "siempre permitido", es que su propia restricción
/// vive dentro del handler (ver `routes::auth::login`), así que aquí solo
/// se le deja llegar.
fn es_nucleo(path: &str) -> bool {
    path == "/v1/auth/login"
        || path == "/v1/hello"
        || path == "/v1/auth/me"
        || path == "/v1/auth/change-password"
        || path == "/v1/me/sessions"
        || path.starts_with("/v1/sessions/")
        || path.starts_with("/v1/admin/security")
}

/// `None` = la ruta no pertenece a ningún servicio personalizable, y por
/// tanto NO se puede reactivar por separado — queda bloqueada junto con
/// todo lo demás mientras el modo esté activo. Fail-closed a propósito: es
/// más seguro que una ruta nueva, olvidada aquí, se quede bloqueada a que se
/// cuele sin querer.
pub fn servicio_de_ruta(path: &str) -> Option<&'static str> {
    const SERVICIOS: &[(&str, &str)] = &[
        ("/v1/admin/models", "modelos"),
        ("/v1/indices", "indices"),
        ("/v1/map", "mapa"),
        ("/v1/queue", "cola"),
        ("/v1/tasks", "cola"),
        ("/v1/projects", "proyectos"),
        ("/v1/images", "proyectos"),
        ("/v1/cases", "proyectos"),
        ("/v1/analyses", "proyectos"),
        ("/v1/me/invites", "proyectos"),
        ("/v1/invites", "proyectos"),
        ("/v1/me/usage", "proyectos"),
        ("/v1/access-requests", "personas"),
        ("/v1/accounts", "personas"),
        ("/v1/admin/access-requests", "personas"),
        ("/v1/admin/users", "personas"),
        ("/v1/users/search", "personas"),
        ("/v1/me/api-keys", "claves"),
        ("/v1/admin/api-keys", "claves"),
        ("/v1/api-keys", "claves"),
    ];
    SERVICIOS.iter().find(|(prefijo, _)| path.starts_with(prefijo)).map(|(_, id)| *id)
}

/// El único punto de aplicación del gateo genérico: se cuelga como capa de
/// TODO el router en `main.rs`, junto a `zero_trust_gate`. El orden entre
/// ambas capas no importa — cada una decide de forma independiente y
/// cualquiera puede cortar la petición antes del handler.
pub async fn mantenimiento_gate(
    State(app): State<App>,
    headers: HeaderMap,
    req: Request,
    next: Next,
) -> Response {
    if !activo(&app) {
        return next.run(req).await;
    }
    let path = req.uri().path();
    if es_nucleo(path) {
        return next.run(req).await;
    }
    let token = crate::routes::auth::bearer(&headers);
    if crate::routes::auth::require_session(&app, &token).is_ok_and(|(_, is_admin)| is_admin) {
        return next.run(req).await;
    }
    let habilitados = servicios_habilitados(&app);
    let permitido = servicio_de_ruta(path).is_some_and(|id| habilitados.iter().any(|h| h == id));
    if permitido {
        return next.run(req).await;
    }
    let msg = mensaje(&app);
    let cuerpo = if msg.trim().is_empty() { "Servidor en mantenimiento.".to_string() } else { msg };
    (StatusCode::SERVICE_UNAVAILABLE, cuerpo).into_response()
}
```

- [ ] **Step 2: Declarar el módulo**

En `crates/lumid/src/main.rs`, añade a la lista de `mod` (junto a `mod zero_trust;`):

```rust
mod mantenimiento;
```

- [ ] **Step 3: Verificar que compila**

Run:
```bash
cargo build -p lumid
```
Expected: compila limpio (el módulo aún no se llama desde ningún sitio — eso es Task 3/4 — pero
`mantenimiento_gate` es `pub` así que no salta warning de código muerto sobre él).

- [ ] **Step 4: Comprobar `servicio_de_ruta` a ojo**

No hace falta levantar el servidor — es aritmética de strings pura. Confirma estos casos contra el
código de arriba:
- `servicio_de_ruta("/v1/map/tiles/2/2/1")` → empieza por `/v1/map` → `Some("mapa")`.
- `servicio_de_ruta("/v1/admin/models/download")` → empieza por `/v1/admin/models` →
  `Some("modelos")`.
- `servicio_de_ruta("/v1/admin/access-requests")` → empieza por `/v1/admin/access-requests` →
  `Some("personas")` (y NO por `/v1/access-requests`, porque `"/v1/admin/access-requests"` no
  empieza por ese prefijo — son rutas distintas).
- `servicio_de_ruta("/v1/telemetry")` → no coincide con ningún prefijo → `None` (bloqueado por
  defecto, fail-closed).

- [ ] **Step 5: Commit**

```bash
git add crates/lumid/src/mantenimiento.rs crates/lumid/src/main.rs
git commit -m "feat: logica pura y middleware del modo mantenimiento"
```

---

### Task 3: Rutas de ajustes — extender `routes/security.rs` y activar el middleware

**Files:**
- Modify: `crates/lumid/src/routes/security.rs:12-36`
- Modify: `crates/lumid/src/main.rs` (capa de middleware, junto a `capa_zero_trust`)

**Interfaces:**
- Consumes: `crate::mantenimiento::*` (Task 2), `lumi_proto::api::{SecuritySettings,
  PatchSecurityReq}` (Task 1, ya ampliados).
- Produces: `/v1/admin/security` GET/PATCH ahora leen/escriben los cuatro campos nuevos —
  consumido por el cliente en Task 7.

- [ ] **Step 1: Ampliar `get_security` y `patch_security`**

En `crates/lumid/src/routes/security.rs`, reemplaza:

```rust
pub async fn get_security(State(app): State<App>, headers: HeaderMap) -> Result<Json<SecuritySettings>, StatusCode> {
    require_admin(&app, &bearer(&headers))?;
    Ok(Json(SecuritySettings {
        zero_trust: crate::zero_trust::zero_trust(&app),
        self_service_ip: crate::zero_trust::self_service_ip(&app),
        allowlist: crate::zero_trust::allowlist(&app),
        denylist: crate::zero_trust::denylist(&app),
    }))
}

pub async fn patch_security(
    State(app): State<App>,
    headers: HeaderMap,
    Json(req): Json<PatchSecurityReq>,
) -> Result<Json<SecuritySettings>, (StatusCode, String)> {
    require_admin(&app, &bearer(&headers)).map_err(|c| (c, "hace falta ser administrador".to_string()))?;
    if let Some(on) = req.zero_trust {
        crate::zero_trust::set_zero_trust(&app, on).map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    }
    if let Some(on) = req.self_service_ip {
        crate::zero_trust::set_self_service_ip(&app, on)
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    }
    get_security(State(app), headers).await.map_err(|c| (c, "no se pudo releer los ajustes".to_string()))
}
```

por:

```rust
pub async fn get_security(State(app): State<App>, headers: HeaderMap) -> Result<Json<SecuritySettings>, StatusCode> {
    require_admin(&app, &bearer(&headers))?;
    Ok(Json(SecuritySettings {
        zero_trust: crate::zero_trust::zero_trust(&app),
        self_service_ip: crate::zero_trust::self_service_ip(&app),
        allowlist: crate::zero_trust::allowlist(&app),
        denylist: crate::zero_trust::denylist(&app),
        maintenance: crate::mantenimiento::activo(&app),
        maintenance_message: crate::mantenimiento::mensaje(&app),
        maintenance_block_login: crate::mantenimiento::bloquea_login(&app),
        maintenance_services: crate::mantenimiento::servicios_habilitados(&app),
    }))
}

pub async fn patch_security(
    State(app): State<App>,
    headers: HeaderMap,
    Json(req): Json<PatchSecurityReq>,
) -> Result<Json<SecuritySettings>, (StatusCode, String)> {
    require_admin(&app, &bearer(&headers)).map_err(|c| (c, "hace falta ser administrador".to_string()))?;
    if let Some(on) = req.zero_trust {
        crate::zero_trust::set_zero_trust(&app, on).map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    }
    if let Some(on) = req.self_service_ip {
        crate::zero_trust::set_self_service_ip(&app, on)
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    }
    if let Some(on) = req.maintenance {
        crate::mantenimiento::set_activo(&app, on).map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    }
    if let Some(msg) = &req.maintenance_message {
        crate::mantenimiento::set_mensaje(&app, msg).map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    }
    if let Some(on) = req.maintenance_block_login {
        crate::mantenimiento::set_bloquea_login(&app, on)
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    }
    if let Some(ids) = &req.maintenance_services {
        crate::mantenimiento::set_servicios(&app, ids).map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    }
    get_security(State(app), headers).await.map_err(|c| (c, "no se pudo releer los ajustes".to_string()))
}
```

- [ ] **Step 2: Colgar el middleware en el router**

En `crates/lumid/src/main.rs`, encuentra:

```rust
    let capa_zero_trust = axum::middleware::from_fn_with_state(app.clone(), zero_trust::zero_trust_gate);
    let router = router.layer(capa_zero_trust).with_state(app);
```

Reemplaza por:

```rust
    let capa_zero_trust = axum::middleware::from_fn_with_state(app.clone(), zero_trust::zero_trust_gate);
    let capa_mantenimiento = axum::middleware::from_fn_with_state(app.clone(), mantenimiento::mantenimiento_gate);
    let router = router.layer(capa_zero_trust).layer(capa_mantenimiento).with_state(app);
```

- [ ] **Step 3: Verificar que compila**

Run:
```bash
cargo build -p lumid
```
Expected: compila limpio.

- [ ] **Step 4: Verificar manualmente contra un daemon corriendo**

Con `lumid` corriendo y `$TOKEN` una sesión de administrador:

```bash
curl -sk https://localhost:7717/v1/admin/security -H "Authorization: Bearer $TOKEN"
```
Expected: incluye `"maintenance":false,"maintenance_message":"","maintenance_block_login":false,"maintenance_services":[]`.

```bash
curl -sk -X PATCH https://localhost:7717/v1/admin/security \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"maintenance":true,"maintenance_message":"prueba","maintenance_services":["mapa"]}'
```
Expected: `"maintenance":true,"maintenance_message":"prueba",...,"maintenance_services":["mapa"]`.

Con el modo aún activo desde el paso anterior, prueba una ruta de un servicio NO habilitado sin
token (o con un token cualquiera no-admin):

```bash
curl -sk https://localhost:7717/v1/admin/models -H "Authorization: Bearer $TOKEN_NO_ADMIN"
```
Expected: `503`, cuerpo `prueba` (el mensaje configurado). Con el mismo token pero contra
`/v1/map/themes` (el servicio SÍ habilitado): expected `200 OK`. Con `$TOKEN` (admin): cualquiera
de las dos responde con normalidad, mantenimiento o no.

Por último, vuelve a apagarlo para no dejar el servidor de desarrollo bloqueado:
```bash
curl -sk -X PATCH https://localhost:7717/v1/admin/security \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"maintenance":false}'
```

- [ ] **Step 5: Commit**

```bash
git add crates/lumid/src/routes/security.rs crates/lumid/src/main.rs
git commit -m "feat: ajustes de modo mantenimiento en /v1/admin/security y activa el middleware"
```

---

### Task 4: Bloqueo de login para no-admins

**Files:**
- Modify: `crates/lumid/src/routes/auth.rs:48-92`

**Interfaces:**
- Consumes: `crate::mantenimiento::{activo, bloquea_login}` (Task 2).

- [ ] **Step 1: Añadir el chequeo tras verificar bloqueo, antes de crear sesión**

En `crates/lumid/src/routes/auth.rs`, dentro de `login()`, encuentra:

```rust
    if blocked == 1 {
        return Err((
            StatusCode::FORBIDDEN,
            "esta cuenta está bloqueada; habla con el administrador".into(),
        ));
    }

    let device_id = req.device.as_ref().and_then(|d| upsert_device(&c, id, d));
```

Inserta entre ambos bloques:

```rust
    if blocked == 1 {
        return Err((
            StatusCode::FORBIDDEN,
            "esta cuenta está bloqueada; habla con el administrador".into(),
        ));
    }
    // Un admin siempre puede entrar, active o no este interruptor — si se
    // quedara fuera también él, nadie podría revertir el modo salvo tocando
    // la base de datos a mano.
    if is_admin != 1 && crate::mantenimiento::activo(&app) && crate::mantenimiento::bloquea_login(&app) {
        return Err((
            StatusCode::SERVICE_UNAVAILABLE,
            "el servidor está en mantenimiento; el login está temporalmente bloqueado".into(),
        ));
    }

    let device_id = req.device.as_ref().and_then(|d| upsert_device(&c, id, d));
```

- [ ] **Step 2: Verificar que compila**

Run:
```bash
cargo build -p lumid
```
Expected: compila limpio.

- [ ] **Step 3: Verificar manualmente**

Con `$TOKEN` admin y un usuario no-admin `ana`/`contraseña` ya existente:

```bash
curl -sk -X PATCH https://localhost:7717/v1/admin/security \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"maintenance":true,"maintenance_block_login":true}'

curl -sk -X POST https://localhost:7717/v1/auth/login \
  -H "Content-Type: application/json" -d '{"username":"ana","password":"contraseña"}'
```
Expected: `503`, cuerpo con "login está temporalmente bloqueado". Repite el login con las
credenciales del propio admin: expected `200 OK` con un token nuevo. Vuelve a apagar el modo:

```bash
curl -sk -X PATCH https://localhost:7717/v1/admin/security \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"maintenance":false,"maintenance_block_login":false}'
```

- [ ] **Step 4: Commit**

```bash
git add crates/lumid/src/routes/auth.rs
git commit -m "feat: bloqueo de login para no-admins durante mantenimiento"
```

---

### Task 5: Cliente — tipos, animaciones nuevas

**Files:**
- Modify: `client/src/lib/api.ts:59-62`
- Modify: `client/src/index.css` (nuevo `@keyframes`, junto a los demás `jg-*`)

**Interfaces:**
- Produces: `SecuritySettings` (TS) ampliado — consumido por Task 6 (`SecurityView.tsx`) y Task 7
  (`MantenimientoBanner.tsx`, `AdminPanel.tsx`). Produces `@keyframes jg-maint-stripes` — consumido
  por Task 7.

- [ ] **Step 1: Ampliar la interfaz TS**

En `client/src/lib/api.ts`, reemplaza:

```ts
export interface SecuritySettings {
  zero_trust: boolean; self_service_ip: boolean;
  allowlist: string[]; denylist: string[];
}
```

por:

```ts
export interface SecuritySettings {
  zero_trust: boolean; self_service_ip: boolean;
  allowlist: string[]; denylist: string[];
  maintenance: boolean; maintenance_message: string;
  maintenance_block_login: boolean; maintenance_services: string[];
}
```

- [ ] **Step 2: Verificar que el cliente typechecka**

Run:
```bash
cd client && npx tsc -b
```
Expected: sin errores nuevos (los consumidores de `SecuritySettings` se actualizan en las
Tasks 6-7; este paso solo confirma que el tipo en sí es válido).

- [ ] **Step 3: Añadir la animación de la tira**

En `client/src/index.css`, junto a los `@keyframes jg-*` existentes (cerca de la línea 55, donde
está `jg-alert-pulse`), añade:

```css
@keyframes jg-maint-stripes { from { background-position: 0 0; } to { background-position: -40px 0; } }
```

- [ ] **Step 4: Commit**

```bash
git add client/src/lib/api.ts client/src/index.css
git commit -m "feat: tipos de modo mantenimiento y animacion de la tira de aviso"
```

---

### Task 6: `SecurityView.tsx` — bloque de modo mantenimiento

**Files:**
- Modify: `client/src/admin/SecurityView.tsx` (reescritura completa — el fichero es pequeño y el
  bloque nuevo toca `fijar`, el estado local, y el JSX de raíz; más claro reemplazarlo entero que
  parchear fragmentos)

**Interfaces:**
- Consumes: `SecuritySettings` (Task 5), `Fila`/`SubFila` (ya existen en este mismo fichero, sin
  cambios).
- Produces: sin cambio de firma — `<SecurityView token={string} />` sigue igual, ya conectado en
  `AdminPanel.tsx`.

- [ ] **Step 1: Reemplazar el fichero entero**

Create (sobrescribiendo) `client/src/admin/SecurityView.tsx`:

```tsx
import { useEffect, useState } from "react";
import { api, type SecuritySettings } from "../lib/api";
import { Seccion } from "./AdminPanel";

const SERVICIOS: { id: string; label: string }[] = [
  { id: "modelos", label: "Modelos" },
  { id: "indices", label: "Índices" },
  { id: "mapa", label: "Customización" },
  { id: "cola", label: "Cola" },
  { id: "proyectos", label: "Proyectos y casos" },
  { id: "personas", label: "Personas" },
  { id: "claves", label: "API Keys" },
];

/** El interruptor de Zero Trust y sus opciones dependientes, y el de modo
 *  mantenimiento con las suyas — mismo patrón de despliegue para ambos: el
 *  interruptor de arriba muestra u oculta lo que solo tiene sentido con él
 *  activado, en vez de dejarlo ahí atenuado todo el tiempo. Las listas
 *  globales de IP viven en API Keys — junto a la tabla de claves que
 *  gobiernan, no aquí. */
export function SecurityView({ token }: { token: string }) {
  const [ajustes, setAjustes] = useState<SecuritySettings | null>(null);
  const [mensaje, setMensaje] = useState("");

  useEffect(() => {
    void api.get<SecuritySettings>("/v1/admin/security", token).then(setAjustes);
  }, [token]);

  useEffect(() => {
    if (ajustes) setMensaje(ajustes.maintenance_message);
  }, [ajustes?.maintenance_message]);

  async function fijar(patch: Partial<Pick<SecuritySettings,
    "zero_trust" | "self_service_ip" | "maintenance" | "maintenance_message"
    | "maintenance_block_login" | "maintenance_services"
  >>) {
    const r = await api.patch<SecuritySettings>("/v1/admin/security", patch, token);
    setAjustes(r);
  }

  async function alternarServicio(id: string, estaActivo: boolean) {
    if (!ajustes) return;
    const next = estaActivo
      ? ajustes.maintenance_services.filter((s) => s !== id)
      : [...ajustes.maintenance_services, id];
    await fijar({ maintenance_services: next });
  }

  if (!ajustes) return <Seccion titulo="Seguridad" grupo="Servidor"><p className="text-[11px] text-muted">cargando</p></Seccion>;

  return (
    <Seccion titulo="Seguridad" grupo="Servidor">
      <p className="text-[11px] text-muted">Quién puede llamar a la API, y desde dónde.</p>

      <div className="mt-4 rounded-card border border-border bg-panel">
        <Fila
          titulo="Modo Zero Trust"
          sub="Solo IPs autorizadas por clave. Bloqueadas siempre ganan."
          on={ajustes.zero_trust}
          onClick={() => void fijar({ zero_trust: !ajustes.zero_trust })}
        />
        {/* `grid-template-rows: 0fr → 1fr` anima el alto sin conocerlo de
            antemano — hace falta para un contenido que va a crecer según se
            añadan más opciones aquí dentro. */}
        <div className="grid transition-[grid-template-rows] duration-[420ms] ease-expo"
          style={{ gridTemplateRows: ajustes.zero_trust ? "1fr" : "0fr" }}>
          <div className="overflow-hidden">
            <div className="border-t border-border bg-black/15 pl-6">
              <SubFila
                titulo="Autoservicio de IP"
                sub={ajustes.self_service_ip ? "Cada usuario gestiona la IP de sus propias claves." : "Solo un admin puede tocarla."}
                on={ajustes.self_service_ip}
                onClick={() => void fijar({ self_service_ip: !ajustes.self_service_ip })}
              />
              {/* Próximas opciones de Zero Trust (clases de dispositivo por
                  defecto, expiración forzada de claves, etc.) van aquí, no en
                  una fila hermana nueva — este es el hueco pensado para eso. */}
            </div>
          </div>
        </div>
      </div>

      <div className="mt-4 rounded-card border border-border bg-panel">
        <Fila
          titulo="Modo mantenimiento"
          sub="Bloquea la API salvo lo que actives abajo. Los administradores nunca se quedan fuera."
          on={ajustes.maintenance}
          onClick={() => void fijar({ maintenance: !ajustes.maintenance })}
        />
        <div className="grid transition-[grid-template-rows] duration-[420ms] ease-expo"
          style={{ gridTemplateRows: ajustes.maintenance ? "1fr" : "0fr" }}>
          <div className="overflow-hidden">
            <div className="border-t border-border bg-black/15 p-[13px_16px_16px]">
              <label className="mb-1.5 block text-[9.5px] uppercase tracking-[.06em] text-muted">
                Mensaje de la tira de aviso
              </label>
              <textarea
                value={mensaje}
                onChange={(e) => setMensaje(e.target.value)}
                onBlur={() => { if (mensaje !== ajustes.maintenance_message) void fijar({ maintenance_message: mensaje }); }}
                placeholder="Servidor en mantenimiento."
                rows={2}
                className="mb-3 w-full resize-y rounded-lg border border-border bg-elevated px-2.5 py-2
                  text-[11px] text-fg outline-none focus:border-white/40"
              />
              <SubFila
                titulo="Bloquear login de usuarios"
                sub="Los administradores siempre pueden entrar, esté esto activo o no."
                on={ajustes.maintenance_block_login}
                onClick={() => void fijar({ maintenance_block_login: !ajustes.maintenance_block_login })}
              />
              <p className="mb-2 mt-3.5 text-[9.5px] uppercase tracking-[.06em] text-muted">
                Servicios habilitados durante el mantenimiento
              </p>
              <div className="grid grid-cols-2 gap-1.5">
                {SERVICIOS.map((s) => {
                  const on = ajustes.maintenance_services.includes(s.id);
                  return (
                    <button key={s.id} onClick={() => void alternarServicio(s.id, on)}
                      className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-[10.5px]
                        transition-colors duration-200 ${on ? "border-white/30 bg-white/[.06] text-fg" : "border-border text-muted"}`}>
                      <span className={`h-[6px] w-[6px] rounded-full ${on ? "bg-fg" : "bg-subtle"}`} />
                      {s.label}
                    </button>
                  );
                })}
              </div>
              <p className="mt-3 text-[9px] leading-relaxed text-subtle">
                Todo lo demás queda en 503 con el mensaje de arriba. Nada se bloquea en silencio.
              </p>
            </div>
          </div>
        </div>
      </div>
    </Seccion>
  );
}

/** Como `Fila`, pero para una opción que vive DENTRO de otro interruptor:
 *  algo más compacta y sin el atenuado por `disabled` — si se ve, ya está
 *  disponible, el propio despliegue es la condición. */
function SubFila({ titulo, sub, on, onClick }: {
  titulo: string; sub: string; on: boolean; onClick: () => void;
}) {
  return (
    <div className="flex items-center gap-3.5 border-t border-border/60 p-[11px_16px] first:border-t-0">
      <button
        onClick={onClick}
        className={`relative h-[19px] w-8 shrink-0 cursor-pointer rounded-full border transition-colors duration-300 ease-expo ${
          on ? "border-white/30 bg-white/[.14]" : "border-border bg-elevated"
        }`}
      >
        <span className={`absolute left-[2px] top-[2px] h-[13px] w-[13px] rounded-full transition-transform duration-300 ease-expo ${
          on ? "translate-x-[13px] bg-fg" : "bg-subtle"
        }`} />
      </button>
      <div className="min-w-0">
        <p className="text-[11.5px] text-fg">{titulo}</p>
        <p className="mt-0.5 text-[9.5px] text-subtle">{sub}</p>
      </div>
    </div>
  );
}

function Fila({ titulo, sub, on, onClick }: {
  titulo: string; sub: string; on: boolean; onClick: () => void;
}) {
  return (
    <div className="flex items-center gap-3.5 border-b border-border p-[13px_16px] last:border-b-0">
      <button
        onClick={onClick}
        className={`relative h-[21px] w-9 shrink-0 cursor-pointer rounded-full border transition-colors duration-300 ease-expo ${
          on ? "border-white/30 bg-white/[.14]" : "border-border bg-elevated"
        }`}
      >
        <span className={`absolute left-[2px] top-[2px] h-[15px] w-[15px] rounded-full transition-transform duration-300 ease-expo ${
          on ? "translate-x-[15px] bg-fg" : "bg-subtle"
        }`} />
      </button>
      <div className="min-w-0">
        <p className="text-[12px] text-fg">{titulo}</p>
        <p className="mt-0.5 text-[10px] text-subtle">{sub}</p>
      </div>
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

- [ ] **Step 3: Commit**

```bash
git add client/src/admin/SecurityView.tsx
git commit -m "feat: bloque de modo mantenimiento en SecurityView"
```

---

### Task 7: Tira de aviso — `MantenimientoBanner.tsx` y conexión en `AdminPanel.tsx`

**Files:**
- Create: `client/src/admin/MantenimientoBanner.tsx`
- Modify: `client/src/admin/AdminPanel.tsx`

**Interfaces:**
- Consumes: `Icon` (existente, nombre `"alert"`), `@keyframes jg-maint-stripes`/`jg-alert-pulse`
  (Task 5 / ya existente).
- Produces: `<MantenimientoBanner mensaje={string} />` — montado condicionalmente en
  `AdminPanel.tsx` cuando `maintenance` es `true`.

- [ ] **Step 1: Escribir el componente**

Create `client/src/admin/MantenimientoBanner.tsx`:

```tsx
import { Icon } from "../ui/Icon";

/** Rayas diagonales deslizándose despacio — la lectura visual es "cinta de
 *  obra en movimiento", no decoración: mientras se mueve, el modo sigue
 *  activo. Reutiliza `jg-alert-pulse` (ya existe en index.css) para el
 *  pulso del icono en vez de definir una animación nueva para eso. */
export function MantenimientoBanner({ mensaje }: { mensaje: string }) {
  return (
    <div
      className="relative flex shrink-0 items-center gap-2.5 border-b border-warning/25 px-4 py-2 text-[11px] text-warning-fg"
      style={{
        backgroundImage: "repeating-linear-gradient(135deg, rgba(239,159,39,.16) 0 10px, rgba(239,159,39,.05) 10px 20px)",
        backgroundColor: "rgba(239,159,39,.06)",
        animation: "jg-maint-stripes 3.5s linear infinite",
      }}
    >
      <span style={{ animation: "jg-alert-pulse 2.4s ease-in-out infinite" }}>
        <Icon name="alert" size={13} />
      </span>
      <b className="font-medium text-fg">Mantenimiento</b>
      <span className="truncate">{mensaje.trim() || "Servidor en mantenimiento."}</span>
    </div>
  );
}
```

- [ ] **Step 2: Montarlo en `AdminPanel.tsx`**

En `client/src/admin/AdminPanel.tsx`, añade el import junto a los demás:

```tsx
import { MantenimientoBanner } from "./MantenimientoBanner";
```

Añade el estado y su carga, junto al `useEffect` de `cuentas` que ya existe:

```tsx
  const [mantenimiento, setMantenimiento] = useState<{ activo: boolean; mensaje: string } | null>(null);

  useEffect(() => {
    api.get<import("../lib/api").SecuritySettings>("/v1/admin/security", token)
      .then((r) => setMantenimiento({ activo: r.maintenance, mensaje: r.maintenance_message }))
      .catch(() => setMantenimiento(null));
  }, [token]);
```

Cambia el `return` para envolver el sidebar y el contenido en un contenedor que deje sitio a la
tira por encima del contenido (no por encima del sidebar). Reemplaza:

```tsx
  return (
    <div className="relative z-10 grid h-full w-full grid-cols-[206px_1fr] overflow-hidden bg-bg">
      <Sidebar actual={seccion} onIr={setSeccion} contadores={cuentas} />
      <div key={seccion} className="overflow-y-auto"
        style={{ animation: "jg-fade-rise .5s cubic-bezier(.16,1,.3,1) both" }}>
```

por:

```tsx
  return (
    <div className="relative z-10 grid h-full w-full grid-cols-[206px_1fr] overflow-hidden bg-bg">
      <Sidebar actual={seccion} onIr={setSeccion} contadores={cuentas} />
      <div className="flex h-full min-h-0 flex-col overflow-hidden">
        {mantenimiento?.activo && <MantenimientoBanner mensaje={mantenimiento.mensaje} />}
        <div key={seccion} className="overflow-y-auto"
          style={{ animation: "jg-fade-rise .5s cubic-bezier(.16,1,.3,1) both" }}>
```

Y cierra la nueva `<div>` extra: encuentra el cierre existente de la columna de contenido (el
`</div>` inmediatamente antes de `<div className="pointer-events-none fixed bottom-4 right-4...`)
y añade un `</div>` más antes de él:

```tsx
                </Seccion>}
        </div>
      </div>
      <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col gap-2.5" style={{ width: 308 }}>
```

- [ ] **Step 3: Verificar que typechecka y renderiza**

Run:
```bash
cd client && npx tsc -b && npm run tauri dev
```
Manual: entra al panel de administración con Zero Trust/mantenimiento apagados — sin tira. Ve a
Seguridad, activa "Modo mantenimiento" con un mensaje escrito; sal a otra sección (p.ej.
Modelos) — la tira debe seguir visible arriba, con las rayas deslizándose y el icono pulsando,
mostrando el mensaje configurado. Apágalo — la tira desaparece de nuevo. (Nota: la tira de
`AdminPanel.tsx` solo se actualiza al cambiar de token/recargar, igual que los contadores de
`cuentas` — es el mismo patrón ya existente, no una regresión.)

- [ ] **Step 4: Commit**

```bash
git add client/src/admin/MantenimientoBanner.tsx client/src/admin/AdminPanel.tsx
git commit -m "feat: tira de aviso de mantenimiento en el panel de administracion"
```

---

### Task 8: Quitar "Mantenimiento" del sidebar

**Files:**
- Modify: `client/src/admin/Sidebar.tsx:5-8,32-40`
- Modify: `client/src/admin/AdminPanel.tsx:18`
- Modify: `client/src/admin/Hueco.tsx:3-7`

**Interfaces:**
- Ninguna nueva — esta tarea solo retira referencias a la sección `"mantenimiento"` que ya no
  lleva a ningún sitio (su control real vive en Seguridad desde la Task 6).

- [ ] **Step 1: Quitar `"mantenimiento"` del tipo `Seccion`**

En `client/src/admin/Sidebar.tsx`, cambia:

```ts
export type Seccion =
  | "resumen" | "modelos" | "personalizacion" | "indices" | "seguridad" | "claves"
  | "solicitudes" | "usuarios"
  | "cola" | "mantenimiento" | "notificaciones" | "hardware";
```

por:

```ts
export type Seccion =
  | "resumen" | "modelos" | "personalizacion" | "indices" | "seguridad" | "claves"
  | "solicitudes" | "usuarios"
  | "cola" | "notificaciones" | "hardware";
```

- [ ] **Step 2: Quitar la entrada de `GRUPOS`**

En el mismo fichero, dentro del grupo `"Operación"`, cambia:

```ts
  {
    grupo: "Operación",
    items: [
      { id: "cola", label: "Cola", icon: "bars" },
      { id: "mantenimiento", label: "Mantenimiento", icon: "wrench", pronto: true },
      { id: "notificaciones", label: "Notificaciones", icon: "bell", pronto: true },
      { id: "hardware", label: "Hardware", icon: "device", pronto: true },
    ],
  },
```

por:

```ts
  {
    grupo: "Operación",
    items: [
      { id: "cola", label: "Cola", icon: "bars" },
      { id: "notificaciones", label: "Notificaciones", icon: "bell", pronto: true },
      { id: "hardware", label: "Hardware", icon: "device", pronto: true },
    ],
  },
```

- [ ] **Step 3: Quitar `"mantenimiento"` de `PRONTO` en `AdminPanel.tsx`**

En `client/src/admin/AdminPanel.tsx`, cambia:

```tsx
const PRONTO: Seccion[] = ["mantenimiento", "notificaciones", "hardware"];
```

por:

```tsx
const PRONTO: Seccion[] = ["notificaciones", "hardware"];
```

- [ ] **Step 4: Quitar la entrada de `Hueco.tsx`**

En `client/src/admin/Hueco.tsx`, cambia:

```tsx
const QUE: Record<string, { titulo: string; grupo: string; ciclo: string; que: string }> = {
  mantenimiento: {
    titulo: "Mantenimiento", grupo: "Operación", ciclo: "ciclo 3c",
    que: "Poner el servidor en MAINTENANCE sin pararlo.",
  },
  notificaciones: {
```

por:

```tsx
const QUE: Record<string, { titulo: string; grupo: string; ciclo: string; que: string }> = {
  notificaciones: {
```

- [ ] **Step 5: Verificar que typechecka**

Run:
```bash
cd client && npx tsc -b
```
Expected: sin errores — `wrench` deja de usarse en `Sidebar.tsx` pero sigue siendo un `IconName`
válido en `Icon.tsx` (no hace falta quitarlo de ahí, otros iconos del set tampoco se usan todos a
la vez).

- [ ] **Step 6: Commit**

```bash
git add client/src/admin/Sidebar.tsx client/src/admin/AdminPanel.tsx client/src/admin/Hueco.tsx
git commit -m "chore: quita la entrada de sidebar Mantenimiento (ahora vive dentro de Seguridad)"
```

---

### Task 9: Documentación

**Files:**
- Modify: `ARCHITECTURE.md`
- Modify: `FUTURO.md`

- [ ] **Step 1: Actualizar la línea de `MAINTENANCE` en `ARCHITECTURE.md`**

Busca:

```
MAINTENANCE   ortogonal: lo introduce el subsistema 3c
```

Reemplaza por:

```
MAINTENANCE   ortogonal: interruptor de admin en Seguridad — bloquea todo salvo el núcleo fijo
              y los servicios que el propio admin reactive (`crates/lumid/src/mantenimiento.rs`)
```

- [ ] **Step 2: Quitar "el modo mantenimiento" de la lista de pendientes en `FUTURO.md`**

Busca, bajo "### Panel de administración real":

```
Es el subsistema 3 y está planificado, no aparcado. Se anota aquí solo lo que se le ha ido
prometiendo por el camino: rediseñar desde cero las vistas provisionales de solicitudes y
usuarios del subsistema 2, la fila de configuración del mapa del subsistema 6, las
notificaciones redactadas por el admin, el modo mantenimiento
```

Reemplaza por (quita solo la cláusula ya hecha, deja el resto igual):

```
Es el subsistema 3 y está planificado, no aparcado. Se anota aquí solo lo que se le ha ido
prometiendo por el camino: rediseñar desde cero las vistas provisionales de solicitudes y
usuarios del subsistema 2, la fila de configuración del mapa del subsistema 6, las
notificaciones redactadas por el admin
```

- [ ] **Step 3: Commit**

```bash
git add ARCHITECTURE.md FUTURO.md
git commit -m "docs: modo mantenimiento implementado (ARCHITECTURE.md, FUTURO.md)"
```

---

## Self-Review Notes

- **Cobertura de la spec:** núcleo fijo + login especial (Task 2 `es_nucleo` + Task 4), servicios
  personalizables por prefijo de ruta (Task 2 `servicio_de_ruta`, incluye `/v1/analyses*` bajo
  `proyectos`, que la spec no listaba explícitamente pero pertenece al mismo grupo de rutas de
  casos/análisis), admin nunca bloqueado (Task 2 `mantenimiento_gate` + Task 4), mensaje
  personalizable (Task 1 `maintenance_message` + Task 6 textarea), esquema reusando `SecuritySettings`
  (Task 1/3), tira animada (Task 5 keyframe + Task 7 componente), quitar la entrada de sidebar
  (Task 8). Todo cubierto.
- **Sin placeholders:** cada paso de código de este plan trae el fichero completo o el diff
  exacto a aplicar — ninguno dice "similar a Zero Trust" sin más, aunque varias piezas se inspiren
  deliberadamente en su patrón (se cita explícitamente cuál y por qué en cada caso).
- **Consistencia de tipos:** `maintenance`/`maintenance_message`/`maintenance_block_login`/
  `maintenance_services` tienen el mismo nombre y tipo en `lumi-proto` (Task 1), `routes/security.rs`
  (Task 3), y el espejo TypeScript (Task 5) — usados sin renombrar en `SecurityView.tsx` (Task 6) y
  `AdminPanel.tsx` (Task 7). Los ids de servicio (`modelos`, `indices`, `mapa`, `cola`, `proyectos`,
  `personas`, `claves`) son idénticos en `servicio_de_ruta` (Task 2, backend) y `SERVICIOS` (Task 6,
  frontend) — si un id no coincide entre ambos, el toggle de esa fila no bloquearía ni desbloquearía
  nada de verdad.
