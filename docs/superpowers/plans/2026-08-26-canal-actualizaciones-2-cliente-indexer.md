# Canal de actualizaciones — 2. Aviso en Cliente e Indexer

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** El cliente Lumi y el Indexer comprueban al arrancar (y bajo demanda) si hay una versión más nueva firmada en el canal de actualizaciones, y lo avisan con una cinta discreta que no interrumpe nada.

**Architecture:** Un comando Tauri por app (`comprobar_actualizacion`) hace la petición HTTP con un cliente `reqwest` normal (con validación de CA estándar — no el cliente TLS anclado que usa el par cliente↔`lumid`, porque este habla con Vercel, no con el servidor emparejado), verifica la firma con `lumi_proto::actualizacion::Manifiesto::comprobar()`, y devuelve un estado serializable. El lado TypeScript lo llama una vez al montar la app y detrás de un botón manual, y pinta una cinta reutilizando el patrón ya existente de `MantenimientoBanner`.

**Tech Stack:** Rust (`reqwest`, ya presente en ambas apps), `lumi-proto` (Plan 1), React + TypeScript, `tauri-plugin-opener` (nuevo, para abrir el enlace de descarga en el navegador del sistema).

## Global Constraints

- **Depende del Plan 1** (`docs/superpowers/plans/2026-08-26-canal-actualizaciones-1-manifiesto.md`): `lumi_proto::actualizacion::{Manifiesto, Producto}` debe existir y compilar antes de empezar este plan.
- `VERSIONES_URL` apunta al despliegue de Vercel del Plan 1 (`web/`). Se define como constante `https://lumi-web.vercel.app/api/versiones` en cada app — si el dominio real difiere una vez desplegado, es un cambio de una línea en cada uno de los dos sitios donde se declara (Task 2 y Task 3 de este plan).
- **Sin red no es un error visible.** El comando Tauri sí puede devolver `Err` en ese caso (es la señal técnica correcta); es el lado TypeScript el que decide no pintar nada cuando la llamada falla — nunca una alarma roja por falta de conexión.
- **Firma inválida descarta el manifiesto entero.** `Manifiesto::comprobar()` devolviendo error se trata exactamente igual que "sin red": no hay estado intermedio de "quizá hay una versión nueva".
- El botón de descarga **no descarga ni instala nada** — abre la URL del artefacto en el navegador del sistema (`tauri-plugin-opener`). Instalar es responsabilidad del instalador Inno (Plan 4).
- Iconos: reutilizar los que ya existen en `client/src/ui/Icon.tsx` / `indexer/src/ui/Icon.tsx` (`refresh`, `alert`, `x`) — no dibujar nuevos.
- Colores: `draw`/`draw-fg` para "hay una versión nueva" (estado "en curso" de DESIGN.md), `warning`/`warning-fg` para "tu versión fue retirada". Nunca verde.
- No tests salvo en `lumi-proto` (ya cubierto en el Plan 1) — esta parte es integración Tauri/React, fuera de esa excepción.

---

### Task 1: Dependencia de `lumi-proto` en el Indexer

**Files:**
- Modify: `indexer/src-tauri/Cargo.toml`

**Interfaces:**
- Produces: acceso a `lumi_proto::actualizacion::*` desde `indexer/src-tauri`. Lo usa Task 3.

- [ ] **Step 1: Añadir la dependencia**

El cliente ya depende de `lumi-proto`; el Indexer hoy solo depende de `lumi-index`. Edita `indexer/src-tauri/Cargo.toml`, en `[dependencies]`, junto a `lumi-index`:

```toml
lumi-index = { path = "../../crates/lumi-index" }
lumi-proto = { path = "../../crates/lumi-proto" }
```

- [ ] **Step 2: Compilar**

```bash
cargo check -p indexer-app
```

(El nombre del paquete es `indexer-app` — confirmado en `[package] name` de `indexer/src-tauri/Cargo.toml`; si al ejecutar el comando `cargo` devuelve "package not found", lee el nombre real de ese archivo y ajusta.)

