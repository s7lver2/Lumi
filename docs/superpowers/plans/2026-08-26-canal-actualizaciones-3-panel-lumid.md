# Canal de actualizaciones — 3. Panel de actualización de `lumid`

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `lumid` comprueba una vez al día si hay una versión más nueva firmada, cachea el resultado, y un admin puede aplicarla desde una pestaña nueva del panel de administración: descarga, verifica el `sha256`, entra en mantenimiento, espera a que la cola en curso vacíe, hace copia de seguridad de la base, sustituye el binario y reinicia.

**Architecture:** Un módulo `actualizacion.rs` a nivel de `lumid` (no de `routes/`) concentra la lógica: `comprobar_y_cachear` (consulta + guarda en `meta`), `estado_cacheado` (lectura pura, sin red), y `aplicar` (la secuencia completa, disparada en segundo plano porque puede tardar indefinidamente y el propio proceso muere al final). `routes/actualizacion.rs` expone tres rutas finas que solo comprueban permisos y delegan. El panel de administración gana una pestaña que sondea el estado cada pocos segundos mientras está abierta — sin SSE nuevo, reutilizando el patrón de sondeo que ya usa `DebugPanel`/`DoctorView` del Indexer y el cliente.

**Tech Stack:** Rust (`reqwest`, `sha2`, `tokio`, ya presentes en `lumid`), `lumi-proto` (Plan 1), React + TypeScript.

## Global Constraints

- **Depende del Plan 1.** `lumi_proto::actualizacion::{Manifiesto, Producto}` debe compilar antes de empezar.
- **`lumid` no distingue "owner" de "admin"** — el esquema solo tiene `users.is_admin`. La spec original decía "solo el owner", pero se decidió explícitamente (ver conversación de diseño) usar `require_admin` tal cual existe hoy, sin añadir un rol nuevo para un solo botón — es la lectura ponytail. Cualquier administrador puede pulsar "Actualizar servidor".
- **Nada destructivo antes de verificar todo lo verificable.** Orden fijo: descargar → comprobar `sha256` → entrar en mantenimiento → esperar cola → copia de seguridad → sustituir binario → reiniciar. Si el `sha256` no coincide, se aborta en el primer paso: el servidor no se ha tocado.
- **El trabajo en curso nunca se cancela.** Esperar a que `en_curso` llegue a 0 no tiene tope de tiempo.
- El rollback es **manual, a propósito**: se conserva `lumid.viejo`; automatizarlo (una segunda unidad de systemd con `OnFailure=`) es el techo anotado en la spec, fuera de este plan.
- Sin canal en vivo nuevo para seguir el progreso de `aplicar()`: el panel sondea `GET /v1/admin/actualizacion` cada pocos segundos. Un SSE dedicado es una mejora futura, no lo pide esta entrega.
- No tests salvo en `lumi-proto` (ya cubierto en el Plan 1).
- Colores/iconos: mismos que el Plan 2 (`draw`/`draw-fg` en curso, `warning`/`warning-fg` aviso, `danger`/`danger-fg` error), iconos `refresh`/`check`/`alert` ya existentes en `client/src/ui/Icon.tsx`.

---

### Task 1: Módulo `actualizacion.rs` — comprobar, cachear, aplicar

**Files:**
- Create: `crates/lumid/src/actualizacion.rs`
- Modify: `crates/lumid/src/main.rs`
- Modify: `crates/lumid/Cargo.toml`

**Interfaces:**
- Consumes: `lumi_proto::actualizacion::{Manifiesto, Producto}` (Plan 1); `app.queue.foto().en_curso` (`crates/lumid/src/queue/mod.rs:317`); `app.store.{get_meta,set_meta}` (`crates/lumid/src/store.rs:330`); `mantenimiento::{set_activo, set_mensaje}` (`crates/lumid/src/mantenimiento.rs`).
- Produces: `actualizacion::{EstadoActualizacion, PublicacionInfo, AplicarError, comprobar_y_cachear, estado_cacheado, aplicar, tick}`. Los usa Task 2 (rutas).

- [ ] **Step 1: Dependencia que falta**

