# Darkroom Fase 1: el andamiaje — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir lo que Darkroom necesita debajo de la pantalla, siguiendo
`docs/superpowers/specs/2026-09-19-darkroom-design.md` (Parte 1 ya ejecutada
como Fase 0; este plan es la Fase 1, Partes 2-5 del spec): el caso nace con
un `backend` (`normal`/`darkroom`) elegido al crearlo e inmutable después, el
candado de trabajo baja de proyecto a caso con exclusión real y expiración
por inactividad, la administración gana la sección «Colaboración» para
gobernarlo, y un caso Darkroom abre `DarkroomView.tsx` con la palabra «ola».

**Architecture:** Backend Rust (`crates/lumid`, `crates/lumi-proto`) primero
por tarea, cliente React después dentro de la misma tarea cuando dependen
del mismo endpoint — así cada tarea es un cambio end-to-end comprobable, no
una mitad de API sin nada que la llame. El orden de tareas difiere del orden
de pasos del spec: la sección «Colaboración» (paso 6 del spec) se adelanta a
la Tarea 2 porque las Tareas 3-5 leen sus ajustes (`caso_exclusivo`,
`caso_liberar_s`, `caso_expulsar_rol`, `proyecto_max_personas`) — construirlas
primero evita que esas tareas hardcodeen valores que luego haya que
desenchufar.

**Tech Stack:** Rust (axum, rusqlite, tokio) en `crates/lumid` y
`crates/lumi-proto`; TypeScript/React en `client/`.

## Global Constraints

- **El backend del caso se fija al crear y no se cambia.** `PATCH /v1/cases/:id` (rename) no toca el campo; no existe ningún endpoint para cambiarlo (spec Parte 2).
- **El candado es del caso, no del proyecto.** Varias personas comparten un proyecto; una sola tiene un caso dado a la vez, si `caso_exclusivo` está activo (spec Parte 3).
- **Las lecturas nunca chocan con el candado.** El criterio es el método HTTP: `GET`/`HEAD` pasan siempre; `POST`/`PATCH`/`PUT`/`DELETE` exigen tener el caso. Un administrador nunca se queda fuera de algo que administra (spec Parte 3, punto 1).
- **`case_locks` sustituye a `project_locks`.** Misma forma de fila (`case_id`/`user_id`/`token`/`since`), sin migración de datos — un candado abandonado en la migración no es una pérdida real, es estado efímero (spec Parte 3).
- **Los cuatro ajustes de «Colaboración» son globales**, no por proyecto ni por caso (spec Parte 4, nota de alcance). Defectos exactos: `caso_exclusivo` = activado; `caso_liberar_s` = 1800 (30 min); `caso_expulsar_rol` = `admin_o_dueno`; `proyecto_max_personas` = 0 (sin tope).
- **`DarkroomView.tsx` es una vista hermana de `CaseView`, no una pestaña dentro de ella.** El candado, la expulsión por inactividad y la barra de título son del caso y funcionan igual en las dos vistas (spec Parte 5).
- **Nada de esto toca el grafo de archivos/clases/propiedades de Darkroom** (spec 2, fuera de alcance — spec Parte 6).
- **No hay tests salvo `cargo test -p lumi-proto`** (convención del repo) — cada tarea cierra con `cargo build`, `npx tsc -b --noEmit` y `npm run lint` en verde, no con una suite nueva.
- Idioma español en comentarios, commits y copy de UI.
- Un commit por tarea (o por grupo coherente de pasos dentro de ella).

---

### Task 1: `backend` del caso — columna, tipos y elección al crear

**Files:**
- Modify: `crates/lumid/src/store.rs:564` (lista de `ALTER TABLE` en `migrate()`)
- Modify: `crates/lumi-proto/src/api.rs:821-836` (`struct Case`), tras `:780` (`struct NameReq`)
- Modify: `crates/lumid/src/routes/cases.rs` (`list`, `create`)
- Modify: `client/src/lib/api.ts` (`interface Case`)
- Modify: `client/src/ui/PromptDialog.tsx` (slot `extra` opcional)
- Modify: `client/src/work/ProjectView.tsx` (elección de backend al crear)
- Modify: `client/src/work/CaseRow.tsx` (distintivo visual Darkroom)

**Interfaces:**
- Consumes: nada de tareas anteriores (primera tarea).
- Produces: `Case.backend: string` (`"normal"` | `"darkroom"`) en Rust y TS — lo consume la Tarea 7 (`App.tsx` bifurca por él) y la Tarea 3 (`cases::list` reconstruye el `SELECT` añadiendo columnas de candado, partiendo de este `SELECT`).

- [ ] **Step 1: Columna `backend` en `cases`**

En `crates/lumid/src/store.rs`, dentro de `fn migrate()`, el array de `ALTER TABLE` termina así (línea 563-565):

```rust
        ("analyses", "grupo_id", "TEXT"),
    ] {
        let _ = c.execute(&format!("ALTER TABLE {table} ADD COLUMN {col} {decl}"), []);
```

Añadir una tupla nueva justo antes del cierre `]`:

```rust
        ("analyses", "grupo_id", "TEXT"),
        ("cases", "backend", "TEXT NOT NULL DEFAULT 'normal'"),
    ] {
        let _ = c.execute(&format!("ALTER TABLE {table} ADD COLUMN {col} {decl}"), []);
```

Los casos existentes quedan en `'normal'` por el `DEFAULT` — sin migración de datos, tal como especifica la Parte 2 del spec.

- [ ] **Step 2: `Case` y `CaseReq` en `lumi-proto`**

En `crates/lumi-proto/src/api.rs`, el `struct Case` (líneas 821-836) gana el campo `backend`:

```rust
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Case {
    pub id: i64,
    pub project_id: i64,
    pub name: String,
    pub backend: String,
    pub images: i64,
    pub analyses: i64,
    /// Análisis con resultado. La vista de proyecto pinta un marcador por caso
    /// resuelto, y necesita saber si hay alguno sin traerse la lista entera.
    pub resolved: i64,
    /// Del análisis resuelto más reciente, para el marcador. `None` mientras
    /// no haya motor.
    pub lat: Option<f64>,
    pub lng: Option<f64>,
    pub created_at: i64,
}
```

Justo después de `struct NameReq` (línea 776-780), añadir el cuerpo de creación de caso — `NameReq` se sigue usando para renombrar (casos y proyectos), pero crear un caso ahora manda también el backend:

```rust
/// Crear un caso manda además el backend elegido -- a diferencia de
/// `NameReq`, que sigue sirviendo para renombrar (el backend no se puede
/// cambiar después de crear, spec Darkroom Parte 2).
#[derive(Serialize, Deserialize)]
pub struct CaseReq {
    pub name: String,
    pub backend: String,
}
```

- [ ] **Step 3: `cases::list` y `cases::create` en el daemon**

En `crates/lumid/src/routes/cases.rs`, cambiar el import de la línea 10:

```rust
use lumi_proto::api::{Case, CaseReq, NameReq};
```

Reemplazar `list` (líneas 64-102) para traer `backend`:

```rust
pub async fn list(
    State(app): State<App>,
    Path(project_id): Path<i64>,
    headers: HeaderMap,
) -> Result<Json<Vec<Case>>, Fail> {
    guard_project(&app, &headers, project_id)?;
    let c = app.store.conn();
    let mut q = c
        .prepare(
            "SELECT k.id, k.project_id, k.name, k.backend, k.created_at,
                    (SELECT COUNT(*) FROM images WHERE case_id = k.id),
                    (SELECT COUNT(*) FROM analyses WHERE case_id = k.id),
                    (SELECT COUNT(*) FROM analyses WHERE case_id = k.id AND state = 'hecho'),
                    (SELECT result_lat FROM analyses WHERE case_id = k.id AND state = 'hecho'
                      ORDER BY finished_at DESC LIMIT 1),
                    (SELECT result_lng FROM analyses WHERE case_id = k.id AND state = 'hecho'
                      ORDER BY finished_at DESC LIMIT 1)
             FROM cases k WHERE k.project_id = ?1 ORDER BY k.created_at",
        )
        .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;
    let rows = q
        .query_map([project_id], |r| {
            Ok(Case {
                id: r.get(0)?,
                project_id: r.get(1)?,
                name: r.get(2)?,
                backend: r.get(3)?,
                created_at: r.get(4)?,
                images: r.get(5)?,
                analyses: r.get(6)?,
                resolved: r.get(7)?,
                lat: r.get(8)?,
                lng: r.get(9)?,
            })
        })
        .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?
        .flatten()
        .collect();
    Ok(Json(rows))
}
```

Reemplazar `create` (líneas 104-136) para validar y guardar el backend:

```rust
pub async fn create(
    State(app): State<App>,
    Path(project_id): Path<i64>,
    headers: HeaderMap,
    Json(req): Json<CaseReq>,
) -> Result<Json<Case>, Fail> {
    guard_project(&app, &headers, project_id)?;
    let name = req.name.trim();
    if name.is_empty() || name.chars().count() > MAX_NAME {
        return Err(err(StatusCode::BAD_REQUEST, "el nombre está vacío o pasa de 80 caracteres"));
    }
    if req.backend != "normal" && req.backend != "darkroom" {
        return Err(err(StatusCode::BAD_REQUEST, "backend debe ser \"normal\" o \"darkroom\""));
    }
    let t = now();
    let c = app.store.conn();
    c.execute(
        "INSERT INTO cases (project_id, name, backend, created_at) VALUES (?1, ?2, ?3, ?4)",
        rusqlite::params![project_id, name, req.backend, t],
    )
    .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;
    let id = c.last_insert_rowid();
    let _ = c.execute("UPDATE projects SET updated_at = ?1 WHERE id = ?2", rusqlite::params![t, project_id]);
    tracing::info!("caso \"{name}\" ({}) creado en el proyecto {project_id}", req.backend);
    Ok(Json(Case {
        id,
        project_id,
        name: name.to_string(),
        backend: req.backend,
        images: 0,
        analyses: 0,
        resolved: 0,
        lat: None,
        lng: None,
        created_at: t,
    }))
}
```

`rename` (líneas 138-154) no cambia: sigue tomando `NameReq`, no toca `backend`.

- [ ] **Step 4: Compilar el daemon**

```bash
cargo build -p lumid -p lumi-proto
```

Esperado: compila limpio. Si falla por otros llamantes de `Case { ... }` sin el campo `backend` (por ejemplo en `routes/export.rs` si construye un `Case` a mano — comprobar con el propio error del compilador), añadir `backend: r.get(N)?` o el valor correspondiente en cada uno.

- [ ] **Step 5: `Case` en el cliente**

En `client/src/lib/api.ts`, la interfaz `Case` (líneas 354-358) gana el campo:

```ts
export interface Case {
  id: number; project_id: number; name: string; backend: "normal" | "darkroom";
  images: number; analyses: number; resolved: number;
  lat: number | null; lng: number | null; created_at: number;
}
```