Expected: compila sin errores (todavía no se usa el crate, solo se declara).

- [ ] **Step 3: Commit**

```bash
git add indexer/src-tauri/Cargo.toml
git commit -m "chore: indexer depende de lumi-proto para el canal de actualizaciones"
```

---

### Task 2: Comando Tauri en el cliente

**Files:**
- Modify: `client/src-tauri/src/main.rs`
- Modify: `client/src-tauri/Cargo.toml`
- Modify: `client/src-tauri/capabilities/default.json`
- Modify: `client/package.json`

**Interfaces:**
- Consumes: `lumi_proto::actualizacion::{Manifiesto, Producto}` (Plan 1).
- Produces: comando Tauri `comprobar_actualizacion() -> Result<Option<EstadoActualizacion>, String>`, serializado como `{"tipo":"disponible","version":...,"notas":...,"url":...}` o `{"tipo":"retirada"}` o `null`. Lo consume Task 4 (TypeScript).

- [ ] **Step 1: Añadir `tauri-plugin-opener`**

Necesario para que "Ver y descargar" abra el navegador del sistema en vez de navegar dentro del propio webview. Edita `client/src-tauri/Cargo.toml`, añade a `[dependencies]`:

```toml
tauri-plugin-opener = "2"
```

Y en `client/package.json`, junto a las demás dependencias `@tauri-apps/*`:

```json
"@tauri-apps/plugin-opener": "^2",
```

```bash
cd client && npm install
```

- [ ] **Step 2: Permiso en la capability**

Edita `client/src-tauri/capabilities/default.json`, añade `"opener:default"` al array `permissions`:

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "enables the default permissions",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "dialog:default",
    "opener:default",
    "core:window:allow-minimize",
    "core:window:allow-toggle-maximize",
    "core:window:allow-is-maximized",
    "core:window:allow-close",
    "core:window:allow-start-dragging",
    "core:window:allow-start-resize-dragging"
  ]
}
```

- [ ] **Step 3: El comando**

Edita `client/src-tauri/src/main.rs`. Añade, junto a los demás `#[tauri::command]` (por ejemplo, justo antes de `fn client_for`):

```rust
/// URL del canal de actualizaciones (Plan 1 de la spec). Cliente `reqwest`
/// propio y NO el `PinnedVerifier` de arriba: eso habla con el servidor
/// `lumid` emparejado, esto habla con Vercel, que valida contra las CA del
/// sistema como cualquier sitio normal.
const VERSIONES_URL: &str = "https://lumi-web.vercel.app/api/versiones";

#[derive(serde::Serialize)]
#[serde(tag = "tipo", rename_all = "lowercase")]
enum EstadoActualizacion {
    Disponible { version: String, notas: String, url: String },
    Retirada,
}

/// `Err` significa "no se pudo comprobar" (sin red, manifiesto sin firmar o
/// con firma inválida) — el lado TS decide no pintar nada ante un error,
/// nunca una alarma. `Ok(None)` significa "se comprobó y no hay nada nuevo".
#[tauri::command]
async fn comprobar_actualizacion() -> Result<Option<EstadoActualizacion>, String> {
    let manifiesto: lumi_proto::actualizacion::Manifiesto = reqwest::Client::new()
        .get(VERSIONES_URL)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;
    manifiesto.comprobar().map_err(|e| e.to_string())?;

    let version_actual = env!("CARGO_PKG_VERSION");
    if manifiesto.version_retirada(lumi_proto::actualizacion::Producto::Cliente, version_actual) {
        return Ok(Some(EstadoActualizacion::Retirada));
    }
    let Some(publi) = manifiesto.mas_nueva(
        lumi_proto::actualizacion::Producto::Cliente,
        version_actual,
        "windows-x86_64",
    ) else {
        return Ok(None);
    };
    let url = publi
        .artefactos
        .iter()
        .find(|a| a.plataforma == "windows-x86_64")
        .map(|a| a.url.clone())
        .unwrap_or_default();
    Ok(Some(EstadoActualizacion::Disponible {
        version: publi.version.clone(),
        notas: publi.notas.clone(),
        url,
    }))
}
```