`lumid` ya tiene `sha2`, `reqwest` y `serde_json`; le falta `thiserror` (sí está en el workspace, lo usa `lumi-proto`). Edita `crates/lumid/Cargo.toml`, añade a `[dependencies]`:

```toml
thiserror.workspace = true
```

- [ ] **Step 2: El módulo**

Crea `crates/lumid/src/actualizacion.rs`:

```rust
//! Canal de actualizaciones del propio `lumid`: comprobar contra el
//! manifiesto firmado (`lumi_proto::actualizacion`), cachear el resultado
//! en `meta`, y aplicar la actualización cuando un admin la pide desde el
//! panel — el esquema no distingue "owner" de "admin" hoy (solo existe
//! `users.is_admin`), así que cualquier admin puede hacerlo; ver la nota en
//! la spec sobre esta decisión.

use crate::mantenimiento;
use crate::App;
use lumi_proto::actualizacion::{Manifiesto, Producto};
use serde::{Deserialize, Serialize};

const VERSIONES_URL: &str = "https://lumi-web.vercel.app/api/versiones";
const META_ESTADO: &str = "actualizacion_estado";
const BIN_ACTUAL: &str = "/usr/local/bin/lumid";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EstadoActualizacion {
    pub version_instalada: String,
    pub disponible: Option<PublicacionInfo>,
    pub retirada: bool,
    pub comprobado_en: Option<i64>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PublicacionInfo {
    pub version: String,
    pub notas: String,
    pub publicado: String,
}

fn version_instalada() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

async fn consultar_manifiesto() -> Result<Manifiesto, String> {
    let manifiesto: Manifiesto = reqwest::Client::new()
        .get(VERSIONES_URL)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;
    manifiesto.comprobar().map_err(|e| e.to_string())?;
    Ok(manifiesto)
}

/// Consulta el manifiesto y cachea el resultado en `meta`. No falla nunca
/// hacia afuera: un problema de red o de firma se guarda como parte del
/// propio estado (`error: Some(...)`), no como un `Result` que tumbe el
/// tick de fondo.
pub async fn comprobar_y_cachear(app: &App) {
    let version_instalada = version_instalada();
    let ahora = crate::routes::access::now();
    let estado = match consultar_manifiesto().await {
        Ok(manifiesto) => EstadoActualizacion {
            retirada: manifiesto.version_retirada(Producto::Lumid, &version_instalada),
            disponible: manifiesto
                .mas_nueva(Producto::Lumid, &version_instalada, "linux-x86_64")
                .map(|p| PublicacionInfo {
                    version: p.version.clone(),
                    notas: p.notas.clone(),
                    publicado: p.publicado.clone(),
                }),
            version_instalada,
            comprobado_en: Some(ahora),
            error: None,
        },
        Err(e) => EstadoActualizacion {
            version_instalada,
            disponible: None,
            retirada: false,
            comprobado_en: None,
            error: Some(e),
        },
    };
    let _ = app.store.set_meta(META_ESTADO, &serde_json::to_string(&estado).unwrap_or_default());
}

/// Lectura pura de lo último cacheado — nunca hace red por su cuenta. Es lo
/// que sirve `GET /v1/admin/actualizacion`; solo el tick de fondo y
/// "comprobar ahora" llaman a `comprobar_y_cachear`.
pub fn estado_cacheado(app: &App) -> EstadoActualizacion {
    app.store
        .get_meta(META_ESTADO)
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_else(|| EstadoActualizacion {
            version_instalada: version_instalada(),
            disponible: None,
            retirada: false,
            comprobado_en: None,
            error: Some("todavía no se ha comprobado".into()),
        })
}

/// Una vez al día, para siempre, mientras el daemon viva. Mismo patrón que
/// `telemetry::muestrear_historial`.
pub async fn tick(app: App) {
    loop {
        comprobar_y_cachear(&app).await;
        tokio::time::sleep(std::time::Duration::from_secs(24 * 3600)).await;
    }
}

#[derive(Debug, thiserror::Error)]
pub enum AplicarError {
    #[error("no hay ninguna actualización disponible para aplicar")]
    SinDisponible,
    #[error("no se pudo descargar el artefacto: {0}")]
    Descarga(String),
    #[error("la huella no coincide: esperada {esperado}, recibida {recibido}")]
    HashNoCoincide { esperado: String, recibido: String },
    #[error("no se pudo escribir el binario nuevo: {0}")]
    Escritura(String),
    #[error("no se pudo hacer la copia de seguridad de la base: {0}")]
    Backup(String),
}

/// La secuencia completa. Deliberadamente en orden: nada destructivo pasa
/// antes de que todo lo verificable esté verificado. El proceso que ejecuta
/// esto muere al final (paso 6, `systemctl restart`) — quien la llama
/// (`routes/actualizacion.rs::aplicar`) la dispara con `tokio::spawn` y no
/// espera una respuesta HTTP limpia al final, por diseño.
pub async fn aplicar(app: &App) -> Result<(), AplicarError> {
    // 1. Descargar y verificar el hash. Nada se ha tocado todavía si esto falla.
    let manifiesto = consultar_manifiesto().await.map_err(AplicarError::Descarga)?;
    let version_instalada = version_instalada();
    let publicacion = manifiesto
        .mas_nueva(Producto::Lumid, &version_instalada, "linux-x86_64")
        .ok_or(AplicarError::SinDisponible)?
        .clone();
    let artefacto = publicacion
        .artefactos
        .iter()
        .find(|a| a.plataforma == "linux-x86_64")
        .ok_or(AplicarError::SinDisponible)?
        .clone();

    let bytes = reqwest::Client::new()
        .get(&artefacto.url)
        .send()
        .await
        .map_err(|e| AplicarError::Descarga(e.to_string()))?
        .bytes()
        .await
        .map_err(|e| AplicarError::Descarga(e.to_string()))?;

    let recibido = {
        use sha2::{Digest, Sha256};
        let mut h = Sha256::new();
        h.update(&bytes);
        format!("{:x}", h.finalize())
    };
    if recibido != artefacto.sha256 {
        return Err(AplicarError::HashNoCoincide { esperado: artefacto.sha256.clone(), recibido });
    }

    // 2. Mantenimiento: rechaza trabajo nuevo, no cancela el que corre.
    let _ = mantenimiento::set_activo(app, true);
    let _ = mantenimiento::set_mensaje(app, &format!("Actualizando a {}…", publicacion.version));

    // 3. Esperar a que la cola en curso vacíe. Sin tope de tiempo: el
    //    trabajo empezado no se cancela nunca.
    while app.queue.foto().en_curso > 0 {
        tokio::time::sleep(std::time::Duration::from_secs(5)).await;
    }

    // 4. Copia de seguridad de la base antes de tocar nada en disco.
    let ruta_backup = app.dir.join(format!("lumi.db.bak-{version_instalada}"));
    app.store
        .conn()
        .execute("VACUUM INTO ?1", [ruta_backup.to_string_lossy().as_ref()])
        .map_err(|e| AplicarError::Backup(e.to_string()))?;

    // 5. Sustituir el binario. En Linux se puede renombrar un binario en
    //    ejecución sin detenerlo antes.
    let viejo = format!("{BIN_ACTUAL}.viejo");
    std::fs::rename(BIN_ACTUAL, &viejo).map_err(|e| AplicarError::Escritura(e.to_string()))?;
    std::fs::write(BIN_ACTUAL, &bytes).map_err(|e| AplicarError::Escritura(e.to_string()))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(BIN_ACTUAL, std::fs::Permissions::from_mode(0o755));
    }

    // 6. Reiniciar. El nuevo proceso corre `store::migrate()` al arrancar,
    //    como en cualquier arranque normal — no hace falta nada especial
    //    aquí para eso. Este proceso muere aquí.
    let _ = std::process::Command::new("systemctl").args(["restart", "lumid"]).status();

    Ok(())
}
```

