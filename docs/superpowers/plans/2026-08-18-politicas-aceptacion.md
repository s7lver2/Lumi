# Políticas de aceptación al crear cuenta — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** si el administrador lo activa desde Customización, quien está
creando una cuenta nueva (tras una solicitud de acceso aprobada) tiene que
leer y aceptar un documento antes de que el servidor cree la cuenta.

**Architecture:** un documento único (Tiptap JSON, mismo formato y editor
que los avisos) guardado como tres escalares en `meta`, expuesto por un
endpoint público (`GET /v1/policies`, sin autenticación — igual que
`/v1/hello`, porque quien todavía no tiene cuenta necesita leerlo) y uno de
administración (`GET/PATCH /v1/admin/policies`). `POST /v1/accounts` exige
`accepted_policies: true` cuando el gate está activo, y deja constancia con
un timestamp en la fila del usuario.

**Tech Stack:** Rust (axum, rusqlite), React/TypeScript (Tauri v2), mismo
`AvisoEditor` (Tiptap) ya usado por los avisos.

## Global Constraints

- **Spec de referencia:** `docs/superpowers/specs/2026-08-18-politicas-aceptacion-design.md`.
- **No tests salvo en `lumi-proto`** (convención del proyecto). Este plan no
  añade ninguno nuevo.
- **Un commit por tarea terminada.**
- Sin versionado: editar el texto después no invalida lo ya aceptado (según
  spec).
- El gate NO aplica al wizard del owner — solo a `ResolvedScreen.tsx`.

---

### Task 1: Tipos en `lumi-proto`

**Files:**
- Modify: `crates/lumi-proto/src/api.rs:421-424` (struct `AccountReq`)
- Modify: `crates/lumi-proto/src/api.rs` (nuevas structs, junto a `PatchSecurityReq`)

**Interfaces:**
- Produce: `AccountReq.accepted_policies: bool`, `PatchPoliciesReq { active: Option<bool>, title: Option<String>, content: Option<serde_json::Value> }`.

- [ ] **Step 1: Extender `AccountReq`**

En `crates/lumi-proto/src/api.rs`, sustituir (línea 421-424):

```rust
pub struct AccountReq {
    pub username: String,
    pub password: String,
}
```

por:

```rust
pub struct AccountReq {
    pub username: String,
    pub password: String,
    /// Solo importa si las políticas de aceptación están activas (ver
    /// `politicas::activo`). `#[serde(default)]` para que un cliente viejo
    /// que todavía no manda este campo no rompa la deserialización — el
    /// servidor lo trata igual que si viniera `false`.
    #[serde(default)]
    pub accepted_policies: bool,
}
```

- [ ] **Step 2: Añadir `PatchPoliciesReq`**

En `crates/lumi-proto/src/api.rs`, junto a `PatchSecurityReq` (tras su
`}` de cierre, línea ~181), añadir:

```rust
#[derive(Debug, Deserialize)]
pub struct PatchPoliciesReq {
    pub active: Option<bool>,
    pub title: Option<String>,
    pub content: Option<serde_json::Value>,
}
```

- [ ] **Step 3: Compilar**

Run: `cargo build -p lumi-proto`
Expected: compila. (Nada más en el workspace construye `AccountReq` con
`Default` implícito de por medio, así que el nuevo campo no rompe ningún
sitio que ya la usara — solo `access.rs::create_account`, que se toca en la
Task 4.)

- [ ] **Step 4: Commit**

```bash
git add crates/lumi-proto/src/api.rs
git commit -m "feat: tipos de políticas de aceptación en lumi-proto"
```

---

### Task 2: Módulo `politicas.rs` en `lumid` + columna de auditoría

**Files:**
- Create: `crates/lumid/src/politicas.rs`
- Modify: `crates/lumid/src/main.rs` (añadir `mod politicas;`)
- Modify: `crates/lumid/src/store.rs:350-402` (función `migrate`)

**Interfaces:**
- Produce: `politicas::Settings { active: bool, title: String, content: serde_json::Value }`,
  `politicas::leer(&Store) -> Settings`, `politicas::activo(&Store) -> bool`,
  `politicas::set_active/set_title/set_content(&Store, ...) -> anyhow::Result<()>`.

- [ ] **Step 1: Escribir `crates/lumid/src/politicas.rs`**

```rust
//! El documento que se muestra al crear una cuenta nueva, si el admin lo
//! activa. Mismo patrón que `mantenimiento.rs`/`red.rs`: escalares sueltos
//! en `meta` — es un único documento, no una lista que merezca tabla propia.