- [ ] **Step 4: Registrar el plugin y el comando**

Edita `client/src-tauri/src/main.rs`, dentro de `fn main()`:

```rust
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(Shared::default())
```

Y añade `comprobar_actualizacion` al final de la lista de `invoke_handler`:

```rust
        .invoke_handler(tauri::generate_handler![
            pair, pair_card, reconnect, request, start_telemetry, start_task_log,
            start_queue_events, start_indices_events, start_admin_events, start_logs_stream, set_auth,
            upload_images, read_image_as_data_url, upload_avatar_bytes, upload_server_avatar_bytes,
            upload_server_banner_bytes, comprobar_actualizacion
        ])
```

- [ ] **Step 5: Compilar**

```bash
cd client/src-tauri && cargo check
```

Expected: compila sin errores.

- [ ] **Step 6: Commit**

```bash
git add client/src-tauri/Cargo.toml client/src-tauri/src/main.rs client/src-tauri/capabilities/default.json client/package.json client/package-lock.json
git commit -m "feat: comando comprobar_actualizacion en el cliente"
```

---

### Task 3: Comando Tauri en el Indexer

**Files:**
- Create: `indexer/src-tauri/src/actualizacion.rs`
- Modify: `indexer/src-tauri/src/lib.rs`
- Modify: `indexer/src-tauri/Cargo.toml`
- Modify: `indexer/src-tauri/capabilities/default.json`
- Modify: `indexer/package.json`

**Interfaces:**
- Consumes: `lumi_proto::actualizacion::{Manifiesto, Producto}` (Plan 1, Task 1 de este plan).
- Produces: comando Tauri `comprobar_actualizacion() -> Result<Option<actualizacion::EstadoActualizacion>, String>`, mismo formato serializado que Task 2. Lo consume Task 5.

El Indexer separa comandos en módulos propios (`mod versions;`, `mod catalogo;`, etc. — a diferencia del cliente, que los tiene todos en `main.rs`); este módulo sigue esa misma convención. **Ojo:** el Indexer ya tiene un `mod versions;` que gestiona versiones de un *índice publicado* (`.lumidx`) — no tiene nada que ver con esto. Por eso el módulo nuevo se llama `actualizacion`, no `versions`, para no chocar ni confundir.

- [ ] **Step 1: `tauri-plugin-opener` e igual permiso que en el cliente**

Edita `indexer/src-tauri/Cargo.toml`, añade a `[dependencies]`:

```toml
tauri-plugin-opener = "2"
```

Edita `indexer/package.json`, añade junto a las demás dependencias `@tauri-apps/*`:

```json
"@tauri-apps/plugin-opener": "^2",
```

```bash
cd indexer && npm install
```

Edita `indexer/src-tauri/capabilities/default.json`, añade `"opener:default"`:

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "Permisos del Lumi Indexer",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "dialog:default",
    "opener:default",
    "core:window:allow-minimize",
    "core:window:allow-toggle-maximize",
    "core:window:allow-is-maximized",
    "core:window:allow-close",
    "core:window:allow-start-dragging",
    "core:window:allow-start-resize-dragging"
  ]
}
```

- [ ] **Step 2: El módulo**

Crea `indexer/src-tauri/src/actualizacion.rs`:

```rust
//! Comprobación de versión nueva contra el canal de actualizaciones — ver
//! `crates/lumi-proto/src/actualizacion.rs` para el formato y la firma.
//! Independiente de Lumi: el Indexer se publica y se comprueba aparte.

use lumi_proto::actualizacion::{Manifiesto, Producto};

/// Misma URL que el cliente (`client/src-tauri/src/main.rs`) — duplicada a
/// propósito, no compartida por una constante en `lumi-proto`, porque es
/// configuración de red de cada app, no parte del protocolo.
const VERSIONES_URL: &str = "https://lumi-web.vercel.app/api/versiones";