- [ ] **Step 3: Registrar el módulo y el tick de fondo**

Edita `crates/lumid/src/main.rs`. Añade `mod actualizacion;` junto a los demás módulos (orden alfabético, junto a `mod agentar;`):

```rust
mod actualizacion;
mod agentar;
```

Junto a los demás `tokio::spawn` de arranque (cerca de `tokio::spawn(telemetry::muestrear_historial(app.clone()));`):

```rust
    tokio::spawn(actualizacion::tick(app.clone()));
```

- [ ] **Step 4: Compilar**

```bash
cargo check -p lumid
```

Expected: compila sin errores.

- [ ] **Step 5: Commit**

```bash
git add crates/lumid/Cargo.toml crates/lumid/src/actualizacion.rs crates/lumid/src/main.rs
git commit -m "feat: lumid comprueba y puede aplicar actualizaciones"
```

---

### Task 2: Rutas HTTP

**Files:**
- Create: `crates/lumid/src/routes/actualizacion.rs`
- Modify: `crates/lumid/src/routes/mod.rs`
- Modify: `crates/lumid/src/main.rs`

**Interfaces:**
- Consumes: `actualizacion::{estado_cacheado, comprobar_y_cachear, aplicar, EstadoActualizacion}` (Task 1); `routes::auth::{bearer, require_admin}` (ya existentes).
- Produces: `GET /v1/admin/actualizacion`, `POST /v1/admin/actualizacion/comprobar`, `POST /v1/admin/actualizacion/aplicar`. Los usa el Task 3 (frontend).