use crate::store::Store;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Settings {
    pub active: bool,
    pub title: String,
    /// Documento Tiptap JSON, mismo formato que `avisos.contenido`.
    pub content: serde_json::Value,
}

fn doc_vacio() -> serde_json::Value {
    serde_json::json!({ "type": "doc", "content": [{ "type": "paragraph" }] })
}

pub fn leer(store: &Store) -> Settings {
    Settings {
        active: activo(store),
        title: store.get_meta("politicas_titulo").unwrap_or_default(),
        content: store
            .get_meta("politicas_contenido")
            .and_then(|v| serde_json::from_str(&v).ok())
            .unwrap_or_else(doc_vacio),
    }
}

/// Aparte de `leer`: `access.rs::create_account` solo necesita saber si el
/// gate está activo, no el documento entero.
pub fn activo(store: &Store) -> bool {
    store.get_meta("politicas_activas").as_deref() == Some("1")
}

pub fn set_active(store: &Store, on: bool) -> anyhow::Result<()> {
    store.set_meta("politicas_activas", if on { "1" } else { "0" })
}

pub fn set_title(store: &Store, title: &str) -> anyhow::Result<()> {
    store.set_meta("politicas_titulo", title)
}

pub fn set_content(store: &Store, content: &serde_json::Value) -> anyhow::Result<()> {
    store.set_meta("politicas_contenido", &serde_json::to_string(content)?)
}
```

- [ ] **Step 2: Registrar el módulo en `main.rs`**

En `crates/lumid/src/main.rs`, añadir `mod politicas;` junto al resto de
`mod` (orden alfabético, tras `mod master;` y antes de `mod projects;` —
sigue el orden que ya haya en el fichero).

- [ ] **Step 3: Añadir la columna de auditoría a `migrate()`**

En `crates/lumid/src/store.rs`, dentro de la lista de `migrate()` (línea
350-402), añadir al final del array, justo antes del `]`:

```rust
        // Cuándo aceptó el documento de políticas al crear su cuenta. Nulo
        // significa "el gate no estaba activo cuando se creó" — no que
        // rechazara nada, no hay nada que rechazar en un `INSERT`.
        ("users", "accepted_policies_at", "INTEGER"),
    ] {
```

(Sustituye la línea `("sessions", "token_prefix", "TEXT"),` seguida de `]
{` — añade la nueva tupla justo después de esa línea, antes del cierre del
array.)

- [ ] **Step 4: Compilar**

Run: `cargo build -p lumid`
Expected: compila.

- [ ] **Step 5: Commit**

```bash
git add crates/lumid/src/politicas.rs crates/lumid/src/main.rs crates/lumid/src/store.rs
git commit -m "feat: módulo de políticas de aceptación + columna de auditoría en users"
```

---

### Task 3: Endpoints `/v1/policies` y `/v1/admin/policies`

**Files:**
- Create: `crates/lumid/src/routes/policies.rs`
- Modify: `crates/lumid/src/routes/mod.rs`
- Modify: `crates/lumid/src/main.rs` (registrar rutas)

**Interfaces:**
- Consume: `politicas::leer/set_active/set_title/set_content` (Task 2),
  `require_admin`, `bearer` (`crates/lumid/src/routes/auth.rs`),
  `lumi_proto::api::PatchPoliciesReq` (Task 1).
- Produce: `GET /v1/policies` (público) → `politicas::Settings`;
  `GET /v1/admin/policies` (admin) → `politicas::Settings`;
  `PATCH /v1/admin/policies` (admin, body `PatchPoliciesReq`) → `politicas::Settings`.

- [ ] **Step 1: Escribir `crates/lumid/src/routes/policies.rs`**

```rust
//! Documento de aceptación al crear cuenta. `GET /v1/policies` es público a
//! propósito, igual que `/v1/hello`: quien todavía no tiene cuenta necesita
//! poder leerlo antes de poder crear una.

use crate::routes::auth::{bearer, require_admin};
use crate::{politicas, App};
use axum::{extract::State, http::HeaderMap, http::StatusCode, Json};
use lumi_proto::api::PatchPoliciesReq;

pub async fn get_public(State(app): State<App>) -> Json<politicas::Settings> {
    Json(politicas::leer(&app.store))
}

pub async fn get_admin(
    State(app): State<App>,
    headers: HeaderMap,
) -> Result<Json<politicas::Settings>, StatusCode> {
    require_admin(&app, &bearer(&headers))?;
    Ok(Json(politicas::leer(&app.store)))
}

pub async fn patch(
    State(app): State<App>,
    headers: HeaderMap,
    Json(req): Json<PatchPoliciesReq>,
) -> Result<Json<politicas::Settings>, (StatusCode, String)> {
    require_admin(&app, &bearer(&headers)).map_err(|c| (c, "hace falta ser administrador".to_string()))?;
    if let Some(on) = req.active {
        politicas::set_active(&app.store, on).map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    }
    if let Some(title) = &req.title {
        politicas::set_title(&app.store, title).map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    }
    if let Some(content) = &req.content {
        politicas::set_content(&app.store, content).map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    }
    Ok(Json(politicas::leer(&app.store)))
}
```

- [ ] **Step 2: Registrar el módulo de rutas**

En `crates/lumid/src/routes/mod.rs`, añadir `pub mod policies;` en orden
alfabético (tras `pub mod network;`, antes de `pub mod projects;`).

- [ ] **Step 3: Registrar las rutas en `main.rs`**

En `crates/lumid/src/main.rs`, añadir junto a `/v1/hello` (ruta pública, cerca
de la línea 107):

```rust
        .route("/v1/policies", get(routes::policies::get_public))
```

Y junto a las rutas `/v1/admin/*` ya existentes (cerca de
`/v1/admin/network`, Task 4 del plan anterior):

```rust
        .route(
            "/v1/admin/policies",
            get(routes::policies::get_admin).patch(routes::policies::patch),
        )
```

- [ ] **Step 4: Compilar**

Run: `cargo build -p lumid`
Expected: compila.

- [ ] **Step 5: Probar a mano**

Con el daemon arrancado (`LUMI_DATA=/tmp/lumi-test-pol cargo run -p lumid`,
carpeta nueva vacía):
```bash
curl -sk https://127.0.0.1:7717/v1/policies
```
Expected: `{"active":false,"title":"","content":{"type":"doc","content":[{"type":"paragraph"}]}}`
— responde sin cabecera `Authorization`, confirmando que es pública.

- [ ] **Step 6: Commit**

```bash
git add crates/lumid/src/routes/policies.rs crates/lumid/src/routes/mod.rs crates/lumid/src/main.rs
git commit -m "feat: endpoints /v1/policies (público) y /v1/admin/policies"
```

---

### Task 4: `create_account` exige aceptación cuando el gate está activo

**Files:**
- Modify: `crates/lumid/src/routes/access.rs:186-231`

**Interfaces:**
- Consume: `politicas::activo` (Task 2), `AccountReq.accepted_policies` (Task 1).

- [ ] **Step 1: Añadir la comprobación tras la validación de contraseña**

En `crates/lumid/src/routes/access.rs`, dentro de `create_account`,
sustituir:

```rust
    let username = req.username.trim();
    if username.is_empty() || req.password.len() < 12 {
        return Err(err(
            StatusCode::BAD_REQUEST,
            "usuario vacío o contraseña de menos de 12 caracteres",
        ));
    }
    let phc = hash_password(&req.password)
        .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;

    let uid = {
        let c = app.store.conn();
        // El nombre ocupado NO consume el ticket: es una colisión, no un abuso.
        c.execute(
            "INSERT INTO users (username, display_name, password_phc, is_admin, created_at)
             VALUES (?1, ?2, ?3, 0, ?4)",
            rusqlite::params![username, row.display_name, phc, now()],
        )
        .map_err(|_| err(StatusCode::CONFLICT, "ese nombre de usuario ya existe"))?;
        let uid = c.last_insert_rowid();
        c.execute(
            "UPDATE access_requests SET status = 'consumed' WHERE id = ?1",
            [row.id],
        )
        .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;
        uid
    };
```

por:

```rust
    let username = req.username.trim();
    if username.is_empty() || req.password.len() < 12 {
        return Err(err(
            StatusCode::BAD_REQUEST,
            "usuario vacío o contraseña de menos de 12 caracteres",
        ));
    }
    if crate::politicas::activo(&app.store) && !req.accepted_policies {
        return Err(err(
            StatusCode::BAD_REQUEST,
            "hay que aceptar las políticas para crear la cuenta",
        ));
    }
    let phc = hash_password(&req.password)
        .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;
    // Nulo si el gate no estaba activo o no se aceptó nada que registrar —
    // no hay versión que comparar (ver spec), así que basta con la marca de
    // tiempo como evidencia de que hubo un paso de aceptación explícito.
    let accepted_at = req.accepted_policies.then(now);

    let uid = {
        let c = app.store.conn();
        // El nombre ocupado NO consume el ticket: es una colisión, no un abuso.
        c.execute(
            "INSERT INTO users (username, display_name, password_phc, is_admin, created_at, accepted_policies_at)
             VALUES (?1, ?2, ?3, 0, ?4, ?5)",
            rusqlite::params![username, row.display_name, phc, now(), accepted_at],
        )
        .map_err(|_| err(StatusCode::CONFLICT, "ese nombre de usuario ya existe"))?;
        let uid = c.last_insert_rowid();
        c.execute(
            "UPDATE access_requests SET status = 'consumed' WHERE id = ?1",
            [row.id],
        )
        .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;
        uid
    };
```

- [ ] **Step 2: Compilar**

Run: `cargo build -p lumid`
Expected: compila. (`Option<i64>` implementa `rusqlite::ToSql`, así que
`accepted_at` en los `params!` funciona igual con `Some`/`None`.)

- [ ] **Step 3: Probar a mano**

Con el gate desactivado (por defecto), el flujo de creación de cuenta de
siempre sigue funcionando exactamente igual (no hace falta repetir aquí los
pasos manuales de aprobar una solicitud — son los mismos que ya usabas antes
de este plan). Con el gate activo (`curl -X PATCH .../v1/admin/policies -d
'{"active":true}'` con sesión de admin) y una llamada a `/v1/accounts` sin
`accepted_policies`, confirma que responde `400` con el mensaje "hay que
aceptar las políticas para crear la cuenta".

- [ ] **Step 4: Commit**

```bash
git add crates/lumid/src/routes/access.rs
git commit -m "feat: create_account exige accepted_policies cuando el gate está activo"
```

---

### Task 5: Tipos y funciones de API en el cliente

**Files:**
- Modify: `client/src/lib/api.ts`

**Interfaces:**
- Produce: `PoliciesSettings`, `api.policiesPublic`, `api.policiesGet`, `api.policiesPatch`.

- [ ] **Step 1: Añadir el tipo**

En `client/src/lib/api.ts`, junto a `export interface SecuritySettings { ...
}`, añadir:

```typescript
export interface PoliciesSettings {
  active: boolean;
  title: string;
  /** Documento Tiptap JSON — opaco aquí, solo lo entiende `AvisoEditor`. */
  content: unknown;
}
```

- [ ] **Step 2: Añadir las funciones a `api`**

En `client/src/lib/api.ts`, dentro de `export const api = { ... }` (junto al
resto de funciones específicas al final), añadir:

```typescript
  policiesPublic: () => api.get<PoliciesSettings>("/v1/policies"),
  policiesGet: (token: string) => api.get<PoliciesSettings>("/v1/admin/policies", token),
  policiesPatch: (patch: Partial<PoliciesSettings>, token: string) =>
    api.patch<PoliciesSettings>("/v1/admin/policies", patch, token),