#[derive(serde::Serialize)]
#[serde(tag = "tipo", rename_all = "lowercase")]
pub enum EstadoActualizacion {
    Disponible { version: String, notas: String, url: String },
    Retirada,
}

/// `Err` = no se pudo comprobar (sin red, sin firma o firma inválida); el
/// lado TS no pinta nada ante un error. `Ok(None)` = se comprobó y no hay
/// nada nuevo que ofrecer.
pub async fn comprobar() -> Result<Option<EstadoActualizacion>, String> {
    let manifiesto: Manifiesto = reqwest::Client::new()
        .get(VERSIONES_URL)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;
    manifiesto.comprobar().map_err(|e| e.to_string())?;

    let version_actual = env!("CARGO_PKG_VERSION");
    if manifiesto.version_retirada(Producto::Indexer, version_actual) {
        return Ok(Some(EstadoActualizacion::Retirada));
    }
    let Some(publi) = manifiesto.mas_nueva(Producto::Indexer, version_actual, "windows-x86_64") else {
        return Ok(None);
    };
    let url = publi
        .artefactos
        .iter()
        .find(|a| a.plataforma == "windows-x86_64")
        .map(|a| a.url.clone())
        .unwrap_or_default();
    Ok(Some(EstadoActualizacion::Disponible {
        version: publi.version.clone(),
        notas: publi.notas.clone(),
        url,
    }))
}
```

- [ ] **Step 3: Registrar el módulo, el comando y el plugin**

Edita `indexer/src-tauri/src/lib.rs`. Añade `mod actualizacion;` junto a los demás `mod`:

```rust
mod actualizacion;
mod catalogo;
mod crypto;
```

Añade el comando Tauri junto a `saludo` (o cualquier otro comando simple del archivo):

```rust
#[tauri::command]
async fn comprobar_actualizacion() -> Result<Option<actualizacion::EstadoActualizacion>, String> {
    actualizacion::comprobar().await
}
```

Registra el plugin donde ya se registra `tauri_plugin_dialog::init()`:

```rust
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
```

Y añade `comprobar_actualizacion` a la lista de `invoke_handler` (junto a `saludo` y el resto):

```rust
        .invoke_handler(tauri::generate_handler![
            saludo,
            comprobar_actualizacion,
            ubicacion_leer,
            // ... el resto de la lista existente, sin tocar
        ])
```

- [ ] **Step 4: Compilar**

```bash
cd indexer/src-tauri && cargo check
```

Expected: compila sin errores.

- [ ] **Step 5: Commit**

```bash
git add indexer/src-tauri/Cargo.toml indexer/src-tauri/src/actualizacion.rs indexer/src-tauri/src/lib.rs indexer/src-tauri/capabilities/default.json indexer/package.json indexer/package-lock.json
git commit -m "feat: comando comprobar_actualizacion en el Indexer"
```

---

### Task 4: Cinta y aviso manual en el cliente

**Files:**
- Create: `client/src/lib/actualizaciones.ts`
- Create: `client/src/ui/ActualizacionBanner.tsx`
- Modify: `client/src/App.tsx`
- Modify: `client/src/profile/ProfileView.tsx`

**Interfaces:**
- Consumes: comando Tauri `comprobar_actualizacion` (Task 2).
- Produces: nada que otras tasks consuman — es la hoja final de este plan para el cliente.

- [ ] **Step 1: El wrapper**

Crea `client/src/lib/actualizaciones.ts`:

```ts
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";

export type EstadoActualizacion =
  | { tipo: "disponible"; version: string; notas: string; url: string }
  | { tipo: "retirada" };

/** `null` = no hay nada nuevo. Lanza si no se pudo comprobar (sin red,
 *  manifiesto sin firmar o con firma inválida) — quien llama decide qué
 *  hacer con eso; ver `App.tsx` (silencioso) y `ProfileView.tsx` (visible,
 *  porque ahí sí lo pediste tú). */