- [ ] **Step 1: Las rutas**

Crea `crates/lumid/src/routes/actualizacion.rs`:

```rust
//! Lectura y aplicación del canal de actualizaciones. Rutas finas: solo
//! comprueban permisos y delegan en `crate::actualizacion`.

use crate::mantenimiento;
use crate::routes::auth::{bearer, require_admin};
use crate::App;
use axum::extract::State;
use axum::{http::HeaderMap, http::StatusCode, Json};

pub async fn get(
    State(app): State<App>,
    headers: HeaderMap,
) -> Result<Json<crate::actualizacion::EstadoActualizacion>, StatusCode> {
    require_admin(&app, &bearer(&headers))?;
    Ok(Json(crate::actualizacion::estado_cacheado(&app)))
}

pub async fn comprobar_ahora(
    State(app): State<App>,
    headers: HeaderMap,
) -> Result<Json<crate::actualizacion::EstadoActualizacion>, StatusCode> {
    require_admin(&app, &bearer(&headers))?;
    crate::actualizacion::comprobar_y_cachear(&app).await;
    Ok(Json(crate::actualizacion::estado_cacheado(&app)))
}

/// Dispara la actualización en segundo plano y responde de inmediato: puede
/// tardar horas (esperando a que la cola vacíe) y el proceso muere al
/// reiniciar systemd al final, así que no hay una respuesta HTTP "limpia"
/// posible al terminar. El panel sigue el progreso sondeando `GET
/// /v1/admin/actualizacion`.
pub async fn aplicar(State(app): State<App>, headers: HeaderMap) -> StatusCode {
    if require_admin(&app, &bearer(&headers)).is_err() {
        return StatusCode::FORBIDDEN;
    }
    let app2 = app.clone();
    tokio::spawn(async move {
        if let Err(e) = crate::actualizacion::aplicar(&app2).await {
            tracing::error!("actualización de lumid fallida: {e}");
            let _ = mantenimiento::set_activo(&app2, false);
        }
    });
    StatusCode::ACCEPTED
}
```

- [ ] **Step 2: Registrar el módulo**

Edita `crates/lumid/src/routes/mod.rs`, añade `pub mod actualizacion;` (orden alfabético, junto a `pub mod access;`):

```rust
pub mod access;
pub mod actualizacion;
pub mod actividad;
```

- [ ] **Step 3: Montar las rutas**

Edita `crates/lumid/src/main.rs`, en el bloque `Router::new()...route(...)`, junto a las demás rutas `/v1/admin/*` (por ejemplo, cerca de `/v1/admin/telemetry/*`):

```rust
        .route("/v1/admin/actualizacion", get(routes::actualizacion::get))
        .route("/v1/admin/actualizacion/comprobar", post(routes::actualizacion::comprobar_ahora))
        .route("/v1/admin/actualizacion/aplicar", post(routes::actualizacion::aplicar))
```

- [ ] **Step 4: `mantenimiento_gate` no debe bloquear estas rutas para un admin**

`mantenimiento_gate` (Task 4 del módulo `mantenimiento.rs`) ya deja pasar a cualquier admin autenticado (`crate::routes::auth::require_session(&app, &token).is_ok_and(|(_, is_admin)| is_admin)` en `mantenimiento.rs`) — así que **no hace falta tocar `es_nucleo` ni `servicio_de_ruta`**: un admin puede seguir comprobando y viendo el estado de la actualización aunque el propio `aplicar()` haya puesto el servidor en mantenimiento a mitad de camino. Confírmalo leyendo `crates/lumid/src/mantenimiento.rs` antes de continuar — si esa lectura no coincide con lo descrito aquí, ese es el sitio a corregir, no las rutas nuevas.

- [ ] **Step 5: Compilar**

```bash
cargo check -p lumid
```

Expected: compila sin errores.

- [ ] **Step 6: Probar las rutas a mano**

Con `lumid` arrancado en local (`python tools/build.py`, o `cargo run -p lumid` con `LUMI_PORT`/`LUMI_DATA` como hace ese script), y un token de admin válido:

```bash
curl -sk https://localhost:7717/v1/admin/actualizacion -H "authorization: Bearer $TOKEN" | head -c 300
```

Expected: JSON con `"error":"todavía no se ha comprobado"` (el tick de 24h todavía no ha corrido) o, tras `POST .../comprobar`, el estado real.

```bash
curl -sk -X POST https://localhost:7717/v1/admin/actualizacion/comprobar -H "authorization: Bearer $TOKEN" | head -c 300
```

Expected: si no hay red de salida a Vercel en el entorno de prueba, `"error":"..."` con el mensaje de red — sigue siendo una respuesta 200 válida, nunca un 500.

- [ ] **Step 7: Commit**

```bash
git add crates/lumid/src/routes/actualizacion.rs crates/lumid/src/routes/mod.rs crates/lumid/src/main.rs
git commit -m "feat: rutas /v1/admin/actualizacion en lumid"
```

---

### Task 3: Pestaña "Actualizaciones" en el panel de administración

**Files:**
- Modify: `client/src/lib/api.ts`
- Modify: `client/src/admin/Sidebar.tsx`
- Modify: `client/src/admin/AdminPanel.tsx`
- Create: `client/src/admin/ActualizacionesView.tsx`

**Interfaces:**
- Consumes: `GET /v1/admin/actualizacion`, `POST /v1/admin/actualizacion/comprobar`, `POST /v1/admin/actualizacion/aplicar` (Task 2).
- Produces: nada que otras tasks consuman — hoja final de este plan.

- [ ] **Step 1: Tipos en `api.ts`**

Edita `client/src/lib/api.ts`, añade junto a los demás tipos (por ejemplo, cerca de `AvisoInfo`):

```ts
export interface PublicacionInfo { version: string; notas: string; publicado: string }
export interface EstadoActualizacionLumid {
  version_instalada: string;
  disponible: PublicacionInfo | null;
  retirada: boolean;
  comprobado_en: number | null;
  error: string | null;
}
```

- [ ] **Step 2: Sección nueva en la barra lateral**

Edita `client/src/admin/Sidebar.tsx`. Añade `"actualizaciones"` al tipo `Seccion`:

```tsx
export type Seccion =
  | "resumen" | "modelos" | "personalizacion" | "indices" | "seguridad" | "claves" | "red"
  | "solicitudes" | "usuarios"
  | "cola" | "notificaciones" | "hardware" | "doctor" | "actualizaciones";
```

Añádela al grupo "Operación" de `GRUPOS`, junto a `doctor`:

```tsx
  {
    grupo: "Operación",
    items: [
      { id: "cola", label: "Cola", icon: "bars" },
      { id: "notificaciones", label: "Notificaciones", icon: "bell" },
      { id: "hardware", label: "Hardware", icon: "gpu" },
      { id: "doctor", label: "Doctor", icon: "pulse" },
      { id: "actualizaciones", label: "Actualizaciones", icon: "refresh" },
    ],
  },
```

- [ ] **Step 3: La vista**

Crea `client/src/admin/ActualizacionesView.tsx`:

```tsx
import { useEffect, useState } from "react";
import { api, type EstadoActualizacionLumid } from "../lib/api";
import { Icon } from "../ui/Icon";
import { Seccion } from "./AdminPanel";

/** Sondeo cada 4s mientras la pestaña está abierta — sin canal en vivo
 *  dedicado (ver el techo anotado en el plan). Suficiente para ver avanzar
 *  "esperando cola" → "reiniciando" sin que el owner tenga que refrescar a
 *  mano. */