```

- [ ] **Step 3: Comprobar tipos**

Run: `cd client && npx tsc -b`
Expected: sin salida.

- [ ] **Step 4: Commit**

```bash
git add client/src/lib/api.ts
git commit -m "feat: tipos y funciones de API para políticas de aceptación"
```

---

### Task 6: Editor en Customización

**Files:**
- Create: `client/src/admin/PolicyRow.tsx`
- Modify: `client/src/admin/CustomizacionView.tsx`

**Interfaces:**
- Consume: `api.policiesGet`, `api.policiesPatch`, `PoliciesSettings` (Task 5);
  `AvisoEditor` (`client/src/admin/AvisoEditor.tsx`, ya existente, sin cambios).

- [ ] **Step 1: Escribir `client/src/admin/PolicyRow.tsx`**

```tsx
import { useEffect, useState } from "react";
import { api, type PoliciesSettings } from "../lib/api";
import { AvisoEditor } from "./AvisoEditor";

/** El documento que se muestra al crear una cuenta nueva, si está activo.
 *  Mismo editor que los avisos (`AvisoEditor`) — sin barra de formato propia
 *  que mantener. El interruptor se guarda al instante (es un solo booleano);
 *  título y contenido se acumulan en un borrador local y se guardan juntos
 *  con "Guardar cambios", igual que el compositor de avisos en
 *  `NotificacionesView`. */