export function comprobarActualizacion(): Promise<EstadoActualizacion | null> {
  return invoke<EstadoActualizacion | null>("comprobar_actualizacion");
}

export function abrirDescarga(url: string): Promise<void> {
  return openUrl(url);
}
```

- [ ] **Step 2: La cinta**

Crea `client/src/ui/ActualizacionBanner.tsx`:

```tsx
import { abrirDescarga, type EstadoActualizacion } from "../lib/actualizaciones";
import { Icon } from "./Icon";

/** Vive en `ui/`, no en `admin/`, igual que `MantenimientoBanner`: `App.tsx`
 *  la monta una sola vez para toda la app. A diferencia de mantenimiento,
 *  esto no es un estado del servidor: es local y descartable — cerrarla no
 *  vuelve a comprobar hasta el próximo arranque o hasta "Comprobar ahora"
 *  en Perfil. */
export function ActualizacionBanner({ estado, onCerrar }: {
  estado: EstadoActualizacion;
  onCerrar: () => void;
}) {
  const retirada = estado.tipo === "retirada";
  return (
    <div
      className={`relative flex shrink-0 items-center gap-2.5 border-b px-4 py-2 text-[11px] ${
        retirada ? "border-warning/25 bg-warning/[.06] text-warning-fg" : "border-draw/25 bg-draw/[.06] text-draw-fg"
      }`}
      style={{ animation: "jg-fade-rise .5s cubic-bezier(.16,1,.3,1) both" }}
    >
      <Icon name={retirada ? "alert" : "refresh"} size={13} />
      {retirada ? (
        <span className="flex-1 truncate">
          <b className="font-medium text-fg">Tu versión fue retirada.</b> Actualiza en cuanto puedas.
        </span>
      ) : (
        <span className="flex flex-1 items-baseline gap-2 truncate">
          Versión <b className="font-mono font-medium tabular-nums text-fg">{estado.version}</b> disponible
          <span className="truncate text-subtle">— {estado.notas}</span>
        </span>
      )}
      {!retirada && estado.url && (
        <button
          onClick={() => void abrirDescarga(estado.url)}
          className="shrink-0 rounded-[6px] border border-border px-2.5 py-1 font-medium text-fg
            transition-colors duration-150 hover:bg-border"
        >
          Ver y descargar
        </button>
      )}
      <button
        onClick={onCerrar}
        aria-label="Cerrar aviso de actualización"
        className="grid h-[26px] w-[26px] shrink-0 place-items-center rounded-[6px] text-subtle
          transition-colors duration-150 hover:bg-border hover:text-fg"
      >
        <Icon name="x" size={13} />
      </button>
    </div>
  );
}
```

- [ ] **Step 3: Montarla en `App.tsx`**

Lee primero el bloque de `App.tsx` donde ya vive `MantenimientoBanner` (import en la cabecera, uso cerca de `{mode !== "entry" && sample?.maintenance && ...}`) para replicar exactamente el mismo hueco.

Añade el import junto a los existentes:

```tsx
import { MantenimientoBanner } from "./ui/MantenimientoBanner";
import { ActualizacionBanner } from "./ui/ActualizacionBanner";
import { comprobarActualizacion, type EstadoActualizacion } from "./lib/actualizaciones";
```

Dentro del componente `App`, añade el estado y el efecto de arranque (junto a los demás `useState`/`useEffect` de nivel superior):

```tsx
  const [actualizacion, setActualizacion] = useState<EstadoActualizacion | null>(null);
  const [actualizacionCerrada, setActualizacionCerrada] = useState(false);

  // Una comprobación por arranque, silenciosa si falla (sin red, o el
  // manifiesto no verifica). El botón manual de Perfil sí muestra el error.
  useEffect(() => {
    comprobarActualizacion().then(setActualizacion).catch(() => setActualizacion(null));
  }, []);