const INTERVALO_MS = 4000;

export function ActualizacionesView({ token }: { token: string }) {
  const [estado, setEstado] = useState<EstadoActualizacionLumid | null>(null);
  const [aplicando, setAplicando] = useState(false);
  const [comprobando, setComprobando] = useState(false);

  useEffect(() => {
    let vivo = true;
    const tick = () =>
      api.get<EstadoActualizacionLumid>("/v1/admin/actualizacion", token)
        .then((e) => { if (vivo) setEstado(e); })
        .catch(() => { /* la próxima vez que responda, se actualiza — no hay nada que mostrar por un fallo de sondeo suelto */ });
    tick();
    const t = setInterval(tick, INTERVALO_MS);
    return () => { vivo = false; clearInterval(t); };
  }, [token]);

  async function comprobarAhora() {
    setComprobando(true);
    try {
      setEstado(await api.post<EstadoActualizacionLumid>("/v1/admin/actualizacion/comprobar", {}, token));
    } finally {
      setComprobando(false);
    }
  }

  async function actualizarServidor() {
    setAplicando(true);
    await api.post("/v1/admin/actualizacion/aplicar", {}, token);
    // No hay nada más que hacer aquí: el propio servidor va a caer y volver
    // (o a quedarse en mantenimiento esperando la cola) — el sondeo de
    // arriba, no esta llamada, es lo que refleja el progreso.
  }

  return (
    <Seccion titulo="Actualizaciones" grupo="Operación">
      {!estado && <p className="text-[11px] text-muted">Cargando…</p>}
      {estado && (
        <div className="rounded-card border border-border bg-panel p-[16px_18px]">
          <div className="flex flex-wrap gap-11">
            <Campo etiqueta="Instalada" valor={estado.version_instalada} />
            {estado.disponible && <Campo etiqueta="Disponible" valor={estado.disponible.version} nueva />}
          </div>

          {estado.retirada && (
            <p className="mt-3 flex items-center gap-1.5 text-[11.5px] text-warning-fg">
              <Icon name="alert" size={13} />
              Tu versión instalada fue retirada. Actualiza en cuanto puedas.
            </p>
          )}

          {estado.error && (
            <p className="mt-3 text-[11.5px] text-subtle">No se pudo comprobar: {estado.error}</p>
          )}

          {estado.disponible && (
            <p className="mt-3 whitespace-pre-wrap text-[12px] text-muted">{estado.disponible.notas}</p>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-2.5">
            <button
              onClick={() => void actualizarServidor()}
              disabled={!estado.disponible || aplicando}
              className="jg-press rounded-lg bg-accent px-3 py-1.5 text-[11.5px] font-medium text-black disabled:opacity-40"
            >
              {aplicando ? "Actualizando…" : "Actualizar servidor"}
            </button>
            <button
              onClick={() => void comprobarAhora()}
              disabled={comprobando}
              className="jg-press rounded-lg border border-white/15 px-3 py-1.5 text-[11.5px] text-fg disabled:opacity-40"
            >
              {comprobando ? "Comprobando…" : "Comprobar ahora"}
            </button>
          </div>

          {aplicando && (
            <p className="mt-3 flex items-center gap-1.5 text-[11px] text-draw-fg">
              <Icon name="refresh" size={12} className="animate-spin" />
              Aplicando — si hay trabajo en curso, el servidor espera a que termine antes de reiniciar.
            </p>
          )}
        </div>
      )}
    </Seccion>
  );
}

function Campo({ etiqueta, valor, nueva }: { etiqueta: string; valor: string; nueva?: boolean }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] text-subtle">{etiqueta}</span>
      <span className={`font-mono text-[17px] tabular-nums ${nueva ? "text-fg" : "text-fg"}`}>{valor}</span>
    </div>
  );
}
```

Nota sobre `animate-spin`: si esa utilidad de Tailwind no está disponible en este proyecto (el `tailwind.config.ts` no define animaciones custom más allá de `ease-expo`), usa la utilidad estándar de Tailwind (`animate-spin` viene en el core, no hace falta declararla) — confirma con `npm run dev` que gira; si no, sustitúyela por `style={{ animation: "lumi-spin 1.6s linear infinite" }}` reutilizando el keyframe que ya define `index.css` para spinners del proyecto.

- [ ] **Step 4: Montarla en `AdminPanel.tsx`**

Edita `client/src/admin/AdminPanel.tsx`. Añade el import:

```tsx
import { ActualizacionesView } from "./ActualizacionesView";
```

Añade la rama en el `switch` de renderizado, junto a `doctor`:

```tsx
          : seccion === "doctor" ? <DoctorView token={token} onIr={setSeccion} />
          : seccion === "actualizaciones" ? <ActualizacionesView token={token} />