- [ ] **Step 6: Slot `extra` en `PromptDialog`**

`PromptDialog` es un componente genérico compartido por la creación de proyectos y de casos, y su propio comentario dice que «todo lo demás se decide después, dentro» — pero el backend de un caso es la excepción: es inmutable tras crear, así que tiene que elegirse en este mismo diálogo. En vez de ensuciar el componente con lógica de casos, se le añade un slot opcional neutro.

En `client/src/ui/PromptDialog.tsx`, añadir `extra` a la desestructuración de props (línea 17) y al tipo (tras `onConfirm`, línea 31-32):

```tsx
export function PromptDialog({
  open, icon = "folder", title, subtitle, placeholder, confirmLabel = "Crear",
  taken = [], busy, error, chrome = false, extra, onConfirm, onClose,
}: {
  open: boolean;
  icon?: "folder" | "pin";
  title: string;
  subtitle?: string;
  placeholder: string;
  confirmLabel?: string;
  taken?: string[];
  busy: boolean;
  error: string | null;
  chrome?: boolean;
  /** Controles extra entre el campo y los botones -- hoy solo lo usa la
   *  elección de backend al crear un caso Darkroom. Nada más debería
   *  necesitarlo: lo que se decide después de crear no pertenece aquí. */
  extra?: React.ReactNode;
  onConfirm: (value: string) => void;
  onClose: () => void;
}) {
```

Y renderizarlo justo después del bloque de error (línea 73), antes de la fila de botones:

```tsx
            {choca && <p className="mt-1.5 text-[10.5px] text-warning-fg">ya existe uno con ese nombre</p>}
            {error && <p className="mt-1.5 text-[10.5px] leading-snug text-danger-fg">{error}</p>}
            {extra}

            <div className="mt-3.5 flex items-center gap-2">
```

- [ ] **Step 7: Elegir backend al crear un caso**

En `client/src/work/ProjectView.tsx`, añadir el estado y el selector. Tras el estado existente (línea 24):

```tsx
  const [error, setError] = useState<string | null>(null);
  const [backend, setBackend] = useState<"normal" | "darkroom">("normal");
```

Cambiar `create` (líneas 52-63) para mandar el backend y resetearlo al cerrar:

```tsx
  async function create(name: string) {
    setBusy(true); setError(null);
    try {
      const c = await api.post<Case>(`/v1/projects/${project.id}/cases`, { name, backend }, token);
      setCreating(false);
      setBackend("normal");
      onOpenCase(c);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
```

Y el `PromptDialog` de creación (líneas 135-139) gana el selector vía `extra`:

```tsx
      <PromptDialog open={creating} chrome icon="pin"
        title={`Nuevo caso en «${project.name}»`} subtitle="un caso, un sitio que averiguar"
        placeholder="Muelle 7" taken={list.map((c) => c.name)}
        busy={busy} error={error}
        extra={
          <div className="mt-3 flex gap-1.5 rounded-[9px] border border-border bg-[#0d0f12] p-1">
            {([["normal", "Normal"], ["darkroom", "Darkroom"]] as const).map(([v, label]) => (
              <button key={v} type="button" onClick={() => setBackend(v)}
                disabled={busy}
                className={`flex-1 rounded-[7px] py-[7px] text-[11.5px] transition-colors duration-300 ease-expo ${
                  backend === v ? "bg-white/[.1] text-fg" : "text-subtle hover:text-fg"}`}>
                {label}
              </button>
            ))}
          </div>
        }
        onConfirm={create}
        onClose={() => { setCreating(false); setError(null); setBackend("normal"); }} />
```

- [ ] **Step 8: Distintivo visual del caso Darkroom**

En `client/src/work/CaseRow.tsx`, añadir el icono `boxes` (ya existe en `client/src/ui/Icon.tsx`, sin dibujar uno nuevo — DESIGN.md pide reusar el set canónico) junto al nombre del caso cuando `backend === "darkroom"`. Import al principio del fichero:

```tsx
import { Icon } from "../ui/Icon";
```

Y el nombre del caso (línea 80) gana el distintivo delante:

```tsx
      <span className="flex min-w-0 flex-1 items-center gap-1.5 truncate text-[12.5px] text-fg">
        {case_.backend === "darkroom" && (
          <span className="shrink-0 text-subtle" title="caso Darkroom">
            <Icon name="boxes" size={12} />
          </span>
        )}
        <span className="truncate">{case_.name}</span>
      </span>
```

(Sustituye la línea `<span className="min-w-0 flex-1 truncate text-[12.5px] text-fg">{case_.name}</span>` completa.)

- [ ] **Step 9: Comprobar el cliente**

```bash
cd client && npx tsc -b --noEmit && npm run lint
```

Esperado: limpio.

- [ ] **Step 10: Commit**

```bash
git add crates/lumid/src/store.rs crates/lumi-proto/src/api.rs crates/lumid/src/routes/cases.rs \
  client/src/lib/api.ts client/src/ui/PromptDialog.tsx client/src/work/ProjectView.tsx client/src/work/CaseRow.tsx
git commit -m "feat(darkroom): el caso nace con un backend, normal o darkroom (fase 1, paso 1/7)"
```

---

### Task 2: La sección «Colaboración» del panel de administración

**Files:**
- Modify: `crates/lumi-proto/src/api.rs` (tras `PatchRendimientoReq`, línea 527)
- Create: `crates/lumid/src/routes/colaboracion.rs`
- Modify: `crates/lumid/src/routes/mod.rs:32` (`pub mod colaboracion;`)
- Modify: `crates/lumid/src/main.rs:310` (ruta nueva)
- Modify: `client/src/lib/api.ts` (`interface ColaboracionSettings`)
- Create: `client/src/admin/ColaboracionView.tsx`
- Modify: `client/src/admin/Sidebar.tsx` (sección nueva)
- Modify: `client/src/admin/AdminPanel.tsx` (registro de la vista)

**Interfaces:**
- Consumes: nada de la Tarea 1.
- Produces: cuatro funciones públicas que las Tareas 3-5 llaman directamente — `colaboracion::caso_exclusivo(&App) -> bool`, `colaboracion::caso_liberar_s(&App) -> i64`, `colaboracion::caso_expulsar_rol(&App) -> String`, `colaboracion::proyecto_max_personas(&App) -> i64`.

- [ ] **Step 1: Tipos en `lumi-proto`**

En `crates/lumi-proto/src/api.rs`, justo después de `PatchRendimientoReq` (línea 523-527):

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ColaboracionSettings {
    pub caso_exclusivo: bool,
    pub caso_liberar_s: i64,
    /// `"admin"` | `"admin_o_dueno"` | `"cualquier_miembro"`.
    pub caso_expulsar_rol: String,
    /// `0` = sin tope.
    pub proyecto_max_personas: i64,
}

#[derive(Debug, Deserialize)]
pub struct PatchColaboracionReq {
    pub caso_exclusivo: Option<bool>,
    pub caso_liberar_s: Option<i64>,
    pub caso_expulsar_rol: Option<String>,
    pub proyecto_max_personas: Option<i64>,
}
```

- [ ] **Step 2: `routes::colaboracion`**

Crear `crates/lumid/src/routes/colaboracion.rs`:

```rust
//! GET/PATCH de la sección «Colaboración» del panel de administración: la
//! exclusividad del candado de caso, su plazo de liberación por inactividad,
//! quién puede expulsar a quien lo tiene, y el tope de personas simultáneas
//! por proyecto. Mismo patrón que `routes::rendimiento`: meta clave-valor en
//! `Store`, sin tabla propia (Darkroom Fase 1 spec, Parte 4).

use crate::routes::auth::{bearer, require_admin};
use crate::App;
use axum::extract::State;
use axum::{http::HeaderMap, http::StatusCode, Json};
use lumi_proto::api::{ColaboracionSettings, PatchColaboracionReq};

const CLAVE_EXCLUSIVO: &str = "caso_exclusivo";
const CLAVE_LIBERAR_S: &str = "caso_liberar_s";
const CLAVE_EXPULSAR_ROL: &str = "caso_expulsar_rol";
const CLAVE_MAX_PERSONAS: &str = "proyecto_max_personas";

const DEFECTO_LIBERAR_S: i64 = 1800;
const DEFECTO_EXPULSAR_ROL: &str = "admin_o_dueno";

/// El candado se sigue tomando y mostrando con este ajuste apagado -- lo
/// único que cambia es que `guard_case` deja de hacerlo cumplir (spec Parte
/// 4, "Qué pasa con la exclusividad apagada"). Nace activado.
pub fn caso_exclusivo(app: &App) -> bool {
    app.store.get_meta(CLAVE_EXCLUSIVO).as_deref() != Some("0")
}

pub fn caso_liberar_s(app: &App) -> i64 {
    app.store.get_meta(CLAVE_LIBERAR_S).and_then(|v| v.parse().ok()).unwrap_or(DEFECTO_LIBERAR_S)
}

pub fn caso_expulsar_rol(app: &App) -> String {
    app.store.get_meta(CLAVE_EXPULSAR_ROL).unwrap_or_else(|| DEFECTO_EXPULSAR_ROL.to_string())
}

pub fn proyecto_max_personas(app: &App) -> i64 {
    app.store.get_meta(CLAVE_MAX_PERSONAS).and_then(|v| v.parse().ok()).unwrap_or(0)
}

fn settings(app: &App) -> ColaboracionSettings {
    ColaboracionSettings {
        caso_exclusivo: caso_exclusivo(app),
        caso_liberar_s: caso_liberar_s(app),
        caso_expulsar_rol: caso_expulsar_rol(app),
        proyecto_max_personas: proyecto_max_personas(app),
    }
}

pub async fn get(State(app): State<App>, headers: HeaderMap) -> Result<Json<ColaboracionSettings>, StatusCode> {
    require_admin(&app, &bearer(&headers))?;
    Ok(Json(settings(&app)))
}