```

Y en el render, junto a la línea de `MantenimientoBanner` (mismo nivel, justo antes o después):

```tsx
      {mode !== "entry" && actualizacion && !actualizacionCerrada && (
        <ActualizacionBanner estado={actualizacion} onCerrar={() => setActualizacionCerrada(true)} />
      )}
      {mode !== "entry" && sample?.maintenance && <MantenimientoBanner mensaje={sample.maintenance_message} />}
```

- [ ] **Step 4: El botón manual en Perfil**

Edita `client/src/profile/ProfileView.tsx`. Añade el import junto a los existentes:

```tsx
import { comprobarActualizacion, type EstadoActualizacion } from "../lib/actualizaciones";
```

Dentro de `PerfilPanel` (la función que devuelve el `<Seccion titulo="Perfil" ...>`), añade el estado:

```tsx
  const [actEstado, setActEstado] = useState<EstadoActualizacion | null>(null);
  const [actError, setActError] = useState<string | null>(null);
  const [actComprobando, setActComprobando] = useState(false);

  async function comprobarAhora() {
    setActComprobando(true);
    setActError(null);
    try {
      setActEstado(await comprobarActualizacion());
    } catch (e) {
      setActEstado(null);
      setActError(String(e));
    } finally {
      setActComprobando(false);
    }
  }
```

Y en el JSX, justo después del bloque `<div className="mt-4 rounded-card border border-border bg-panel">...<Fila .../></div>` que ya lista Usuario/Rol/Servidor, añade:

```tsx
      <div className="mt-4 rounded-card border border-border bg-panel p-[13px_16px]">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[8.5px] uppercase tracking-[.15em] text-subtle">Lumi</span>
          <span className="font-mono text-[10px] tabular-nums text-subtle">
            {import.meta.env.PACKAGE_VERSION ?? ""}
          </span>
        </div>
        {actEstado?.tipo === "disponible" && (
          <p className="text-[11px] text-draw-fg">Versión {actEstado.version} disponible — {actEstado.notas}</p>
        )}
        {actEstado?.tipo === "retirada" && (
          <p className="text-[11px] text-warning-fg">Tu versión fue retirada. Actualiza en cuanto puedas.</p>
        )}
        {!actEstado && !actError && !actComprobando && (
          <p className="text-[11px] text-muted">Sin comprobar en esta sesión.</p>
        )}
        {actError && <p className="text-[11px] text-subtle">No se pudo comprobar: {actError}</p>}
        <button onClick={() => void comprobarAhora()} disabled={actComprobando}
          className="jg-press mt-2.5 rounded-lg border border-white/15 px-2.5 py-1 text-[10.5px] text-fg disabled:opacity-40">
          {actComprobando ? "Comprobando…" : "Comprobar ahora"}
        </button>
      </div>