export function PolicyRow({ token }: { token: string }) {
  const [cfg, setCfg] = useState<PoliciesSettings | null>(null);
  const [titulo, setTitulo] = useState("");
  const [contenido, setContenido] = useState<unknown>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.policiesGet(token)
      .then((c) => { setCfg(c); setTitulo(c.title); setContenido(c.content); })
      .catch((e) => setError(String(e)));
  }, [token]);

  async function alternar() {
    if (!cfg) return;
    setError(null);
    try {
      setCfg(await api.policiesPatch({ active: !cfg.active }, token));
    } catch (e) {
      setError(String(e));
    }
  }

  async function guardar() {
    setBusy(true); setError(null);
    try {
      const c = await api.policiesPatch({ title: titulo, content: contenido }, token);
      setCfg(c);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!cfg) return null;

  const cambiado = titulo !== cfg.title || JSON.stringify(contenido) !== JSON.stringify(cfg.content);

  return (
    <div className="mt-4 rounded-card border border-border p-3.5">
      <div className="flex items-center gap-3.5">
        <button onClick={() => void alternar()}
          className={`relative h-[21px] w-9 shrink-0 cursor-pointer rounded-full border transition-colors duration-300 ease-expo ${
            cfg.active ? "border-white/30 bg-white/[.14]" : "border-border bg-elevated"}`}>
          <span className={`absolute left-[2px] top-[2px] h-[15px] w-[15px] rounded-full transition-transform duration-300 ease-expo ${
            cfg.active ? "translate-x-[15px] bg-fg" : "bg-subtle"}`} />
        </button>
        <div className="min-w-0">
          <p className="text-[12.5px] text-fg">Políticas de aceptación</p>
          <p className="mt-0.5 text-[10px] text-subtle">
            Quien crea una cuenta nueva tiene que leer y aceptar este documento antes de poder entrar.
          </p>
        </div>
      </div>

      {cfg.active && (
        <div className="mt-3.5 border-t border-border pt-3">
          <label className="mb-1.5 block text-[9.5px] uppercase tracking-[.06em] text-muted">Título</label>
          <input value={titulo} onChange={(e) => setTitulo(e.target.value)}
            placeholder="Términos de uso"
            className="mb-3 w-full rounded-lg border border-border bg-elevated px-2.5 py-2 text-[11.5px] text-fg outline-none focus:border-white/40" />
          <label className="mb-1.5 block text-[9.5px] uppercase tracking-[.06em] text-muted">Contenido</label>
          <AvisoEditor contenido={contenido} onChange={setContenido} />
          <div className="mt-3 flex items-center gap-2">
            <button onClick={guardar} disabled={busy || !cambiado}
              className="jg-press rounded-lg bg-accent px-3.5 py-1.5 text-[11px] font-medium text-black disabled:opacity-40">
              Guardar cambios
            </button>
          </div>
        </div>
      )}
      {error && <p className="mt-2.5 text-[11px] text-danger-fg">{error}</p>}
    </div>
  );
}
```

- [ ] **Step 2: Añadirlo a `CustomizacionView.tsx`**

En `client/src/admin/CustomizacionView.tsx`, sustituir:

```tsx
import { MapRow } from "./MapRow";
import { Seccion } from "./AdminPanel";