pub async fn patch(
    State(app): State<App>,
    headers: HeaderMap,
    Json(req): Json<PatchColaboracionReq>,
) -> Result<Json<ColaboracionSettings>, (StatusCode, String)> {
    let admin = require_admin(&app, &bearer(&headers)).map_err(|c| (c, "hace falta ser administrador".to_string()))?;
    if let Some(v) = req.caso_exclusivo {
        app.store
            .set_meta(CLAVE_EXCLUSIVO, if v { "1" } else { "0" })
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        tracing::info!("exclusividad de caso {} por el administrador {admin}", if v { "activada" } else { "desactivada" });
    }
    if let Some(v) = req.caso_liberar_s {
        if !(60..=86400).contains(&v) {
            return Err((StatusCode::BAD_REQUEST, "debe estar entre 60 y 86400 segundos".to_string()));
        }
        app.store
            .set_meta(CLAVE_LIBERAR_S, &v.to_string())
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        tracing::info!("plazo de liberación de caso fijado a {v}s por el administrador {admin}");
    }
    if let Some(v) = req.caso_expulsar_rol {
        if !["admin", "admin_o_dueno", "cualquier_miembro"].contains(&v.as_str()) {
            return Err((StatusCode::BAD_REQUEST, "debe ser \"admin\", \"admin_o_dueno\" o \"cualquier_miembro\"".to_string()));
        }
        app.store
            .set_meta(CLAVE_EXPULSAR_ROL, &v)
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        tracing::info!("rol de expulsión de caso fijado a \"{v}\" por el administrador {admin}");
    }
    if let Some(v) = req.proyecto_max_personas {
        if v < 0 {
            return Err((StatusCode::BAD_REQUEST, "no puede ser negativo".to_string()));
        }
        app.store
            .set_meta(CLAVE_MAX_PERSONAS, &v.to_string())
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        tracing::info!("tope de personas por proyecto fijado a {v} por el administrador {admin}");
    }
    Ok(Json(settings(&app)))
}
```

- [ ] **Step 3: Registrar el módulo y la ruta**

En `crates/lumid/src/routes/mod.rs`, añadir en orden alfabético tras `pub mod claim;` (línea 13):

```rust
pub mod colaboracion;
```

En `crates/lumid/src/main.rs`, junto a la ruta de rendimiento (línea 310):

```rust
        .route("/v1/admin/rendimiento", get(routes::rendimiento::get).patch(routes::rendimiento::patch))
        .route("/v1/admin/colaboracion", get(routes::colaboracion::get).patch(routes::colaboracion::patch))
```

- [ ] **Step 4: Compilar el daemon**

```bash
cargo build -p lumid -p lumi-proto
```

Esperado: compila limpio.

- [ ] **Step 5: Tipo en el cliente**

En `client/src/lib/api.ts`, añadir junto a los demás tipos de ajustes de admin (cerca de `SecuritySettings`):

```ts
export interface ColaboracionSettings {
  caso_exclusivo: boolean;
  caso_liberar_s: number;
  caso_expulsar_rol: "admin" | "admin_o_dueno" | "cualquier_miembro";
  proyecto_max_personas: number;
}
```

- [ ] **Step 6: `ColaboracionView.tsx`**

Crear `client/src/admin/ColaboracionView.tsx`, siguiendo el patrón de `SecurityView.tsx` (`Fila`/`SubFila`, `grid-template-rows: 0fr → 1fr` solo bajo el interruptor de exclusividad, ya que los otros tres ajustes aplican independientemente de él — spec Parte 4, "Qué pasa con la exclusividad apagada"):

```tsx
import { useEffect, useState } from "react";
import { api, type ColaboracionSettings } from "../lib/api";
import { Seccion } from "./Seccion";

const DEFECTO_LIBERAR_MIN = 30;

/** «Colaboración»: los cuatro ajustes que gobiernan el candado de caso de
 *  Darkroom -- Parte 4 del spec 2026-09-19. Son globales, no por proyecto:
 *  no hay ningún otro ámbito de configuración en todo el repo salvo global
 *  (`meta`) o por usuario (`limits`), y abrir un tercero por cuatro
 *  interruptores sería una puerta grande por una razón pequeña. */
export function ColaboracionView({ token, ajustes, onCambiar }: {
  token: string; ajustes: ColaboracionSettings | null; onCambiar: (s: ColaboracionSettings) => void;
}) {
  const [minutos, setMinutos] = useState(String(DEFECTO_LIBERAR_MIN));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (ajustes) setMinutos(String(Math.round(ajustes.caso_liberar_s / 60)));
  }, [ajustes?.caso_liberar_s]);

  async function fijar(patch: Partial<ColaboracionSettings>) {
    setError(null);
    try {
      const r = await api.patch<ColaboracionSettings>("/v1/admin/colaboracion", patch, token);
      onCambiar(r);
    } catch (e) {
      setError(String(e));
    }
  }

  async function guardarPlazo() {
    const min = Number(minutos);
    if (!Number.isFinite(min) || min < 1 || min > 1440) {
      setError("debe ser un número de minutos entre 1 y 1440");
      return;
    }
    await fijar({ caso_liberar_s: Math.round(min * 60) });
  }

  if (!ajustes) return null;

  return (
    <Seccion titulo="Colaboración" grupo="Servidor">
      <p className="text-[11px] text-muted">Quién puede compartir un caso, y qué pasa cuando alguien se va sin avisar.</p>

      <div className="mt-4 rounded-card border border-border bg-panel">
        <Fila titulo="Exclusividad de caso" sub="Una sola persona a la vez dentro de cada caso. Apagado, varias personas pueden abrirlo a la vez."
          on={ajustes.caso_exclusivo} onClick={() => void fijar({ caso_exclusivo: !ajustes.caso_exclusivo })} />
      </div>

      <div className="mt-3 rounded-card border border-border bg-panel p-[13px_16px]">
        <label className="mb-1.5 block text-[9.5px] uppercase tracking-[.06em] text-muted">
          Plazo de liberación por inactividad
        </label>
        <div className="flex items-center gap-1.5">
          <input value={minutos} onChange={(e) => setMinutos(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void guardarPlazo(); }}
            inputMode="numeric"
            className="w-16 rounded-lg border border-border bg-elevated px-2 py-1 text-right font-mono text-[11px]
              text-fg outline-none transition-colors duration-300 ease-expo focus:border-white/40" />
          <span className="text-[10.5px] text-subtle">min</span>
          <button onClick={() => void guardarPlazo()}
            disabled={Number(minutos) === Math.round(ajustes.caso_liberar_s / 60)}
            className="jg-press ml-1 rounded-lg border border-white/15 px-2.5 py-1 text-[10.5px] text-fg disabled:opacity-40">
            Guardar
          </button>
        </div>
      </div>

      <div className="mt-3 rounded-card border border-border bg-panel p-[13px_16px]">
        <label className="mb-1.5 block text-[9.5px] uppercase tracking-[.06em] text-muted">Quién puede expulsar</label>
        <select value={ajustes.caso_expulsar_rol}
          onChange={(e) => void fijar({ caso_expulsar_rol: e.target.value as ColaboracionSettings["caso_expulsar_rol"] })}
          className="w-full rounded-lg border border-border bg-elevated px-2.5 py-[7px] text-[11.5px] text-fg
            outline-none transition-colors duration-300 ease-expo focus:border-white/40">
          <option value="admin">Solo administradores</option>
          <option value="admin_o_dueno">Administradores y el dueño del proyecto</option>
          <option value="cualquier_miembro">Cualquier miembro del proyecto</option>
        </select>
      </div>

      <div className="mt-3 rounded-card border border-border bg-panel p-[13px_16px]">
        <label className="mb-1.5 block text-[9.5px] uppercase tracking-[.06em] text-muted">
          Tope de personas por proyecto
        </label>
        <div className="flex items-center gap-1.5">
          <input value={ajustes.proyecto_max_personas}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (Number.isFinite(v) && v >= 0) void fijar({ proyecto_max_personas: Math.round(v) });
            }}
            inputMode="numeric"
            className="w-16 rounded-lg border border-border bg-elevated px-2 py-1 text-right font-mono text-[11px]
              text-fg outline-none transition-colors duration-300 ease-expo focus:border-white/40" />
          <span className="text-[10.5px] text-subtle">personas simultáneas (0 = sin tope)</span>
        </div>
      </div>

      {error && <p className="mt-2 text-[10.5px] text-danger-fg">{error}</p>}
    </Seccion>
  );
}