```

Nota: `import.meta.env.PACKAGE_VERSION` no existe hoy — es un atajo opcional de Vite que requeriría configurarlo en `vite.config.ts`. Si al implementar este paso no está disponible, **omite esa línea de versión** (deja solo el eyebrow "Lumi" sin número) en vez de inventar una fuente de la versión que no existe; no es parte del alcance de este plan configurar Vite para exponerla.

- [ ] **Step 5: Verificar en el navegador (sin backend real)**

Este comando depende de una llamada de red real a Vercel — sin el Plan 1 desplegado, `comprobarActualizacion()` fallará con un error de red, que es exactamente el camino "silencioso" que hay que confirmar que no rompe nada visualmente.

```bash
cd client && npm run tauri dev
```

Con la app abierta: confirma que no aparece ninguna cinta ni error visible al arrancar (la llamada falla en silencio). Ve a Perfil → pulsa "Comprobar ahora" → confirma que aparece "No se pudo comprobar: ..." con el mensaje de red, no una pantalla rota.

Si el Plan 1 ya está desplegado en Vercel para cuando se ejecute este paso, en su lugar confirma que no aparece ninguna cinta (el manifiesto real de Plan 1 no tiene publicaciones todavía) y que "Comprobar ahora" no muestra error.

- [ ] **Step 6: Commit**

```bash
git add client/src/lib/actualizaciones.ts client/src/ui/ActualizacionBanner.tsx client/src/App.tsx client/src/profile/ProfileView.tsx
git commit -m "feat: cinta y comprobacion manual de actualizaciones en el cliente"
```

---

### Task 5: Cinta y aviso manual en el Indexer

**Files:**
- Create: `indexer/src/lib/actualizaciones.ts`
- Create: `indexer/src/ui/ActualizacionBanner.tsx`
- Modify: `indexer/src/App.tsx`
- Modify: `indexer/src/settings/DebugPanel.tsx`

**Interfaces:**
- Consumes: comando Tauri `comprobar_actualizacion` (Task 3).
- Produces: nada que otras tasks consuman.

Mismo patrón que el Task 4, adaptado a la estructura del Indexer (sin `MantenimientoBanner` que copiar como referencia porque el Indexer no tiene modo mantenimiento — se monta igual, junto a `WindowFrame`).

- [ ] **Step 1: El wrapper**

Crea `indexer/src/lib/actualizaciones.ts` — idéntico al del cliente salvo el comentario:

```ts
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";

export type EstadoActualizacion =
  | { tipo: "disponible"; version: string; notas: string; url: string }
  | { tipo: "retirada" };

/** `null` = no hay nada nuevo. Lanza si no se pudo comprobar (sin red,
 *  manifiesto sin firmar o con firma inválida). */
export function comprobarActualizacion(): Promise<EstadoActualizacion | null> {
  return invoke<EstadoActualizacion | null>("comprobar_actualizacion");
}

export function abrirDescarga(url: string): Promise<void> {
  return openUrl(url);
}
```

- [ ] **Step 2: La cinta**

Crea `indexer/src/ui/ActualizacionBanner.tsx` — mismo componente que `client/src/ui/ActualizacionBanner.tsx` del Task 4 Step 2 (copia literal; confirma antes que `indexer/src/ui/Icon.tsx` tiene los mismos nombres `refresh`/`alert`/`x` que el del cliente — comparten el mismo vocabulario visual por diseño del proyecto, ver CLAUDE.md, "shares only `client/src/ui`"; si algún nombre difiere, ajusta el `name=` al que exista en `indexer/src/ui/Icon.tsx`).

- [ ] **Step 3: Montarla en `App.tsx`**

Edita `indexer/src/App.tsx`. Añade los imports junto a los existentes:

```tsx
import { ActualizacionBanner } from "./ui/ActualizacionBanner";
import { comprobarActualizacion, type EstadoActualizacion } from "./lib/actualizaciones";
```

Dentro del componente, junto a los demás `useState`/`useEffect` de nivel superior:

```tsx
  const [actualizacion, setActualizacion] = useState<EstadoActualizacion | null>(null);
  const [actualizacionCerrada, setActualizacionCerrada] = useState(false);

  useEffect(() => {
    comprobarActualizacion().then(setActualizacion).catch(() => setActualizacion(null));
  }, []);
```

En el render, dentro de `<WindowFrame>`, justo antes de `<div className="relative h-full w-full overflow-hidden bg-bg">` o como primer hijo de ese div (para que quede pegada arriba, igual que la cinta del cliente queda pegada bajo la barra de título) — y solo una vez que la app ya pasó el arranque (`dentro`, la misma condición que ya usa el resto de pantallas post-setup):

```tsx
        {dentro && actualizacion && !actualizacionCerrada && (
          <ActualizacionBanner estado={actualizacion} onCerrar={() => setActualizacionCerrada(true)} />
        )}