```

- [ ] **Step 5: Verificar en el navegador**

```bash
python tools/build.py
```

En el panel de administración, entra en "Actualizaciones" (grupo Operación). Confirma:
- Sin red de salida a Vercel (entorno de desarrollo típico): aparece "No se pudo comprobar: ..." tras el primer sondeo, sin romper la pantalla.
- El botón "Actualizar servidor" está deshabilitado mientras no haya `estado.disponible` (no hay manifiesto real todavía en este plan).
- "Comprobar ahora" no lanza ningún error de consola ni deja la pantalla en blanco.

- [ ] **Step 6: Commit**

```bash
git add client/src/lib/api.ts client/src/admin/Sidebar.tsx client/src/admin/AdminPanel.tsx client/src/admin/ActualizacionesView.tsx
git commit -m "feat: pestana Actualizaciones en el panel de administracion"
```

---

## Self-Review

**Cobertura de la spec:** secuencia de `aplicar()` en el orden exacto de la spec (Task 1, comentarios numerados 1–6), nada destructivo antes de verificar (`sha256` comprobado antes de tocar mantenimiento), trabajo en curso nunca cancelado (`while ... en_curso > 0`, sin tope), copia de seguridad antes de sustituir el binario, rollback manual documentado como fuera de alcance, panel con los botones y estados del mockup (Task 3). Cubierto. La única desviación consciente de la spec original es el rol "owner" → "admin", explicada en Global Constraints y decidida en la conversación de diseño, no una omisión.

**Placeholders:** ninguno, salvo la nota explícita del Task 2 Step 4 (pide *confirmar* una lectura de código existente, con instrucción concreta de qué hacer si no coincide — no es un "TBD") y la nota del Task 3 Step 3 sobre `animate-spin` (alternativa concreta si la utilidad no está disponible, no una vaguedad).

**Consistencia de tipos:** `EstadoActualizacion`/`PublicacionInfo` (Rust, Task 1) tienen exactamente los mismos campos que `EstadoActualizacionLumid`/`PublicacionInfo` (TypeScript, Task 3) — `version_instalada`, `disponible`, `retirada`, `comprobado_en`, `error`. Las tres rutas de Task 2 (`get`, `comprobar_ahora`, `aplicar`) se llaman igual desde Task 3 (`/v1/admin/actualizacion`, `.../comprobar`, `.../aplicar`).

---

**Plan complete and saved to `docs/superpowers/plans/2026-08-26-canal-actualizaciones-3-panel-lumid.md`. Two execution options:**

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