function Fila({ titulo, sub, on, onClick }: { titulo: string; sub: string; on: boolean; onClick: () => void }) {
  return (
    <div className="flex items-center gap-3.5 border-b border-border p-[13px_16px] last:border-b-0">
      <button onClick={onClick}
        className={`relative h-[21px] w-9 shrink-0 cursor-pointer rounded-full border transition-colors duration-300 ease-expo ${
          on ? "border-white/30 bg-white/[.14]" : "border-border bg-elevated"}`}>
        <span className={`absolute left-[2px] top-[2px] h-[15px] w-[15px] rounded-full transition-transform duration-300 ease-expo ${
          on ? "translate-x-[15px] bg-fg" : "bg-subtle"}`} />
      </button>
      <div className="min-w-0">
        <p className="text-[12px] text-fg">{titulo}</p>
        <p className="mt-0.5 text-[10px] text-subtle">{sub}</p>
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Registrar la sección en el panel**

En `client/src/admin/Sidebar.tsx`, añadir `"colaboracion"` al tipo `Seccion` (línea 9-12) y una entrada en el grupo «Servidor» (línea 17-29), junto a `seguridad`:

```tsx
export type Seccion =
  | "resumen" | "modelos" | "personalizacion" | "indices" | "seguridad" | "colaboracion" | "claves" | "red"
  | "solicitudes" | "usuarios"
  | "cola" | "notificaciones" | "hardware" | "doctor" | "actualizaciones" | "calibracion";
```

```tsx
      { id: "seguridad", label: "Seguridad", icon: "shield" },
      { id: "colaboracion", label: "Colaboración", icon: "users" },
```

En `client/src/admin/AdminPanel.tsx`, importar el componente junto a `SecurityView` (línea 10):

```tsx
import { ColaboracionView } from "./ColaboracionView";
```

Y añadir su estado y su rama, siguiendo el patrón exacto de `seguridad`/`SecuritySettings` que ya usa el fichero (busca `useState<SecuritySettings | null>` y el `GET /v1/admin/security` inicial en `AdminPanel.tsx`, y replica el mismo par `useState`/`useEffect` de carga para `colaboracion`/`ColaboracionSettings` apuntando a `/v1/admin/colaboracion`). La rama en la cadena ternaria del render (junto a la línea `: seccion === "seguridad" ? <SecurityView .../>`):

```tsx
          : seccion === "colaboracion" ? <ColaboracionView token={token} ajustes={colaboracion} onCambiar={setColaboracion} />
```

- [ ] **Step 8: Comprobar el cliente**

```bash
cd client && npx tsc -b --noEmit && npm run lint
```

Esperado: limpio.

- [ ] **Step 9: Commit**

```bash
git add crates/lumi-proto/src/api.rs crates/lumid/src/routes/colaboracion.rs crates/lumid/src/routes/mod.rs \
  crates/lumid/src/main.rs client/src/lib/api.ts client/src/admin/ColaboracionView.tsx \
  client/src/admin/Sidebar.tsx client/src/admin/AdminPanel.tsx
git commit -m "feat(darkroom): sección Colaboración en el panel de administración (fase 1, paso 6/7 del spec)"
```

---

### Task 3: `case_locks` y el traslado de `enter`/`leave`/`kick`

**Files:**
- Modify: `crates/lumid/src/store.rs` (`SCHEMA`, migración de un solo uso)
- Modify: `crates/lumi-proto/src/api.rs` (`struct Project`, `struct Case`, `enum Cambio::Expulsion`)
- Modify: `crates/lumid/src/routes/cases.rs` (`enter`/`leave`/`kick` nuevos, `list` gana candado)
- Modify: `crates/lumid/src/routes/projects.rs` (borra `enter`/`leave`/`kick`/`STALE_AFTER`, `list` cuenta casos ocupados, `remove` ya no borra `project_locks`)
- Modify: `crates/lumid/src/main.rs` (rutas movidas de `/v1/projects/:id/...` a `/v1/cases/:id/...`)
- Modify: `client/src/lib/api.ts` (`Project`/`Case`/`Cambio` actualizados)
- Modify: `client/src/App.tsx` (`leaveCase` sustituye a `leaveProject`, `openCase` toma el candado, expulsión por caso)
- Modify: `client/src/work/ProjectPicker.tsx` (sin candado de proyecto)
- Modify: `client/src/work/ProjectView.tsx` (expulsar desde la fila del caso)
- Modify: `client/src/work/CaseRow.tsx` (quién tiene el caso)

**Interfaces:**
- Consumes: `colaboracion::caso_exclusivo`/`caso_liberar_s`/`proyecto_max_personas` (Tarea 2); `Case.backend` (Tarea 1, sin cambios aquí).
- Produces: `POST /v1/cases/:id/enter`, `/leave`, `/kick`; `Case.locked_by`/`locked_by_id`; `Project.casos_ocupados`. La Tarea 4 (exclusión real) y la Tarea 5 (barrido + latido) leen `case_locks` directamente con el mismo criterio que `enter` usa aquí.

- [ ] **Step 1: `case_locks` sustituye a `project_locks` en el esquema**

En `crates/lumid/src/store.rs`, reemplazar el bloque de `CREATE TABLE IF NOT EXISTS project_locks` (líneas 161-169) por:

```sql
-- Quién tiene un caso abierto ahora mismo. Solo una fila por caso: es justo
-- lo que impide que dos personas trabajen en el mismo a la vez. `enter`/
-- `leave`/`kick` en routes/cases.rs son los únicos que la tocan. Sustituye a
-- `project_locks` (candado por proyecto) -- Darkroom Fase 1, 2026-09-21: el
-- candado baja de proyecto a caso porque varias personas ya pueden compartir
-- un proyecto, solo no el mismo caso a la vez.
CREATE TABLE IF NOT EXISTS case_locks (
    case_id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL,
    token   TEXT NOT NULL,
    since   INTEGER NOT NULL
);
```

Añadir la migración de un solo uso, siguiendo el mismo patrón que `migracion_darkroom_borrar_agentes_2026_09_19` (justo después de esa función, tras su línea 600):

```rust
/// El candado de trabajo baja de proyecto a caso (Darkroom Fase 1,
/// 2026-09-19-darkroom-design.md Parte 3): `case_locks` ya nace por el
/// `CREATE TABLE IF NOT EXISTS` de arriba, así que aquí solo hay que quitar
/// la tabla vieja para las instalaciones que ya existían. Sin migración de
/// datos -- un candado es estado efímero, perderlo en el momento exacto de
/// actualizar no es una pérdida real.
fn migracion_darkroom_candado_por_caso_2026_09_21(c: &Connection) {
    let ya_aplicada = c
        .query_row(
            "SELECT v FROM meta WHERE k = 'migracion_darkroom_candado_por_caso_2026_09_21'",
            [],
            |r| r.get::<_, String>(0),
        )
        .is_ok();
    if ya_aplicada {
        return;
    }
    let _ = c.execute_batch("DROP TABLE IF EXISTS project_locks;");
    let _ = c.execute(
        "INSERT OR REPLACE INTO meta (k, v) VALUES ('migracion_darkroom_candado_por_caso_2026_09_21', '1')",
        [],
    );
    tracing::info!("migración darkroom 2026-09-21: candado de proyecto sustituido por candado de caso");
}
```

Y llamarla al principio de `migrate()` (línea 448-449), junto a la de Fase 0:

```rust
fn migrate(c: &Connection) {
    migracion_darkroom_borrar_agentes_2026_09_19(c);
    migracion_darkroom_candado_por_caso_2026_09_21(c);
```

- [ ] **Step 2: `Project`, `Case` y `Cambio::Expulsion` en `lumi-proto`**

En `crates/lumi-proto/src/api.rs`, `struct Project` (líneas 745-763) pierde `locked_by`/`locked_by_id` y gana un contador — ya no hay una sola persona por proyecto que nombrar, puede haber varios casos ocupados por gente distinta:

```rust
pub struct Project {
    pub id: i64,
    pub name: String,
    pub role: String,
    pub cases: i64,
    pub images: i64,
    pub bytes: i64,
    pub created_at: i64,
    pub updated_at: i64,
    /// Cuántos casos de este proyecto tiene alguien abierto ahora mismo
    /// (mismo criterio de validez que antes: sesión viva y candado no
    /// caducado). Ya no hay un candado de proyecto que nombrar a una sola
    /// persona -- puede haber varias, cada una en un caso distinto.
    pub casos_ocupados: i64,
}
```

`struct Case` gana el candado (tras `backend`, junto a los demás campos que ya trajo la Tarea 1):

```rust
pub struct Case {
    pub id: i64,
    pub project_id: i64,
    pub name: String,
    pub backend: String,
    pub images: i64,
    pub analyses: i64,
    pub resolved: i64,
    pub lat: Option<f64>,
    pub lng: Option<f64>,
    pub created_at: i64,
    /// Quién tiene el candado de este caso ahora mismo, si lo tiene alguien
    /// -- mismo criterio que tenía `Project::locked_by` antes de Darkroom
    /// Fase 1: sesión viva y candado no caducado.
    pub locked_by: Option<String>,
    pub locked_by_id: Option<i64>,
}
```

`enum Cambio::Expulsion` pasa de avisar sobre un proyecto a avisar sobre un caso, porque el único `kick` que queda es el de caso (líneas 1068-1069 según la exploración previa, dentro del `enum Cambio`):

```rust
    Expulsion {
        #[serde(skip)]
        user_id: i64,
        case_id: i64,
        case_name: String,
    },
```

Y su brazo en `impl Cambio::user_id` sigue igual de forma (el nombre de los campos no afecta al `match`, solo referencia la variante):

```rust
    pub fn user_id(&self) -> i64 {
        match self {
            Cambio::Estado { user_id, .. }
            | Cambio::Progreso { user_id, .. }
            | Cambio::Expulsion { user_id, .. }
            | Cambio::Cola { user_id, .. }
            | Cambio::Invitacion { user_id, .. }
            | Cambio::Red { user_id, .. } => *user_id,
        }
    }
```

- [ ] **Step 3: Compilar `lumi-proto` para localizar todos los llamantes**

```bash
cargo build -p lumi-proto
cargo build -p lumid 2>&1 | head -80
```

Esperado: `lumi-proto` compila; `lumid` falla en `routes/projects.rs` (usa los campos borrados de `Project` y las funciones que se van a mover) y en cualquier sitio que construya `Cambio::Expulsion` con `project_id`/`project_name`. Esos errores son la guía de los Steps 4-5.

- [ ] **Step 4: Mover `enter`/`leave`/`kick` a `cases.rs`**

En `crates/lumid/src/routes/cases.rs`, añadir al final del fichero (tras `rename`):

```rust
/// Un caso, una persona a la vez -- si `caso_exclusivo` está activo
/// (`routes::colaboracion`). Es la misma cerradura que antes vivía en
/// `project_locks`/`routes::projects`, mudada de ámbito: varias personas ya
/// pueden compartir un proyecto, pero no el mismo caso (spec Darkroom Parte
/// 3). Este 409 es la capa de cortesía -- se comprueba aquí y nada más; la
/// Tarea 4 añade la capa real en `guard_case`, que cubre todas las rutas.
pub async fn enter(State(app): State<App>, Path(id): Path<i64>, headers: HeaderMap) -> Result<StatusCode, Fail> {
    let (uid, pid, _role) = guard_case(&app, &headers, id).await?;
    let token = bearer(&headers);
    let c = app.store.conn();
    if crate::routes::colaboracion::caso_exclusivo(&app) {
        let held: Option<(i64, String, i64)> = c
            .query_row(
                "SELECT user_id, token, since FROM case_locks WHERE case_id = ?1",
                [id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .ok();
        if let Some((holder, holder_token, since)) = held {
            if holder != uid {
                let session_valid = c
                    .query_row(
                        "SELECT 1 FROM sessions WHERE token = ?1 AND expires_at > ?2",
                        rusqlite::params![holder_token, now()],
                        |_| Ok(()),
                    )
                    .is_ok();
                if session_valid && now() - since < crate::routes::colaboracion::caso_liberar_s(&app) {
                    let username: String = c
                        .query_row("SELECT username FROM users WHERE id = ?1", [holder], |r| r.get(0))
                        .unwrap_or_else(|_| "otra persona".into());
                    return Err(err(
                        StatusCode::CONFLICT,
                        &format!(
                            "{username} está trabajando en este caso ahora mismo; solo puede haber una persona dentro a la vez"
                        ),
                    ));
                }
            }
        }
    }
    let tope = crate::routes::colaboracion::proyecto_max_personas(&app);
    if tope > 0 {
        let ya_tenia: bool = c
            .query_row("SELECT 1 FROM case_locks WHERE case_id = ?1 AND user_id = ?2", [id, uid], |_| Ok(()))
            .is_ok();
        if !ya_tenia {
            let personas: i64 = c
                .query_row(
                    "SELECT COUNT(DISTINCT cl.user_id) FROM case_locks cl
                     JOIN cases k ON k.id = cl.case_id
                     JOIN sessions s ON s.token = cl.token AND s.expires_at > ?2
                     WHERE k.project_id = ?1 AND ?2 - cl.since < ?3",
                    rusqlite::params![pid, now(), crate::routes::colaboracion::caso_liberar_s(&app)],
                    |r| r.get(0),
                )
                .unwrap_or(0);
            if personas >= tope {
                return Err(err(
                    StatusCode::CONFLICT,
                    "este proyecto ya tiene el máximo de personas trabajando a la vez que permite el administrador",
                ));
            }
        }
    }
    c.execute(
        "INSERT INTO case_locks (case_id, user_id, token, since) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(case_id) DO UPDATE SET user_id = ?2, token = ?3, since = ?4",
        rusqlite::params![id, uid, lumi_proto::crypto::hash_token(&token), now()],
    )
    .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn leave(State(app): State<App>, Path(id): Path<i64>, headers: HeaderMap) -> Result<StatusCode, Fail> {
    let (uid, _) = require_session(&app, &bearer(&headers)).map_err(|c| (c, "sesión inválida".to_string()))?;
    app.store
        .conn()
        .execute("DELETE FROM case_locks WHERE case_id = ?1 AND user_id = ?2", rusqlite::params![id, uid])
        .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn kick(State(app): State<App>, Path(id): Path<i64>, headers: HeaderMap) -> Result<StatusCode, Fail> {
    let (uid, _pid, role) = guard_case(&app, &headers, id).await?;
    let rol = crate::routes::colaboracion::caso_expulsar_rol(&app);
    let is_admin = crate::routes::auth::require_admin(&app, &bearer(&headers)).is_ok();
    let permitido = match rol.as_str() {
        "cualquier_miembro" => true,
        "admin_o_dueno" => is_admin || role == Role::Owner,
        _ => is_admin,
    };
    if !permitido {
        return Err(err(StatusCode::FORBIDDEN, "no tienes permiso para expulsar a quien tiene este caso"));
    }
    let c = app.store.conn();
    let holder: i64 = c
        .query_row("SELECT user_id FROM case_locks WHERE case_id = ?1", [id], |r| r.get(0))
        .map_err(|_| err(StatusCode::CONFLICT, "no hay nadie dentro de este caso ahora mismo"))?;
    c.execute("DELETE FROM case_locks WHERE case_id = ?1", [id])
        .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;
    let case_name: String = c.query_row("SELECT name FROM cases WHERE id = ?1", [id], |r| r.get(0)).unwrap_or_default();
    tracing::info!("caso #{id} ({case_name}): usuario {holder} expulsado del candado por el usuario {uid}");
    app.queue.difundir(lumi_proto::api::Cambio::Expulsion { user_id: holder, case_id: id, case_name });
    Ok(StatusCode::NO_CONTENT)
}
```

Actualizar el `SELECT` de `list` (Step 3 de la Tarea 1) para traer también el candado -- reemplazar de nuevo la función completa:

```rust
pub async fn list(
    State(app): State<App>,
    Path(project_id): Path<i64>,
    headers: HeaderMap,
) -> Result<Json<Vec<Case>>, Fail> {
    guard_project(&app, &headers, project_id)?;
    let c = app.store.conn();
    let ahora = now();
    let limite = crate::routes::colaboracion::caso_liberar_s(&app);
    let mut q = c
        .prepare(
            "SELECT k.id, k.project_id, k.name, k.backend, k.created_at,
                    (SELECT COUNT(*) FROM images WHERE case_id = k.id),
                    (SELECT COUNT(*) FROM analyses WHERE case_id = k.id),
                    (SELECT COUNT(*) FROM analyses WHERE case_id = k.id AND state = 'hecho'),
                    (SELECT result_lat FROM analyses WHERE case_id = k.id AND state = 'hecho'
                      ORDER BY finished_at DESC LIMIT 1),
                    (SELECT result_lng FROM analyses WHERE case_id = k.id AND state = 'hecho'
                      ORDER BY finished_at DESC LIMIT 1),
                    lk.username, lk.user_id
             FROM cases k
             LEFT JOIN (
               SELECT cl.case_id, u.username, u.id AS user_id
               FROM case_locks cl
               JOIN sessions s ON s.token = cl.token AND s.expires_at > ?2
               JOIN users u ON u.id = cl.user_id
               WHERE ?2 - cl.since < ?3
             ) lk ON lk.case_id = k.id
             WHERE k.project_id = ?1 ORDER BY k.created_at",
        )
        .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;
    let rows = q
        .query_map(rusqlite::params![project_id, ahora, limite], |r| {
            Ok(Case {
                id: r.get(0)?,
                project_id: r.get(1)?,
                name: r.get(2)?,
                backend: r.get(3)?,
                created_at: r.get(4)?,
                images: r.get(5)?,
                analyses: r.get(6)?,
                resolved: r.get(7)?,
                lat: r.get(8)?,
                lng: r.get(9)?,
                locked_by: r.get(10)?,
                locked_by_id: r.get(11)?,
            })
        })
        .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?
        .flatten()
        .collect();
    Ok(Json(rows))
}
```

- [ ] **Step 5: Quitar `enter`/`leave`/`kick` de `projects.rs` y recontar `casos_ocupados`**

En `crates/lumid/src/routes/projects.rs`:

- Borrar por completo las funciones `enter` (líneas 438-478), `leave` (488-498) y `kick` (507-521), y la constante `STALE_AFTER` con su comentario (líneas 431-436).
- En `remove` (bloque de `DELETE` en cascada, línea ~228), quitar la línea `"DELETE FROM project_members WHERE project_id = ?1",` seguida de `"DELETE FROM project_locks WHERE project_id = ?1",` → dejar solo la primera, ya que `case_locks` se borra con las filas de `cases` a través de `DELETE FROM cases WHERE project_id = ?1` únicamente si hay un `ON DELETE CASCADE` -- **no lo hay** (SQLite con claves foráneas no forzadas por defecto en este repo), así que hay que añadir una línea explícita antes del `DELETE FROM cases`:

```rust
            "DELETE FROM case_locks WHERE case_id IN (SELECT id FROM cases WHERE project_id = ?1)",
            "DELETE FROM images   WHERE case_id IN (SELECT id FROM cases WHERE project_id = ?1)",
            "DELETE FROM cases    WHERE project_id = ?1",
            "DELETE FROM project_members WHERE project_id = ?1",
            "DELETE FROM projects WHERE id = ?1",
```

- Reemplazar `list` (líneas 57-134) para contar casos ocupados en vez de nombrar a quien tiene el proyecto:

```rust
pub async fn list(State(app): State<App>, headers: HeaderMap) -> Result<Json<Vec<Project>>, Fail> {
    let (uid, _) = require_session(&app, &bearer(&headers))
        .map_err(|c| (c, "sesión inválida".to_string()))?;
    let c = app.store.conn();
    let ahora = now();
    let limite = crate::routes::colaboracion::caso_liberar_s(&app);
    let mut q = c
        .prepare(
            "SELECT p.id, p.name, m.role, p.created_at, p.updated_at,
                    COALESCE(kc.n, 0), COALESCE(ic.n, 0), COALESCE(ic.bytes, 0),
                    COALESCE(lk.n, 0)
             FROM projects p
             JOIN project_members m ON m.project_id = p.id
             LEFT JOIN (
               SELECT c.project_id AS project_id, COUNT(*) AS n
               FROM cases c
               JOIN project_members pm ON pm.project_id = c.project_id
               WHERE pm.user_id = ?1 AND pm.status = 'accepted'
               GROUP BY c.project_id
             ) kc ON kc.project_id = p.id
             LEFT JOIN (
               SELECT k.project_id AS project_id, COUNT(*) AS n, SUM(i.bytes) AS bytes
               FROM images i
               JOIN cases k ON k.id = i.case_id
               JOIN project_members pm ON pm.project_id = k.project_id
               WHERE pm.user_id = ?1 AND pm.status = 'accepted'
               GROUP BY k.project_id
             ) ic ON ic.project_id = p.id
             -- Cuántos casos de este proyecto tiene alguien abierto ahora
             -- mismo -- mismo criterio de validez que antes tenía el
             -- candado de proyecto: sesión viva y candado no caducado.
             LEFT JOIN (
               SELECT k.project_id AS project_id, COUNT(*) AS n
               FROM case_locks cl
               JOIN cases k ON k.id = cl.case_id
               JOIN sessions s ON s.token = cl.token AND s.expires_at > ?2
               WHERE ?2 - cl.since < ?3
               GROUP BY k.project_id
             ) lk ON lk.project_id = p.id
             WHERE m.user_id = ?1 AND m.status = 'accepted'
             ORDER BY p.updated_at DESC",
        )
        .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;
    let rows = q
        .query_map(rusqlite::params![uid, ahora, limite], |r| {
            Ok(Project {
                id: r.get(0)?,
                name: r.get(1)?,
                role: r.get(2)?,
                created_at: r.get(3)?,
                updated_at: r.get(4)?,
                cases: r.get(5)?,
                images: r.get(6)?,
                bytes: r.get(7)?,
                casos_ocupados: r.get(8)?,
            })
        })
        .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?
        .flatten()
        .collect();
    Ok(Json(rows))
}
```

- En `create` (líneas 136-181), reemplazar el `Ok(Json(Project { ... }))` final: quitar `locked_by: None, locked_by_id: None,` y añadir `casos_ocupados: 0,`.

- [ ] **Step 6: Mover las rutas en `main.rs`**

Quitar (líneas 380-382):

```rust
        .route("/v1/projects/:id/enter", post(routes::projects::enter))
        .route("/v1/projects/:id/leave", post(routes::projects::leave))
        .route("/v1/projects/:id/kick", post(routes::projects::kick))
```

Y añadir, junto al resto de rutas de `cases` (tras la línea 391, `/v1/cases/:id`):

```rust
        .route("/v1/cases/:id/enter", post(routes::cases::enter))
        .route("/v1/cases/:id/leave", post(routes::cases::leave))
        .route("/v1/cases/:id/kick", post(routes::cases::kick))
```

- [ ] **Step 7: Compilar el daemon**

```bash
cargo build -p lumid -p lumi-proto
```

Esperado: compila limpio. Revisar cualquier otro constructor de `Project`/`Cambio::Expulsion` que el compilador señale fuera de `routes/projects.rs` y `routes/cases.rs` (por ejemplo si `routes/admin.rs` o similar construyen un `Project` a mano para una respuesta de resumen).

- [ ] **Step 8: `Project`, `Case` y `Cambio` en el cliente**

En `client/src/lib/api.ts`:

```ts
export interface Project {
  id: number; name: string; role: string;
  cases: number; images: number; bytes: number;
  created_at: number; updated_at: number;
  casos_ocupados: number;
}
```

```ts
export interface Case {
  id: number; project_id: number; name: string; backend: "normal" | "darkroom";
  images: number; analyses: number; resolved: number;
  lat: number | null; lng: number | null; created_at: number;
  locked_by: string | null; locked_by_id: number | null;
}
```

Y en la unión de `Cambio` (línea 503):

```ts
  | { tipo: "expulsion"; case_id: number; case_name: string }
```

- [ ] **Step 9: `leaveCase`/`openCase` en `App.tsx`, expulsión por caso**

Reemplazar `leaveProject` (líneas 277-287) por `leaveCase`:

```tsx
  /** Solo una persona a la vez dentro de un caso (si `caso_exclusivo` está
   *  activo): salir de verdad tiene que soltar el candado, no solo cambiar
   *  de pantalla. Best effort -- si la llamada falla (red caída, app
   *  cerrándose), el candado caduca solo al cabo del plazo que marca
   *  `caso_liberar_s` en el servidor. */
  function leaveCase() {
    const { case_ } = useWorkspace.getState();
    const token = useServer.getState().token;
    if (case_ && token) {
      void api.post(`/v1/cases/${case_.id}/leave`, {}, token).catch(() => {});
    }
  }

  /** Tomar el candado del caso antes de abrirlo -- si otra persona lo tiene
   *  (y `caso_exclusivo` está activo), rechaza con 409 y no cambia de modo. */
  async function openCase(c: Case) {
    const token = useServer.getState().token;
    if (token) {
      await api.post(`/v1/cases/${c.id}/enter`, {}, token);
    }
    useWorkspace.getState().setCase(c);
    setMode("case");
  }
```

`toProjects` (líneas 336-343) cambia `leaveProject()` por `leaveCase()`:

```tsx
  function toProjects() {
    setAjustesAbiertos(false);
    leaveCase();
    useWorkspace.getState().clear();
    setDrawer(null);
    setExportOpen(false);
    setMode("picker");
  }
```

El efecto de expulsión (líneas 130-146) pasa a comparar por caso:

```tsx
  const [expulsadoDe, setExpulsadoDe] = useState<string | null>(null);
  useEffect(() => {
    const un = listen<Cambio>("queue-change", (e) => {
      const c = e.payload;
      if (c.tipo !== "expulsion") return;
      if (useWorkspace.getState().case_?.id !== c.case_id) return;
      setExpulsadoDe(c.case_name);
      useWorkspace.getState().setCase(null);
      setMode("project");
      setTimeout(() => setExpulsadoDe(null), 6000);
    });
    return () => { void un.then((f) => f()); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
```

El comentario que precede a este efecto (líneas 130-133 en el original, "El dueño del proyecto...") se actualiza para hablar de caso en vez de proyecto -- mismo contenido, cambia "proyecto" por "caso" y la referencia a `routes::projects::kick` por `routes::cases::kick`.

Los sitios donde se montaba `CaseView`/`ProjectView` (bloque `(() => { ... })()`, visto en la exploración previa) actualizan sus manejadores:

```tsx
              onCases={() => {
                setDrawer(null);
                setExportOpen(false);
                if (mode === "case") { leaveCase(); useWorkspace.getState().setCase(null); setMode("project"); }
              }}
              onMembers={() => setDrawer(drawer === "invite" ? null : "invite")}
              onMedia={mode === "case" ? () => setDrawer(drawer === "media" ? null : "media") : undefined}
              onExport={mode === "case" ? () => setExportOpen((v) => !v) : undefined}
              onAdmin={() => { leaveCase(); setMode("admin"); }}
              onLeave={toProjects} />
```

Y el `onOpenCase` que pasa a `ProjectView` cambia de una función síncrona a `openCase`:

```tsx
            <ProjectView project={project} rail={rail} drawer={cajon}
              onOpenCase={openCase} />
```

- [ ] **Step 10: `ProjectView.tsx` propaga el error de `openCase` y expulsa desde la fila**

El tipo de la prop cambia (línea 15):

```tsx
  onOpenCase: (c: Case) => Promise<void>;
```

`create` (Step 7 de la Tarea 1) espera a `onOpenCase` dentro del mismo `try`:

```tsx
  async function create(name: string) {
    setBusy(true); setError(null);
    try {
      const c = await api.post<Case>(`/v1/projects/${project.id}/cases`, { name, backend }, token);
      setCreating(false);
      setBackend("normal");
      await onOpenCase(c);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
```

Añadir una función `kick` y usar `onOpenCase` con manejo de error en `onOpen` y en el menú:

```tsx
  async function kick(c: Case) {
    setError(null);
    try {
      await api.post(`/v1/cases/${c.id}/kick`, {}, token);
      await load();
    } catch (e) {
      setError(String(e));
    }
  }

  function open(c: Case) {
    setError(null);
    void onOpenCase(c).catch((e) => setError(String(e)));
  }
```

Y en el JSX de `CaseRow` (líneas 106-119):

```tsx
              <CaseRow case_={c} covers={covers.get(c.id) ?? []}
                drag={orden.drag(c.id)}
                onOpen={() => { if (!orden.dragging) open(c); }}
                onMenu={(e) => menuAt(e, c.name, [
                  { label: "Abrir", hint: "↵", onClick: () => open(c) },
                  { label: "Renombrar", hint: "F2", onClick: () => setRenaming(c) },
                  {
                    label: c.locked_by ? `Sacar a ${c.locked_by}` : "Sacar a quien esté dentro",
                    disabled: !c.locked_by,
                    onClick: () => void kick(c),
                  },
                  null,
                  { label: "Eliminar caso", danger: true, onClick: () => void remove(c) },
                ], setMenu)} />
```

- [ ] **Step 11: `CaseRow.tsx` muestra quién tiene el caso**

Añadir el import de `UserTile` y el badge, junto al distintivo Darkroom del Step 8 de la Tarea 1:

```tsx
import { UserTile } from "../ui/UserTile";
```

```tsx
      <span className="flex min-w-0 flex-1 items-center gap-1.5 truncate text-[12.5px] text-fg">
        {case_.backend === "darkroom" && (
          <span className="shrink-0 text-subtle" title="caso Darkroom">
            <Icon name="boxes" size={12} />
          </span>
        )}
        <span className="truncate">{case_.name}</span>
        {case_.locked_by && (
          <span className="shrink-0" title={`${case_.locked_by} está trabajando en este caso ahora mismo`}>
            <UserTile nombre={case_.locked_by} conectado size={14} userId={case_.locked_by_id ?? undefined} />
          </span>
        )}
      </span>
```

- [ ] **Step 12: `ProjectPicker.tsx` sin candado de proyecto**

Simplificar `open` (líneas 83-94) — abrir un proyecto ya no toma ningún candado:

```tsx
  function open(p: Project) {
    if (!orden.dragging) onOpen(p);
  }
```

(Ajustar el único sitio que la llama, línea 189, a `onClick={() => open(p)}`, y quitar el `!busy` de esa condición si ya no hay ninguna llamada de red que lo justifique junto a la creación/renombrado — `busy` se sigue usando en `create`/`rename`, así que se queda como estado, solo deja de gatear `open`.)

Borrar por completo la función `kick` (líneas 132-144) y su entrada en el menú contextual (líneas 198-202, `label: p.locked_by ? ...`).

En `Card` (líneas 282-300), sustituir el badge de `locked_by`/`UserTile` por un contador:

```tsx
      <span className="ml-auto flex items-center gap-1.5">
        {project.casos_ocupados > 0 && (
          <span title={`${project.casos_ocupados} caso${project.casos_ocupados === 1 ? "" : "s"} ocupado${project.casos_ocupados === 1 ? "" : "s"} ahora mismo`}
            className="flex items-center gap-1 rounded-full border border-border bg-elevated px-1.5 py-0.5
              font-mono text-[9.5px] text-subtle">
            <Icon name="lock" size={10} />
            {project.casos_ocupados}
          </span>
        )}
        {project.role !== "owner" && (
          <span className="text-warning-fg" title="te invitaron a este proyecto">
            <Icon name="users" size={12} />
          </span>
        )}
      </span>
```

- [ ] **Step 13: Comprobar todo**

```bash
cargo build -p lumid -p lumi-proto
cd client && npx tsc -b --noEmit && npm run lint
```

Esperado: ambos limpios.

- [ ] **Step 14: Commit**

```bash
git add crates/lumid/src/store.rs crates/lumi-proto/src/api.rs crates/lumid/src/routes/cases.rs \
  crates/lumid/src/routes/projects.rs crates/lumid/src/main.rs client/src/lib/api.ts client/src/App.tsx \
  client/src/work/ProjectPicker.tsx client/src/work/ProjectView.tsx client/src/work/CaseRow.tsx
git commit -m "feat(darkroom): el candado baja de proyecto a caso -- case_locks, enter/leave/kick movidos (fase 1, paso 2/7)"
```

---

### Task 4: La exclusión real en `guard_case`

**Files:**
- Modify: `crates/lumid/src/routes/cases.rs` (`guard_case`, y sus propios llamantes `rename`, `remove`, `enter`, `leave`, `kick`)
- Modify: todo fichero que llame a `guard_case` fuera de `cases.rs` (localizados por grep en el Step 1)

**Interfaces:**
- Consumes: `case_locks` (Tarea 3), `colaboracion::caso_exclusivo`/`caso_liberar_s` (Tarea 2).
- Produces: `guard_case` gana un parámetro `method: &axum::http::Method` — cualquier tarea futura que añada una ruta de caso/imagen/análisis debe pasarlo.

Este es el paso más delicado del spec: `guard_case` está en el camino de todas las rutas de casos, imágenes y análisis, así que una comprobación de más deja a alguien fuera de su propio trabajo. Probar con dos sesiones reales antes de dar la tarea por cerrada (Step 6).

- [ ] **Step 1: Localizar todos los llamantes**

```bash
grep -rn "guard_case(" crates/lumid/src
```

Apuntar cada fichero:línea que imprima — son los sitios a tocar en el Step 3, además de los cuatro dentro de `cases.rs` mismo (`rename`, `remove`, `enter`, `kick`).

- [ ] **Step 2: Nueva firma de `guard_case`**

Reemplazar `guard_case` completo en `crates/lumid/src/routes/cases.rs` (líneas 27-54):

```rust
pub async fn guard_case(
    app: &App,
    headers: &HeaderMap,
    method: &axum::http::Method,
    case_id: i64,
) -> Result<(i64, i64, Role), Fail> {
    let (uid, is_admin) = require_session(app, &bearer(headers))
        .map_err(|c| (c, "sesión inválida".to_string()))?;
    let missing = || err(StatusCode::NOT_FOUND, "no existe ese caso");
    let (pid, role): (Option<i64>, Option<String>) = crate::store::Store::leer(app.store.clone(), move |c| {
        let pid: Option<i64> = c
            .query_row("SELECT project_id FROM cases WHERE id = ?1", [case_id], |r| r.get(0))
            .ok();
        let Some(pid) = pid else { return (None, None) };
        let role: Option<String> = c
            .query_row(
                "SELECT role FROM project_members
                 WHERE project_id = ?1 AND user_id = ?2 AND status = 'accepted'",
                rusqlite::params![pid, uid],
                |r| r.get(0),
            )
            .ok();
        (Some(pid), role)
    })
    .await;
    let pid = pid.ok_or_else(missing)?;
    let role = match role.as_deref() {
        Some("owner") => Role::Owner,
        Some("member") => Role::Member,
        _ => return Err(missing()),
    };
    // Darkroom Fase 1 §3, punto 1: hasta ahora el candado solo lo comprobaba
    // `enter` -- cualquier otra ruta (o una API key) podía escribir en un
    // caso tomado por otra persona. Solo lo que escribe (POST/PATCH/PUT/
    // DELETE) exige tener el caso; las lecturas pasan siempre, y un
    // administrador nunca se queda fuera de algo que administra (mismo
    // criterio que `routes::mantenimiento`).
    if !is_admin
        && method != axum::http::Method::GET
        && method != axum::http::Method::HEAD
        && crate::routes::colaboracion::caso_exclusivo(app)
    {
        let held: Option<(i64, i64)> = app
            .store
            .conn()
            .query_row("SELECT user_id, since FROM case_locks WHERE case_id = ?1", [case_id], |r| {
                Ok((r.get(0)?, r.get(1)?))
            })
            .ok();
        if let Some((holder, since)) = held {
            if holder != uid && now() - since < crate::routes::colaboracion::caso_liberar_s(app) {
                let username: String = app
                    .store
                    .conn()
                    .query_row("SELECT username FROM users WHERE id = ?1", [holder], |r| r.get(0))
                    .unwrap_or_else(|_| "otra persona".into());
                return Err(err(
                    StatusCode::CONFLICT,
                    &format!(
                        "{username} tiene este caso ahora mismo; solo puede haber una persona trabajando en él a la vez"
                    ),
                ));
            }
        }
    }
    Ok((uid, pid, role))
}
```

- [ ] **Step 3: Actualizar cada llamante**

Patrón mecánico para cada handler que el Step 1 señaló: añadir `method: axum::http::Method` como parámetro del handler (axum lo extrae de la request; colocarlo junto a `headers: HeaderMap`, antes de cualquier extractor que consuma el body como `Json<...>`), y pasar `&method` a `guard_case`.

Dentro de `cases.rs`, los cuatro casos concretos:

```rust
pub async fn rename(
    State(app): State<App>,
    Path(id): Path<i64>,
    method: axum::http::Method,
    headers: HeaderMap,
    Json(req): Json<NameReq>,
) -> Result<StatusCode, Fail> {
    guard_case(&app, &headers, &method, id).await?;
```

```rust
pub async fn enter(
    State(app): State<App>,
    Path(id): Path<i64>,
    method: axum::http::Method,
    headers: HeaderMap,
) -> Result<StatusCode, Fail> {
    let (uid, pid, _role) = guard_case(&app, &headers, &method, id).await?;
```

```rust
pub async fn kick(
    State(app): State<App>,
    Path(id): Path<i64>,
    method: axum::http::Method,
    headers: HeaderMap,
) -> Result<StatusCode, Fail> {
    let (uid, _pid, role) = guard_case(&app, &headers, &method, id).await?;
```

Para `remove` (no listado arriba en el texto del plan pero presente en `cases.rs`, localizado por el grep del Step 1): mismo patrón, añadir `method: axum::http::Method` al handler y `&method` a su llamada a `guard_case`.

Para cada llamante fuera de `cases.rs` que el grep del Step 1 imprimió (imágenes, análisis, export, media...): mismo patrón exacto — añadir `method: axum::http::Method` al handler, pasar `&method`. `leave` no cambia: usa `require_session`, no `guard_case` — soltar el propio candado siempre está permitido, con o sin exclusividad activa.

- [ ] **Step 4: Compilar**

```bash
cargo build -p lumid -p lumi-proto
```

Esperado: limpio. Si algún handler ya tenía un extractor que consume el body (`Json<T>`) antes de donde se añadió `method`, moverlo: los extractores de body deben ir últimos en la lista de parámetros de axum.

- [ ] **Step 5: Cliente sin cambios de tipo, comprobar que sigue compilando**

```bash
cd client && npx tsc -b --noEmit
```

Esperado: limpio (esta tarea no toca ningún tipo de API pública, solo añade una comprobación interna).

- [ ] **Step 6: Probar con dos sesiones reales**

Con el daemon corriendo, desde dos pestañas/perfiles de navegador (o `curl` con dos tokens de sesión distintos, ver `scratchpad/mktoken.sh` de la sesión anterior como referencia de cómo insertar una sesión de depuración):

1. Sesión A entra en un caso (`POST /v1/cases/:id/enter` → 204).
2. Sesión B intenta subir una imagen a ese mismo caso (`POST /v1/images` o el endpoint que corresponda) → debe dar 409, no colarse.
3. Sesión B hace un `GET` sobre el mismo caso (listar imágenes, por ejemplo) → debe dar 200: las lecturas nunca chocan.
4. Con `caso_exclusivo` desactivado desde el panel de administración (`ColaboracionView`, Tarea 2), repetir el paso 2 → ahora debe dejar escribir.

Si algún paso falla, no marcar la tarea como cerrada — es el punto que el spec señala como el más delicado.

- [ ] **Step 7: Commit**

```bash
git add crates/lumid/src/routes/cases.rs $(grep -rl "guard_case(" crates/lumid/src | grep -v cases.rs)
git commit -m "feat(darkroom): exclusión real del candado de caso en guard_case (fase 1, paso 3/7)"
```

---

### Task 5: Barrido de expiración en el daemon + latido del cliente

**Files:**
- Modify: `crates/lumid/src/routes/cases.rs` (nueva función `barrer_candados_caducados`)
- Modify: `crates/lumid/src/main.rs` (`tokio::spawn` del barrido)
- Modify: `client/src/App.tsx` (nuevo efecto de latido)

**Interfaces:**
- Consumes: `case_locks` (Tarea 3), `colaboracion::caso_liberar_s` (Tarea 2).
- Produces: `barrer_candados_caducados(app: App)` — la Tarea 6 le añade la difusión de `Cambio::CasoLibre` dentro de su bucle, sin cambiar su firma.

- [ ] **Step 1: El barrido**

En `crates/lumid/src/routes/cases.rs`, añadir al final del fichero, siguiendo el mismo patrón que `telemetry::muestrear_historial` (`crates/lumid/src/telemetry.rs:181-189`, un `loop` con su propio `sleep`):

```rust
/// Nadie libera un candado de caso si cierra el portátil de golpe o pierde
/// la red -- sin este barrido, `caso_liberar_s` sería un número que nadie
/// aplica (spec Darkroom Parte 3, punto 2). Mismo patrón que
/// `telemetry::muestrear_historial`: un bucle con su propio `sleep`, sin
/// plazo fijo en el código -- lo decide el administrador
/// (`routes::colaboracion::caso_liberar_s`) y puede cambiar en caliente.
pub async fn barrer_candados_caducados(app: App) {
    loop {
        let limite = crate::routes::colaboracion::caso_liberar_s(&app);
        let ahora = now();
        let caducados: Vec<(i64, i64)> = {
            let c = app.store.conn();
            let filas: Vec<(i64, i64)> = c
                .prepare("SELECT cl.case_id, k.project_id FROM case_locks cl JOIN cases k ON k.id = cl.case_id WHERE ?1 - cl.since >= ?2")
                .and_then(|mut q| {
                    q.query_map(rusqlite::params![ahora, limite], |r| Ok((r.get(0)?, r.get(1)?)))
                        .map(|rows| rows.flatten().collect())
                })
                .unwrap_or_default();
            if !filas.is_empty() {
                let _ = c.execute("DELETE FROM case_locks WHERE ?1 - since >= ?2", rusqlite::params![ahora, limite]);
            }
            filas
        };
        for (case_id, _project_id) in &caducados {
            tracing::info!("caso #{case_id}: candado liberado por inactividad ({limite}s)");
        }
        // La Tarea 6 añade aquí la difusión de `Cambio::CasoLibre` para cada
        // `(case_id, project_id)` de `caducados`.
        tokio::time::sleep(std::time::Duration::from_secs(60)).await;
    }
}
```

- [ ] **Step 2: Registrarlo en `main.rs`**

Junto a los demás `tokio::spawn` de arranque (línea 198-200):

```rust
    tokio::spawn(telemetry::muestrear_historial(app.clone()));
    tokio::spawn(telemetry::muestrear_en_vivo(app.clone()));
    tokio::spawn(actualizacion::tick(app.clone()));
    tokio::spawn(routes::cases::barrer_candados_caducados(app.clone()));
```

- [ ] **Step 3: Compilar**

```bash
cargo build -p lumid
```

Esperado: limpio.

- [ ] **Step 4: El latido del cliente**

En `client/src/App.tsx`, añadir un nuevo efecto junto al de expulsión por inactividad ya existente (el que usa `ultimaActividad`/`inactivity_timeout_s`, líneas 352-370 antes de esta tarea) — **no se toca ese efecto**, es una funcionalidad distinta (expulsar a quien lleva rato sin tocar nada, por seguridad) de esta nueva (mantener vivo el candado de un caso mientras hay actividad real, para que el barrido del daemon no lo dé por abandonado a media tarea):

```tsx
  // Darkroom Fase 1 §3: sin este latido, el candado de un caso caduca solo
  // por el reloj del barrido del daemon (`caso_liberar_s`, 30 min por
  // defecto) aunque la persona siga trabajando de verdad -- perdería el
  // caso a media tarea. Se reengancha reenviando el mismo `enter` que lo
  // tomó (el INSERT es un upsert que refresca `since`), y solo si hubo
  // actividad real desde el último latido: uno que se manda solo porque el
  // temporizador tocó, sin nadie delante, sería el propio agujero que este
  // candado existe para tapar.
  const ultimoLatido = useRef(0);
  useEffect(() => {
    const t = setInterval(() => {
      const { case_ } = useWorkspace.getState();
      const token = useServer.getState().token;
      if (modeRef.current !== "case" || !case_ || !token) return;
      if (ultimaActividad.current <= ultimoLatido.current) return;
      ultimoLatido.current = Date.now();
      void api.post(`/v1/cases/${case_.id}/enter`, {}, token).catch(() => {});
    }, 60_000);
    return () => clearInterval(t);
  }, []);
```

(Usa el mismo `ultimaActividad` ref que ya existe para la expulsión por inactividad — no crear uno nuevo. `modeRef` también ya existe, es el ref que ese mismo bloque usa para leer `mode` sin volver a suscribirse.)

- [ ] **Step 5: Comprobar**

```bash
cd client && npx tsc -b --noEmit && npm run lint
```

Esperado: limpio.

- [ ] **Step 6: Commit**

```bash
git add crates/lumid/src/routes/cases.rs crates/lumid/src/main.rs client/src/App.tsx
git commit -m "feat(darkroom): barrido de candados caducados en el daemon + latido del cliente (fase 1, paso 4/7)"
```

---

### Task 6: `Cambio::CasoLibre` y el filtro de difusión

**Files:**
- Modify: `crates/lumi-proto/src/api.rs` (`enum Cambio`, filtro de destinatario)
- Modify: `crates/lumid/src/routes/queue.rs` (usar el nuevo filtro)
- Modify: `crates/lumid/src/routes/cases.rs` (`leave`, `kick`, `barrer_candados_caducados` difunden)
- Modify: `client/src/lib/api.ts` (`Cambio` gana la variante)
- Modify: `client/src/work/ProjectView.tsx` (recargar la lista al recibir el aviso)

**Interfaces:**
- Consumes: `barrer_candados_caducados` (Tarea 5), `leave`/`kick` (Tarea 3).
- Produces: `Cambio::CasoLibre { case_id }`, recibido por cualquier miembro del proyecto conectado.

- [ ] **Step 1: La variante y el filtro de destinatario**

En `crates/lumi-proto/src/api.rs`, añadir la variante dentro de `enum Cambio` (junto a `Red`):

```rust
    CasoLibre {
        /// A diferencia de las demás variantes (un único destinatario en
        /// `user_id`), esta se difunde a varios: los miembros del proyecto
        /// del caso que quedó libre. Ver `Cambio::para`.
        #[serde(skip)]
        miembros: Vec<i64>,
        case_id: i64,
    },
```

Sustituir `impl Cambio::user_id` (que hoy es el único filtro de destinatario) por `Cambio::para`, la única llamante externa (`routes::queue::events`) se actualiza en el Step 2:

```rust
impl Cambio {
    /// A quién le llega este cambio por SSE (`routes::queue::events`). La
    /// mayoría son de un solo destinatario; `CasoLibre` es la primera
    /// excepción -- se difunde a los miembros del proyecto del caso que
    /// quedó libre, no a una sola sesión. El filtro sigue viviendo aquí
    /// para que nadie tenga que tocar `routes::queue` cada vez que nace una
    /// variante nueva.
    pub fn para(&self, uid: i64) -> bool {
        match self {
            Cambio::Estado { user_id, .. }
            | Cambio::Progreso { user_id, .. }
            | Cambio::Expulsion { user_id, .. }
            | Cambio::Cola { user_id, .. }
            | Cambio::Invitacion { user_id, .. }
            | Cambio::Red { user_id, .. } => *user_id == uid,
            Cambio::CasoLibre { miembros, .. } => miembros.contains(&uid),
        }
    }
}
```

- [ ] **Step 2: `routes::queue::events` usa el nuevo filtro**

En `crates/lumid/src/routes/queue.rs`, línea 31, cambiar:

```rust
                Ok(c) if c.user_id() == uid => {
```

por:

```rust
                Ok(c) if c.para(uid) => {
```

- [ ] **Step 3: Difundir desde `leave`, `kick` y el barrido**

En `crates/lumid/src/routes/cases.rs`, añadir el helper (cerca de `barrer_candados_caducados`):

```rust
/// Los miembros del proyecto de un caso, para avisarles por SSE que quedó
/// libre. `app.queue.difundir` reparte un único `Cambio` a todos los
/// suscriptores conectados; `Cambio::para` decide a quién le llega.
fn difundir_caso_libre(app: &App, project_id: i64, case_id: i64) {
    let miembros: Vec<i64> = {
        let c = app.store.conn();
        c.prepare("SELECT user_id FROM project_members WHERE project_id = ?1 AND status = 'accepted'")
            .and_then(|mut q| q.query_map([project_id], |r| r.get::<_, i64>(0)).map(|rows| rows.flatten().collect()))
            .unwrap_or_default()
    };
    if miembros.is_empty() {
        return;
    }
    app.queue.difundir(lumi_proto::api::Cambio::CasoLibre { miembros, case_id });
}
```

Modificar `leave` para buscar el `project_id` y difundir:

```rust
pub async fn leave(State(app): State<App>, Path(id): Path<i64>, headers: HeaderMap) -> Result<StatusCode, Fail> {
    let (uid, _) = require_session(&app, &bearer(&headers)).map_err(|c| (c, "sesión inválida".to_string()))?;
    let pid: Option<i64> = app.store.conn().query_row("SELECT project_id FROM cases WHERE id = ?1", [id], |r| r.get(0)).ok();
    app.store
        .conn()
        .execute("DELETE FROM case_locks WHERE case_id = ?1 AND user_id = ?2", rusqlite::params![id, uid])
        .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;
    if let Some(pid) = pid {
        difundir_caso_libre(&app, pid, id);
    }
    Ok(StatusCode::NO_CONTENT)
}
```

Añadir una línea en `kick` (tras el `app.queue.difundir(lumi_proto::api::Cambio::Expulsion { ... })` ya existente, usando el `pid` que `guard_case` ya devuelve y que `kick` hoy descarta como `_pid` — cambiarlo a `pid`):

```rust
pub async fn kick(State(app): State<App>, Path(id): Path<i64>, method: axum::http::Method, headers: HeaderMap) -> Result<StatusCode, Fail> {
    let (uid, pid, role) = guard_case(&app, &headers, &method, id).await?;
    // ... (sin cambios hasta el difundir de Expulsion)
    app.queue.difundir(lumi_proto::api::Cambio::Expulsion { user_id: holder, case_id: id, case_name });
    difundir_caso_libre(&app, pid, id);
    Ok(StatusCode::NO_CONTENT)
}
```

Y en `barrer_candados_caducados` (Tarea 5, Step 1), sustituir el comentario "La Tarea 6 añade aquí..." por la llamada real:

```rust
        for (case_id, project_id) in &caducados {
            tracing::info!("caso #{case_id}: candado liberado por inactividad ({limite}s)");
            difundir_caso_libre(&app, *project_id, *case_id);
        }
```

- [ ] **Step 4: Compilar**

```bash
cargo build -p lumid -p lumi-proto
```

Esperado: limpio.

- [ ] **Step 5: Cliente recibe el aviso**

En `client/src/lib/api.ts`, añadir la variante a la unión de `Cambio` (junto a `expulsion`):

```ts
  | { tipo: "casolibre"; case_id: number }
```

En `client/src/work/ProjectView.tsx`, escuchar el evento y recargar la lista cuando el caso libre es de este proyecto. Añadir el import y el efecto:

```tsx
import { listen } from "@tauri-apps/api/event";
import type { Cambio } from "../lib/api";
```

```tsx
  useEffect(() => {
    const un = listen<Cambio>("queue-change", (e) => {
      const c = e.payload;
      if (c.tipo !== "casolibre") return;
      if (!list.some((k) => k.id === c.case_id)) return;
      void load();
    });
    return () => { void un.then((f) => f()); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list]);
```

(`serde(tag = "tipo", rename_all = "lowercase")` en `Cambio` hace que `CasoLibre` serialice como `"casolibre"`, todo en minúsculas sin guion — igual que `Estado`/`Progreso`/etc. ya serializan.)

- [ ] **Step 6: Comprobar**

```bash
cd client && npx tsc -b --noEmit && npm run lint
```

Esperado: limpio.

- [ ] **Step 7: Commit**

```bash
git add crates/lumi-proto/src/api.rs crates/lumid/src/routes/queue.rs crates/lumid/src/routes/cases.rs \
  crates/lumid/src/main.rs client/src/lib/api.ts client/src/work/ProjectView.tsx
git commit -m "feat(darkroom): Cambio::CasoLibre avisa a los miembros del proyecto (fase 1, paso 5/7)"
```

---

### Task 7: `DarkroomView.tsx` y la bifurcación por backend

**Files:**
- Create: `client/src/work/DarkroomView.tsx`
- Modify: `client/src/App.tsx` (bifurcación por `case_.backend`)

**Interfaces:**
- Consumes: `Case.backend` (Tarea 1), `rail`/`drawer`/`drawerId`/`setDrawer` (las mismas props que ya recibe `CaseView`).
- Produces: nada que otra tarea consuma — es la última.

- [ ] **Step 1: `DarkroomView.tsx`**

Crear `client/src/work/DarkroomView.tsx`, hermano de `CaseView.tsx` (mismas props de armazón — `rail`, `drawer` — para que el candado, la expulsión por inactividad y la barra de título sigan funcionando igual, ya que viven en `App.tsx`, no en la vista):

```tsx
import type { Case, Project } from "../lib/api";

/** La pantalla de un caso Darkroom. Hoy solo demuestra que el backend
 *  elegido al crear el caso enruta de extremo a extremo hasta una interfaz
 *  distinta -- el spec 2 trae los archivos, las clases y sus propiedades; el
 *  sitio donde ponerlos ya existe y está probado (spec Darkroom Parte 5). */
export function DarkroomView({
  project, case_, rail, drawer,
}: {
  project: Project;
  case_: Case;
  rail: React.ReactNode;
  drawer: React.ReactNode;
}) {
  return (
    <div className="absolute inset-0 overflow-hidden"
      style={{ animation: "jg-page-fade-in 260ms cubic-bezier(.16,1,.3,1) both" }}>
      <div className="pointer-events-none absolute inset-0"
        style={{ background: "radial-gradient(120% 90% at 50% 35%, #16191d 0%, #0e0f11 70%)" }} />
      {rail}
      <div className="absolute inset-0 grid place-items-center">
        <p className="text-[15px] font-medium tracking-[-.01em] text-fg">ola</p>
      </div>
      {drawer}
    </div>
  );
}
```

(`project`/`case_` quedan sin usar en el JSX por ahora — el spec 2 los necesitará para el título y el candado del panel de propiedades. TypeScript no se queja de props sin usar dentro del cuerpo si están en la desestructuración de la firma, así que no hace falta un `_project`/`_case_` ni un `eslint-disable`.)

- [ ] **Step 2: Bifurcar por backend en `App.tsx`**

Importar el componente junto a `CaseView` (o como `lazy`, igual que `MapCanvas`, si el bundle de `CaseView` es pesado y Darkroom no debería cargarlo — de momento, import directo, es un componente de una línea):

```tsx
import { DarkroomView } from "./work/DarkroomView";
```

Reemplazar el `return mode === "case" && case_ ? (...)` (visto en la exploración previa, dentro del bloque `(() => { ... })()` que monta `CaseView`/`ProjectView`) para bifurcar también por `case_.backend`:

```tsx
          return mode === "case" && case_ ? (
            case_.backend === "darkroom" ? (
              <DarkroomView project={project} case_={case_} rail={rail} drawer={cajon} />
            ) : (
              <CaseView project={project} case_={case_} rail={rail} drawer={cajon}
                drawerId={drawer} setDrawer={setDrawer}
                exportOpen={exportOpen} onCloseExport={() => setExportOpen(false)} />
            )
          ) : (
            <ProjectView project={project} rail={rail} drawer={cajon}
              onOpenCase={openCase} />
          );
```

- [ ] **Step 3: Comprobar**

```bash
cd client && npx tsc -b --noEmit && npm run lint
```

Esperado: limpio.

- [ ] **Step 4: Probar a mano**

```bash
python tools/build.py
```

Crear un caso eligiendo «Darkroom» en el diálogo (Tarea 1) y abrirlo: debe mostrar la palabra «ola» centrada, con el carril (`rail`) de navegación funcionando (volver a la lista de casos, abrir el cajón de miembros) igual que en un caso normal. Crear un segundo caso «Normal» y confirmar que sigue abriendo `CaseView` sin cambios.

- [ ] **Step 5: Commit**

```bash
git add client/src/work/DarkroomView.tsx client/src/App.tsx
git commit -m "feat(darkroom): DarkroomView y bifurcación por backend -- caso Darkroom real de extremo a extremo (fase 1, paso 7/7)"
```

---

## Cierre de la Fase 1

Con las siete tareas cerradas: `cargo build`, `npx tsc -b --noEmit` y `npm run lint` limpios en todo el repo; `cargo test -p lumi-proto` en verde; un caso Darkroom creado desde cero abre «ola»; el candado de un caso normal rechaza a un segundo usuario con 409 mientras `caso_exclusivo` está activo y dos sesiones simultáneas conviven en el mismo proyecto sin candado de proyecto. El spec 2 (el grafo de archivos, clases y propiedades) es la siguiente pieza, y esta Fase 1 es exactamente lo que necesita para apoyarse sin rehacer nada.