```

- [ ] **Step 4: El botón manual en Ajustes → Debug**

Edita `indexer/src/settings/DebugPanel.tsx`. Añade el import:

```tsx
import { comprobarActualizacion, type EstadoActualizacion } from "../lib/actualizaciones";
```

Dentro de `DebugPanel`, junto a los demás `useState`:

```tsx
  const [actEstado, setActEstado] = useState<EstadoActualizacion | null>(null);
  const [actError, setActError] = useState<string | null>(null);
  const [actComprobando, setActComprobando] = useState(false);

  async function comprobarAhora() {
    setActComprobando(true);
    setActError(null);
    try {
      setActEstado(await comprobarActualizacion());
    } catch (e) {
      setActEstado(null);
      setActError(String(e));
    } finally {
      setActComprobando(false);
    }
  }
```

En el JSX, justo antes del bloque `<div className="mt-4 flex items-center justify-between rounded-lg border border-border px-3.5 py-2.5">` (el de "Asistente inicial"), añade uno con la misma forma:

```tsx
        <div className="mt-4 flex items-center justify-between rounded-lg border border-border px-3.5 py-2.5">
          <div>
            <p className="text-[11.5px] text-fg">Actualizaciones</p>
            <p className="mt-0.5 text-[10.5px] leading-relaxed text-muted">
              {actEstado?.tipo === "disponible" && `Versión ${actEstado.version} disponible — ${actEstado.notas}`}
              {actEstado?.tipo === "retirada" && "Tu versión fue retirada. Actualiza en cuanto puedas."}
              {!actEstado && !actError && "Sin comprobar en esta sesión."}
              {actError && `No se pudo comprobar: ${actError}`}
            </p>
          </div>
          <button
            onClick={() => void comprobarAhora()}
            disabled={actComprobando}
            className="jg-press shrink-0 rounded-lg border border-border px-3.5 py-2 text-[11.5px] text-fg disabled:opacity-40"
          >
            {actComprobando ? "Comprobando…" : "Comprobar ahora"}
          </button>
        </div>
```

- [ ] **Step 5: Verificar en el navegador**

```bash
cd indexer && npm run tauri dev
```

Mismo criterio que el Task 4 Step 5: sin Plan 1 desplegado, la comprobación automática falla en silencio (sin cinta, sin error visible al arrancar); en Ajustes → Debug, "Comprobar ahora" muestra "No se pudo comprobar: ..." sin romper la pantalla.

- [ ] **Step 6: Commit**

```bash
git add indexer/src/lib/actualizaciones.ts indexer/src/ui/ActualizacionBanner.tsx indexer/src/App.tsx indexer/src/settings/DebugPanel.tsx
git commit -m "feat: cinta y comprobacion manual de actualizaciones en el Indexer"
```

---

## Self-Review

**Cobertura de la spec:** comprobación al arrancar sin bloquear (Task 4/5 Step 3), botón manual (Task 4/5 Step 4), silencio total sin red (Global Constraints + verificado en Step 5 de cada task), firma inválida tratada como "sin red" (mismo `Err` → mismo camino silencioso), aviso de versión retirada (`EstadoActualizacion::Retirada` en Task 2/3, pintado en Task 4/5), el botón lleva a la descarga sin instalar nada (`abrirDescarga`/`tauri-plugin-opener`, nunca escribe a disco). Cubierto.

**Placeholders:** ninguno, salvo la nota explícita del Task 4 Step 4 sobre `import.meta.env.PACKAGE_VERSION`, que no es un placeholder de lógica sino una instrucción concreta de qué hacer si ese atajo no existe (omitir una línea, no inventar dato).

**Consistencia de tipos:** `EstadoActualizacion` se define igual (mismo `#[serde(tag = "tipo", rename_all = "lowercase")]`) en Task 2 (cliente) y Task 3 (Indexer), y el tipo TS espejo (`{tipo: "disponible", ...} | {tipo: "retirada"}`) es idéntico en Task 4 y Task 5. `comprobarActualizacion()`/`abrirDescarga()` se llaman igual en ambas apps.

---

**Plan complete and saved to `docs/superpowers/plans/2026-08-26-canal-actualizaciones-2-cliente-indexer.md`. Two execution options:**

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