/** Solo el tema de mapa y quién lo dibuja. La clave de Mapbox en sí vive en
 *  API Keys, junto al resto de credenciales de terceros. */
export function CustomizacionView({ token }: { token: string }) {
  return (
    <Seccion titulo="Customización" grupo="Servidor">
      <p className="text-[11px] text-muted">Qué mapa se dibuja y quién lo sirve.</p>
      <div className="mt-4">
        <MapRow token={token} />
      </div>
    </Seccion>
  );
}
```

por:

```tsx
import { MapRow } from "./MapRow";
import { PolicyRow } from "./PolicyRow";
import { Seccion } from "./AdminPanel";

/** El tema de mapa y quién lo dibuja, y el documento de aceptación al crear
 *  cuenta. La clave de Mapbox en sí vive en API Keys, junto al resto de
 *  credenciales de terceros. */
export function CustomizacionView({ token }: { token: string }) {
  return (
    <Seccion titulo="Customización" grupo="Servidor">
      <p className="text-[11px] text-muted">Qué mapa se dibuja, quién lo sirve, y qué hay que aceptar para entrar.</p>
      <div className="mt-4">
        <MapRow token={token} />
      </div>
      <PolicyRow token={token} />
    </Seccion>
  );
}
```

- [ ] **Step 3: Comprobar tipos**

Run: `cd client && npx tsc -b`
Expected: sin salida.

- [ ] **Step 4: Verificación manual**

Con `lumid` corriendo (Task 3) y `npm run tauri dev`: entrar como admin, ir a
Customización, activar el interruptor de políticas, escribir un título y
contenido, pulsar "Guardar cambios", recargar la página y confirmar que el
título y contenido persisten.

- [ ] **Step 5: Commit**

```bash
git add client/src/admin/PolicyRow.tsx client/src/admin/CustomizacionView.tsx
git commit -m "feat: editor de políticas de aceptación en Customización"
```

---

### Task 7: Gate en `ResolvedScreen.tsx`

**Files:**
- Modify: `client/src/entry/ResolvedScreen.tsx`

**Interfaces:**
- Consume: `api.policiesPublic`, `PoliciesSettings` (Task 5); `AvisoEditor`
  (modo lectura, `editable={false}`).

- [ ] **Step 1: Cargar el documento y añadir el estado de la casilla**

En `client/src/entry/ResolvedScreen.tsx`, añadir los imports y el estado
nuevo junto a los ya existentes (línea 1-12):

```typescript
import { useEffect, useState } from "react";
import { api, type AccessStatus, type PoliciesSettings } from "../lib/api";
import { loadSession, updateSession } from "../lib/session";
import { AvisoEditor } from "../admin/AvisoEditor";
import { Icon } from "../ui/Icon";
```

Y dentro del componente `ResolvedScreen`, junto al resto de `useState`
(línea 9-12):

```typescript
  const [politicas, setPoliticas] = useState<PoliciesSettings | null>(null);
  const [aceptado, setAceptado] = useState(false);

  useEffect(() => {
    api.policiesPublic().then(setPoliticas).catch(() => setPoliticas(null));
  }, []);
```

- [ ] **Step 2: Enviar `accepted_policies` al crear la cuenta**

En la función `create()` (línea 41-56), sustituir:

```typescript
  async function create() {
    const ticket = loadSession()?.ticket;
    if (!ticket) return;
    setBusy(true); setError(null);
    try {
      await api.ticketPost("/v1/accounts", { username: username.trim(), password }, ticket);
```

por:

```typescript
  async function create() {
    const ticket = loadSession()?.ticket;
    if (!ticket) return;
    setBusy(true); setError(null);
    try {
      await api.ticketPost("/v1/accounts", {
        username: username.trim(), password,
        accepted_policies: politicas?.active ? aceptado : undefined,
      }, ticket);
```

- [ ] **Step 3: Mostrar el documento y la casilla**

En el mismo fichero, dentro del `return` de la rama "aprobado" (tras el
bloque `<p className="mt-3 max-w-[54ch] ...">Mínimo 12 caracteres...</p>`,
línea 79-82, y antes del bloque `{error && (...)}`), añadir:

```tsx
      {politicas?.active && (
        <>
          <div className="my-3 h-px bg-border" />
          <p className="mb-2 text-[11px] font-medium text-fg">{politicas.title || "Políticas de aceptación"}</p>
          <div className="max-h-[160px] overflow-y-auto rounded-lg border border-border bg-[#0d0f12] p-2.5">
            <AvisoEditor contenido={politicas.content} editable={false} />
          </div>
          <button type="button" onClick={() => setAceptado(!aceptado)}
            className="mt-2.5 flex items-start gap-2 text-left text-[11px] text-muted">
            <span className={`mt-0.5 grid h-[15px] w-[15px] shrink-0 place-items-center rounded border transition-colors duration-200 ${
              aceptado ? "border-accent bg-accent" : "border-border"}`}>
              {aceptado && <Icon name="check" size={10} className="text-black" />}
            </span>
            He leído y acepto «{politicas.title || "estas políticas"}».
          </button>
        </>
      )}
```

- [ ] **Step 4: Bloquear el botón "Crear cuenta" hasta aceptar**

En el mismo fichero, el botón (línea 97-100):

```tsx
        <button onClick={create} disabled={busy || password.length < 12 || !username.trim()}
```

pasa a:

```tsx
        <button onClick={create}
          disabled={busy || password.length < 12 || !username.trim() || (!!politicas?.active && !aceptado)}
```

- [ ] **Step 5: Comprobar tipos**

Run: `cd client && npx tsc -b`
Expected: sin salida. (`accepted_policies: undefined` en el `post` es válido
— el body se serializa con `JSON.stringify`, que omite las claves
`undefined`; el servidor ya trata su ausencia como `false` gracias a
`#[serde(default)]` en la Task 1.)

- [ ] **Step 6: Verificación manual**

Con el gate activo (Task 6) y una solicitud de acceso aprobada, entra a
`ResolvedScreen`: el documento debe aparecer en solo lectura con la casilla
sin marcar, el botón "Crear cuenta" deshabilitado hasta marcarla, y al
crear la cuenta debe funcionar. Con el gate desactivado, el flujo se ve
exactamente igual que antes de este plan (nada se muestra).

- [ ] **Step 7: Commit**

```bash
git add client/src/entry/ResolvedScreen.tsx
git commit -m "feat: gate de aceptación de políticas al crear cuenta"
```

---

## Self-Review

**Cobertura de la spec:**
- §1 (almacenamiento) → Task 2.
- §2 (endpoints) → Task 3.
- §3 (admin en Customización) → Tasks 5, 6.
- §4 (creación de cuenta) → Tasks 1, 4, 7.
- Fuera de alcance (sin versionado, sin gate en el wizard, un solo
  documento) → respetado en todas las tareas; ninguna toca `AdminStep.tsx`
  ni el flujo del wizard.

**Placeholders:** ninguno — cada paso trae el código completo.

**Consistencia de tipos:** `politicas::Settings { active, title, content }`
(Rust, Task 2) ↔ `PoliciesSettings { active, title, content }` (TS, Task 5)
coinciden en nombre y forma. `AccountReq.accepted_policies: bool` (Rust,
Task 1) ↔ el campo `accepted_policies` enviado desde `ResolvedScreen.tsx`
(Task 7) coinciden. `PatchPoliciesReq` (Rust, Task 1) se usa en
`routes/policies.rs::patch` (Task 3) exactamente con los mismos tres campos
opcionales que `api.policiesPatch` (Task 5) puede enviar parcialmente.
