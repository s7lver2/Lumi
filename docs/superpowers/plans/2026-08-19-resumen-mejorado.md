# Resumen mejorado — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** convertir `ResumenView.tsx` en la pantalla de aterrizaje real del
panel: primeros pasos (checklist dismissible), cabecera con identidad del
servidor + tarjeta copiable, cola/hardware condensados, y actividad
reciente — sin romper nada de lo que ya funciona ahí (las 4 fichas de
stats y los 2 placeholders de modelos se quedan igual).

**Architecture:** un endpoint nuevo (`/v1/admin/actividad`, fusiona cuatro
fuentes ya existentes por fecha) y un campo nuevo en el endpoint de
Resumen (`modelos_instalados`); todo lo demás reutiliza endpoints y
componentes que ya existen (`server-profile`, `network`, `hardware`,
`QueueRow`). El lado cliente se reparte en componentes pequeños nuevos
(`PrimerosPasos`, `ResumenHeader`, `HardwareGlance`, `ActividadFeed`) que
`ResumenView.tsx` ensambla.

**Tech Stack:** Rust (axum, rusqlite), React/TypeScript, mismo vocabulario
de animación ya usado en el panel (`jg-fade-rise`, `ease-expo`,
`grid-template-rows` para colapsar).

## Global Constraints

- **Spec de referencia:** `docs/superpowers/specs/2026-08-19-resumen-mejorado-design.md`.
- **No tests salvo en `lumi-proto`** (convención del proyecto).
- **Un commit por tarea terminada.**
- Nada de esto toca el schema de SQLite — todas las fuentes de datos ya
  existen.
- Las 4 `Ficha` de estadísticas y los 2 placeholders de modelos en
  `ResumenView.tsx` no cambian de contenido ni de lógica, solo de posición
  en el archivo tras la reestructuración.

---

### Task 1: Tipos en `lumi-proto`

**Files:**
- Modify: `crates/lumi-proto/src/api.rs:541-558` (`Resumen`)
- Modify: `crates/lumi-proto/src/api.rs` (nuevo `ActividadItem`, junto a `Cambio`)

**Interfaces:**
- Produce: `Resumen.modelos_instalados: bool`, enum `ActividadItem` con
  método `at(&self) -> i64`.

- [ ] **Step 1: `Resumen` gana `modelos_instalados`**

Sustituir (línea 541-558):

```rust
pub struct Resumen {
    pub solicitudes_pendientes: i64,
    /// Epoch de la más antigua sin resolver. `None` si no hay ninguna.
    pub solicitud_mas_antigua: Option<i64>,
    pub usuarios: i64,
    /// Con el mismo criterio que ya usa la cola: estar suscrito a
    /// `/v1/queue/events` cuenta como estar conectado. Una segunda definición
    /// de «conectado» sería una segunda verdad sobre el mismo hecho.
    pub usuarios_conectados: i64,
    pub analisis_hoy: i64,
    pub analisis_en_cola: i64,
    /// Siete días, el más reciente al final. Alimenta la chispa de la ficha.
    pub analisis_serie: Vec<i64>,
    pub indices: i64,
    pub indices_bytes: i64,
    pub teselas: i64,
    pub arrancado_en: i64,
}
```

por:

```rust
pub struct Resumen {
    pub solicitudes_pendientes: i64,
    /// Epoch de la más antigua sin resolver. `None` si no hay ninguna.
    pub solicitud_mas_antigua: Option<i64>,
    pub usuarios: i64,
    /// Con el mismo criterio que ya usa la cola: estar suscrito a
    /// `/v1/queue/events` cuenta como estar conectado. Una segunda definición
    /// de «conectado» sería una segunda verdad sobre el mismo hecho.
    pub usuarios_conectados: i64,
    pub analisis_hoy: i64,
    pub analisis_en_cola: i64,
    /// Siete días, el más reciente al final. Alimenta la chispa de la ficha.
    pub analisis_serie: Vec<i64>,
    pub indices: i64,
    pub indices_bytes: i64,
    pub teselas: i64,
    pub arrancado_en: i64,
    /// Para el chequeo de "primeros pasos" del Resumen: mismo criterio que
    /// `routes::models::estado` (licencia junto al peso), factorizado en
    /// `routes::models::hay_alguno_instalado`.
    pub modelos_instalados: bool,
}
```

- [ ] **Step 2: `ActividadItem`**

Junto a `Cambio` (tras su `impl Cambio { ... }`), añadir:

```rust
/// Un evento del feed de "actividad reciente" del Resumen. Fusiona cuatro
/// fuentes que ya existen (cuentas, análisis, avisos, solicitudes) — no hay
/// tabla ni escritura nueva, solo lectura y orden por fecha.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "tipo", rename_all = "snake_case")]
pub enum ActividadItem {
    CuentaCreada { username: String, at: i64 },
    AnalisisResuelto { id: i64, estado: String, at: i64 },
    AvisoPublicado { extracto: String, at: i64 },
    SolicitudResuelta { display_name: String, aprobada: bool, at: i64 },
}

impl ActividadItem {
    pub fn at(&self) -> i64 {
        match self {
            ActividadItem::CuentaCreada { at, .. }
            | ActividadItem::AnalisisResuelto { at, .. }
            | ActividadItem::AvisoPublicado { at, .. }
            | ActividadItem::SolicitudResuelta { at, .. } => *at,
        }
    }
}
```

- [ ] **Step 3: Compilar**

Run: `cargo build -p lumi-proto`
Expected: falla — `admin::resumen()` construye `Resumen { ... }` sin el
campo nuevo. Confirma que el único error es "missing field
`modelos_instalados`"; se arregla en la Task 2.

- [ ] **Step 4: Commit**

```bash
git add crates/lumi-proto/src/api.rs
git commit -m "feat: tipos de Resumen mejorado en lumi-proto (modelos_instalados, ActividadItem)"
```

---

### Task 2: `hay_alguno_instalado` factorizado + campo nuevo en `resumen()`

**Files:**
- Modify: `crates/lumid/src/routes/models.rs:171-199`
- Modify: `crates/lumid/src/routes/admin.rs:366-378`

**Interfaces:**
- Produce: `models::hay_alguno_instalado(app: &App) -> bool`.
- Consume: en `admin::resumen()`.

- [ ] **Step 1: Factorizar el escaneo del directorio de pesos**

En `crates/lumid/src/routes/models.rs`, sustituir `estado()` (línea 171-199):

```rust
pub async fn estado(
    State(app): State<App>,
    headers: HeaderMap,
) -> Result<Json<Vec<NivelEstado>>, StatusCode> {
    require_admin(&app, &bearer(&headers))?;
    let niveles = app.queue.niveles.lock().unwrap().clone();
    let modelos_dir = app.store.get_meta("models_dir").unwrap_or_else(|| "runtime/pesos".to_string());

    // Instalado = LICENCIA.txt presente junto al peso — el mismo criterio
    // que lumi_pesos._licencia exige para cargar, así que "instalado" aquí
    // nunca puede decir sí cuando Python diría que no.
    let instalados: std::collections::HashSet<String> = std::fs::read_dir(&modelos_dir)
        .map(|rd| {
            rd.flatten()
                .filter(|e| e.path().join("LICENCIA.txt").exists())
                .filter_map(|e| e.file_name().into_string().ok())
                .collect()
        })
        .unwrap_or_default();

    let fuera = niveles
        .iter()
        .map(|n| NivelEstado {
            id: n.id.clone(), nombre: n.nombre.clone(),
            resolucion: lumi_index::niveles::resolver_composicion(n, &instalados),
        })
        .collect();
    Ok(Json(fuera))
}
```

por:

```rust
// Instalado = LICENCIA.txt presente junto al peso — el mismo criterio que
// lumi_pesos._licencia exige para cargar, así que "instalado" aquí nunca
// puede decir sí cuando Python diría que no. Compartido entre `estado`
// (necesita el conjunto entero, por nivel) y `hay_alguno_instalado` (solo
// necesita saber si hay algo, para el Resumen).
fn instalados_dir(app: &App) -> std::collections::HashSet<String> {
    let modelos_dir = app.store.get_meta("models_dir").unwrap_or_else(|| "runtime/pesos".to_string());
    std::fs::read_dir(&modelos_dir)
        .map(|rd| {
            rd.flatten()
                .filter(|e| e.path().join("LICENCIA.txt").exists())
                .filter_map(|e| e.file_name().into_string().ok())
                .collect()
        })
        .unwrap_or_default()
}

/// Para el chequeo de "primeros pasos" del Resumen.
pub fn hay_alguno_instalado(app: &App) -> bool {
    !instalados_dir(app).is_empty()
}

pub async fn estado(
    State(app): State<App>,
    headers: HeaderMap,
) -> Result<Json<Vec<NivelEstado>>, StatusCode> {
    require_admin(&app, &bearer(&headers))?;
    let niveles = app.queue.niveles.lock().unwrap().clone();
    let instalados = instalados_dir(&app);

    let fuera = niveles
        .iter()
        .map(|n| NivelEstado {
            id: n.id.clone(), nombre: n.nombre.clone(),
            resolucion: lumi_index::niveles::resolver_composicion(n, &instalados),
        })
        .collect();
    Ok(Json(fuera))
}
```

- [ ] **Step 2: `admin::resumen()` rellena el campo nuevo**

En `crates/lumid/src/routes/admin.rs`, sustituir (línea 366-378):

```rust
    Ok(Json(lumi_proto::api::Resumen {
        solicitudes_pendientes: pendientes,
        solicitud_mas_antigua: mas_antigua,
        usuarios,
        usuarios_conectados: app.queue.conectados(),
        analisis_hoy,
        analisis_en_cola,
        analisis_serie,
        indices,
        indices_bytes,
        teselas,
        arrancado_en: app.arrancado_en,
    }))
```

por:

```rust
    Ok(Json(lumi_proto::api::Resumen {
        solicitudes_pendientes: pendientes,
        solicitud_mas_antigua: mas_antigua,
        usuarios,
        usuarios_conectados: app.queue.conectados(),
        analisis_hoy,
        analisis_en_cola,
        analisis_serie,
        indices,
        indices_bytes,
        teselas,
        arrancado_en: app.arrancado_en,
        modelos_instalados: crate::routes::models::hay_alguno_instalado(&app),
    }))
```

- [ ] **Step 3: Compilar**

Run: `cargo build -p lumid -p lumi-proto`
Expected: compila limpio (resuelve el error dejado a propósito en la Task 1).

- [ ] **Step 4: Commit**

```bash
git add crates/lumid/src/routes/models.rs crates/lumid/src/routes/admin.rs
git commit -m "fix: resumen() rellena modelos_instalados reutilizando el escaneo de models::estado"
```

---

### Task 3: Endpoint `/v1/admin/actividad`

**Files:**
- Create: `crates/lumid/src/routes/actividad.rs`
- Modify: `crates/lumid/src/routes/mod.rs`
- Modify: `crates/lumid/src/main.rs`

**Interfaces:**
- Consume: `require_admin`/`bearer` (`routes/auth.rs`), `lumi_proto::api::ActividadItem` (Task 1).
- Produce: `GET /v1/admin/actividad` → `Vec<ActividadItem>` (máx. 15, más reciente primero).

- [ ] **Step 1: Escribir `crates/lumid/src/routes/actividad.rs`**

```rust
//! Feed de "actividad reciente" del Resumen: fusiona cuatro fuentes que ya
//! existen (cuentas, análisis resueltos, avisos, solicitudes resueltas) por
//! fecha — sin tabla ni escritura nueva, solo lectura.

use crate::routes::auth::{bearer, require_admin};
use crate::App;
use axum::extract::State;
use axum::{http::HeaderMap, http::StatusCode, Json};
use lumi_proto::api::ActividadItem;

const LIMITE: i64 = 15;

/// Texto plano de un documento Tiptap JSON, truncado — solo para la vista
/// previa de un aviso en el feed, nunca se reconstruye el documento entero.
fn extracto(v: &serde_json::Value) -> String {
    fn recorrer(v: &serde_json::Value, out: &mut String) {
        if let Some(t) = v.get("text").and_then(|t| t.as_str()) {
            out.push_str(t);
        }
        if let Some(hijos) = v.get("content").and_then(|c| c.as_array()) {
            for h in hijos {
                out.push(' ');
                recorrer(h, out);
            }
        }
    }
    let mut s = String::new();
    recorrer(v, &mut s);
    let s = s.split_whitespace().collect::<Vec<_>>().join(" ");
    if s.chars().count() > 50 {
        format!("{}…", s.chars().take(50).collect::<String>())
    } else {
        s
    }
}

pub async fn get(State(app): State<App>, headers: HeaderMap) -> Result<Json<Vec<ActividadItem>>, StatusCode> {
    require_admin(&app, &bearer(&headers))?;
    let c = app.store.conn();
    let mut items: Vec<ActividadItem> = Vec::new();

    if let Ok(mut q) = c.prepare("SELECT username, created_at FROM users ORDER BY created_at DESC LIMIT ?1") {
        if let Ok(filas) = q.query_map([LIMITE], |r| {
            Ok(ActividadItem::CuentaCreada { username: r.get(0)?, at: r.get(1)? })
        }) {
            items.extend(filas.flatten());
        }
    }

    if let Ok(mut q) = c.prepare(
        "SELECT id, state, finished_at FROM analyses
         WHERE state IN ('hecho','error') AND finished_at IS NOT NULL
         ORDER BY finished_at DESC LIMIT ?1",
    ) {
        if let Ok(filas) = q.query_map([LIMITE], |r| {
            Ok(ActividadItem::AnalisisResuelto { id: r.get(0)?, estado: r.get(1)?, at: r.get(2)? })
        }) {
            items.extend(filas.flatten());
        }
    }

    if let Ok(mut q) = c.prepare("SELECT contenido, created_at FROM avisos ORDER BY created_at DESC LIMIT ?1") {
        if let Ok(filas) = q.query_map([LIMITE], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?))) {
            for (raw, at) in filas.flatten() {
                if let Ok(v) = serde_json::from_str::<serde_json::Value>(&raw) {
                    items.push(ActividadItem::AvisoPublicado { extracto: extracto(&v), at });
                }
            }
        }
    }

    if let Ok(mut q) = c.prepare(
        "SELECT display_name, status, resolved_at FROM access_requests
         WHERE status IN ('approved','rejected') AND resolved_at IS NOT NULL
         ORDER BY resolved_at DESC LIMIT ?1",
    ) {
        if let Ok(filas) = q.query_map([LIMITE], |r| {
            let status: String = r.get(1)?;
            Ok(ActividadItem::SolicitudResuelta {
                display_name: r.get(0)?,
                aprobada: status == "approved",
                at: r.get(2)?,
            })
        }) {
            items.extend(filas.flatten());
        }
    }

    items.sort_by(|a, b| b.at().cmp(&a.at()));
    items.truncate(LIMITE as usize);
    Ok(Json(items))
}
```

- [ ] **Step 2: Registrar el módulo**

En `crates/lumid/src/routes/mod.rs`, añadir `pub mod actividad;` como
primera línea (orden alfabético: antes de `pub mod admin;`).

- [ ] **Step 3: Registrar la ruta**

En `crates/lumid/src/main.rs`, junto a `/v1/admin/resumen`:

```rust
        .route("/v1/admin/actividad", get(routes::actividad::get))
```

- [ ] **Step 4: Compilar**

Run: `cargo build -p lumid -p lumi-proto`
Expected: compila.

- [ ] **Step 5: Probar a mano**

Con el daemon arrancado y una sesión de admin:
```bash
curl -sk https://127.0.0.1:7717/v1/admin/actividad -H "Authorization: Bearer $TOKEN"
```
Expected: JSON con array (vacío si el servidor es nuevo, o con eventos si
ya hay usuarios/análisis/avisos/solicitudes resueltas).

- [ ] **Step 6: Commit**

```bash
git add crates/lumid/src/routes/actividad.rs crates/lumid/src/routes/mod.rs crates/lumid/src/main.rs
git commit -m "feat: endpoint /v1/admin/actividad (feed de actividad reciente)"
```

---

### Task 4: Extraer `ago()` a un módulo compartido

**Files:**
- Create: `client/src/lib/time.ts`
- Modify: `client/src/ui/NotificationsPopover.tsx`

**Interfaces:**
- Produce: `ago(ts: number): string`.

- [ ] **Step 1: Escribir `client/src/lib/time.ts`**

```typescript
/** Formato compacto de "hace cuánto": "ahora", "12 min", "3 h", "2 d". Vive
 *  aquí porque ya lo necesitan dos sitios (la campana de notificaciones y
 *  el feed de actividad del Resumen) — una tercera copia habría sido la
 *  señal de que ya tocaba compartirlo. */
export function ago(ts: number): string {
  const s = Math.max(0, Math.floor(Date.now() / 1000) - ts);
  if (s < 60) return "ahora";
  if (s < 3600) return `${Math.floor(s / 60)} min`;
  if (s < 86400) return `${Math.floor(s / 3600)} h`;
  return `${Math.floor(s / 86400)} d`;
}
```

- [ ] **Step 2: `NotificationsPopover.tsx` importa en vez de definir**

Sustituir la función local (línea 32-38):

```typescript
function ago(ts: number): string {
  const s = Math.max(0, Math.floor(Date.now() / 1000) - ts);
  if (s < 60) return "ahora";
  if (s < 3600) return `${Math.floor(s / 60)} min`;
  if (s < 86400) return `${Math.floor(s / 3600)} h`;
  return `${Math.floor(s / 86400)} d`;
}
```

por nada (se borra por completo), y añadir el import junto a los demás
(línea 1-8):

```typescript
import { ago } from "../lib/time";
```

- [ ] **Step 3: Comprobar tipos**

Run: `cd client && npx tsc -b`
Expected: sin salida.

- [ ] **Step 4: Commit**

```bash
git add client/src/lib/time.ts client/src/ui/NotificationsPopover.tsx
git commit -m "refactor: extrae ago() a lib/time.ts, compartido entre la campana y el feed de actividad"
```

---

### Task 5: Tipos y funciones de API en el cliente

**Files:**
- Modify: `client/src/lib/api.ts`

**Interfaces:**
- Produce: `Resumen.modelos_instalados: boolean`, tipo `ActividadItem`,
  `api.actividadGet`.

- [ ] **Step 1: `Resumen` gana `modelos_instalados`**

Localizar `export interface Resumen { ... }` y añadir el campo al final:

```typescript
export interface Resumen {
  solicitudes_pendientes: number;
  /** Epoch de la más antigua sin resolver. `null` si no hay ninguna. */
  solicitud_mas_antigua: number | null;
  usuarios: number;
  usuarios_conectados: number;
  analisis_hoy: number;
  analisis_en_cola: number;
  /** Siete días, el más reciente al final. */
  analisis_serie: number[];
  indices: number;
  indices_bytes: number;
  teselas: number;
  arrancado_en: number;
  modelos_instalados: boolean;
}
```

- [ ] **Step 2: Tipo `ActividadItem`**

Junto al tipo `Cambio`, añadir:

```typescript
export type ActividadItem =
  | { tipo: "cuenta_creada"; username: string; at: number }
  | { tipo: "analisis_resuelto"; id: number; estado: string; at: number }
  | { tipo: "aviso_publicado"; extracto: string; at: number }
  | { tipo: "solicitud_resuelta"; display_name: string; aprobada: boolean; at: number };
```

- [ ] **Step 3: Función de `api`**

Dentro de `export const api = { ... }`, añadir:

```typescript
  actividadGet: (token: string) => api.get<ActividadItem[]>("/v1/admin/actividad", token),
```

- [ ] **Step 4: Comprobar tipos**

Run: `cd client && npx tsc -b`
Expected: sin salida.

- [ ] **Step 5: Commit**

```bash
git add client/src/lib/api.ts
git commit -m "feat: tipos y función de API para el Resumen mejorado"
```

---

### Task 6: `HardwareGlance.tsx`

**Files:**
- Create: `client/src/admin/HardwareGlance.tsx`

**Interfaces:**
- Consume: `api.hardwareListar`, `api.cpuLeer`, `HardwareDevice`, `CpuDevice` (`lib/api.ts`, ya existentes).

- [ ] **Step 1: Escribir `client/src/admin/HardwareGlance.tsx`**

```tsx
import { useEffect, useState } from "react";
import { api, type CpuDevice, type HardwareDevice } from "../lib/api";

/** Versión de solo lectura de Hardware, para el Resumen: mismos datos que
 *  `HardwareView`, sin sliders ni editores — un vistazo, no un control. */
export function HardwareGlance({ token }: { token: string }) {
  const [gpus, setGpus] = useState<HardwareDevice[] | null>(null);
  const [cpu, setCpu] = useState<CpuDevice | null>(null);

  useEffect(() => {
    api.hardwareListar(token).then(setGpus).catch(() => setGpus([]));
    api.cpuLeer(token).then(setCpu).catch(() => setCpu(null));
  }, [token]);

  const tempsCpu = cpu?.sample.nucleos.map((n) => n.temp_c).filter((t): t is number => t != null) ?? [];
  const tempCpuMedia = tempsCpu.length ? Math.round(tempsCpu.reduce((a, b) => a + b, 0) / tempsCpu.length) : null;

  return (
    <div className="rounded-card border border-border p-3.5">
      <p className="text-[12.5px] text-fg">Hardware</p>
      <p className="mb-3 text-[11px] text-muted">de un vistazo, sin entrar a Hardware</p>

      {gpus === null && <p className="text-[11px] text-subtle">cargando</p>}
      <div className="flex flex-col gap-1.5">
        {gpus?.map((d) => (
          <div key={d.index} className="flex items-center gap-2.5 rounded-lg border border-border px-2.5 py-1.5 text-[10.5px]">
            <span className="text-fg">GPU {d.index} · {d.name}</span>
            <span className="ml-auto font-mono text-subtle">
              {d.sample.temp_c ?? "—"}° · {(d.sample.vram_used_mb / 1024).toFixed(1)}/{(d.sample.vram_total_mb / 1024).toFixed(0)}GB
              {d.sample.power_draw_mw != null ? ` · ${(d.sample.power_draw_mw / 1000).toFixed(0)}W` : ""}
            </span>
          </div>
        ))}
        {cpu && (
          <div className="flex items-center gap-2.5 rounded-lg border border-border px-2.5 py-1.5 text-[10.5px]">
            <span className="text-fg">CPU</span>
            <span className="ml-auto font-mono text-subtle">
              {tempCpuMedia ?? "—"}°{cpu.sample.potencia_w != null ? ` · ${cpu.sample.potencia_w.toFixed(0)}W` : ""}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Comprobar tipos**

Run: `cd client && npx tsc -b`
Expected: sin salida.

- [ ] **Step 3: Commit**

```bash
git add client/src/admin/HardwareGlance.tsx
git commit -m "feat: HardwareGlance (vista de solo lectura de GPU/CPU para el Resumen)"
```

---

### Task 7: `ActividadFeed.tsx`

**Files:**
- Create: `client/src/admin/ActividadFeed.tsx`

**Interfaces:**
- Consume: `api.actividadGet`, `ActividadItem` (Task 5); `ago` (`lib/time.ts`, Task 4).

- [ ] **Step 1: Escribir `client/src/admin/ActividadFeed.tsx`**

```tsx
import { useEffect, useState } from "react";
import { api, type ActividadItem } from "../lib/api";
import { ago } from "../lib/time";

function texto(i: ActividadItem): string {
  switch (i.tipo) {
    case "cuenta_creada": return `${i.username} creó su cuenta`;
    case "analisis_resuelto": return `análisis #${i.id} ${i.estado === "hecho" ? "resuelto" : "con error"}`;
    case "aviso_publicado": return `aviso publicado — "${i.extracto}"`;
    case "solicitud_resuelta": return `solicitud de ${i.display_name} ${i.aprobada ? "aprobada" : "rechazada"}`;
  }
}

/** Se pide una vez al entrar, igual que el resto del Resumen — no hay
 *  sondeo continuo (ver spec, "Fuera de alcance"). */
export function ActividadFeed({ token }: { token: string }) {
  const [items, setItems] = useState<ActividadItem[] | null>(null);

  useEffect(() => {
    api.actividadGet(token).then(setItems).catch(() => setItems([]));
  }, [token]);

  return (
    <div className="mt-3 rounded-card border border-border p-3.5">
      <p className="text-[12.5px] text-fg">Actividad reciente</p>
      <p className="mb-3 text-[11px] text-muted">últimos eventos del servidor</p>

      {items === null && <p className="text-[11px] text-subtle">cargando</p>}
      {items?.length === 0 && <p className="text-[11px] text-subtle">nada todavía</p>}
      {items?.map((i, idx) => (
        <div key={idx}
          style={{ animation: `jg-fade-rise .5s ${Math.min(idx, 8) * 40}ms cubic-bezier(.16,1,.3,1) both` }}
          className="flex items-baseline gap-2 border-t border-border py-1.5 text-[11px] first:border-t-0">
          <span className="text-muted">{texto(i)}</span>
          <span className="ml-auto shrink-0 font-mono text-[9.5px] text-subtle">{ago(i.at)}</span>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Comprobar tipos**

Run: `cd client && npx tsc -b`
Expected: sin salida.

- [ ] **Step 3: Commit**

```bash
git add client/src/admin/ActividadFeed.tsx
git commit -m "feat: ActividadFeed (feed de actividad reciente en el Resumen)"
```

---

### Task 8: `PrimerosPasos.tsx`

**Files:**
- Create: `client/src/admin/PrimerosPasos.tsx`

**Interfaces:**
- Produce: `PrimerosPasos({ chequeos, onIr })`, tipo `Chequeo { label, hecho, ir? }`.
- Consume: `Seccion` (`./Sidebar`).

- [ ] **Step 1: Escribir `client/src/admin/PrimerosPasos.tsx`**

```tsx
import { useState } from "react";
import type { Seccion } from "./Sidebar";

const OCULTO_KEY = "lumi.resumen.primerosPasos.oculto";

export interface Chequeo {
  label: string;
  hecho: boolean;
  /** A dónde navegar si se pulsa "Ir →". Ausente = no hay acción directa. */
  ir?: Seccion;
}

/** Chequeos derivados de datos que `ResumenView` ya pidió — este componente
 *  no hace ninguna petición propia. Se colapsa solo en cuanto no queda
 *  nada pendiente (mismo `grid-template-rows` que ya usa `SecurityView`
 *  para sus paneles expandibles); antes de eso se puede cerrar a mano, y
 *  esa decisión se recuerda en este navegador — igual que
 *  `lumi.notificaciones.leido` — permanente para este perfil. */
export function PrimerosPasos({ chequeos, onIr }: { chequeos: Chequeo[]; onIr: (s: Seccion) => void }) {
  const [oculto, setOculto] = useState(() => localStorage.getItem(OCULTO_KEY) === "1");
  const pendientes = chequeos.filter((c) => !c.hecho).length;
  const visible = !oculto && pendientes > 0;

  function cerrar() {
    localStorage.setItem(OCULTO_KEY, "1");
    setOculto(true);
  }

  return (
    <div className="grid transition-[grid-template-rows] duration-[420ms] ease-expo"
      style={{ gridTemplateRows: visible ? "1fr" : "0fr" }}>
      <div className="overflow-hidden">
        <div className="mb-4 overflow-hidden rounded-[11px] border border-white/[.14]">
          <div className="flex items-center gap-2.5 px-3.5 pb-2.5 pt-3">
            <p className="text-[11.5px] text-fg">Primeros pasos</p>
            <span className="text-[9.5px] text-subtle">{pendientes} de {chequeos.length} pendientes</span>
            <button onClick={cerrar} className="ml-auto text-[11px] text-subtle hover:text-fg">✕</button>
          </div>
          <div className="mx-3.5 mb-2.5 h-[2px] overflow-hidden rounded-sm bg-border">
            <div className="h-full bg-fg transition-[width] duration-500 ease-expo"
              style={{ width: `${((chequeos.length - pendientes) / chequeos.length) * 100}%` }} />
          </div>
          {chequeos.map((c, i) => (
            <div key={i}
              style={{ animation: `jg-fade-rise .5s ${i * 40}ms cubic-bezier(.16,1,.3,1) both` }}
              className="flex items-center gap-2.5 border-t border-border px-3.5 py-2 text-[10.5px]">
              <span className={`grid h-[13px] w-[13px] shrink-0 place-items-center rounded-[3px] border text-[9px] font-bold ${
                c.hecho ? "border-fg bg-fg text-bg" : "border-white/25 text-transparent"}`}>
                ✓
              </span>
              <span className={c.hecho ? "text-subtle line-through" : "text-muted"}>{c.label}</span>
              {!c.hecho && c.ir && (
                <button onClick={() => onIr(c.ir!)} className="ml-auto shrink-0 text-[10px] text-draw-fg hover:underline">
                  Ir →
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Comprobar tipos**

Run: `cd client && npx tsc -b`
Expected: sin salida.

- [ ] **Step 3: Commit**

```bash
git add client/src/admin/PrimerosPasos.tsx
git commit -m "feat: PrimerosPasos (checklist dismissible del Resumen)"
```

---

### Task 9: `ResumenHeader.tsx`

**Files:**
- Create: `client/src/admin/ResumenHeader.tsx`

**Interfaces:**
- Consume: `api.networkGet`, `ServerProfileSettings`, `NetworkView` (`lib/api.ts`, ya existentes); `lumiUrl` (`lib/bridge.ts`); `AvisoEditor` (`./AvisoEditor`).
- Produce: `ResumenHeader({ token, arrancadoEn, perfil })`.

- [ ] **Step 1: Escribir `client/src/admin/ResumenHeader.tsx`**

```tsx
import { useEffect, useState } from "react";
import { api, type NetworkView as NetworkViewData, type ServerProfileSettings } from "../lib/api";
import { lumiUrl } from "../lib/bridge";
import { AvisoEditor } from "./AvisoEditor";

function desdeHace(epoch: number): string {
  const s = Math.max(0, Math.floor(Date.now() / 1000) - epoch);
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600);
  if (d > 0) return `${d} d ${String(h).padStart(2, "0")} h`;
  return `${h} h ${String(Math.floor((s % 3600) / 60)).padStart(2, "0")} min`;
}

/** Cabecera del Resumen: identidad del servidor (perfil) + tarjeta de
 *  servidor copiable en una pastilla superpuesta. Cae al título simple de
 *  siempre si no hay perfil configurado — la tarjeta se sigue mostrando
 *  igual, no depende de que haya perfil.
 *
 *  Deliberadamente NO reutiliza `ServerProfileCard` (pensado para el popup
 *  de "Añadir servidor": banner fijo pequeño, sin overlay de tarjeta):
 *  esta cabecera es de ancho completo y lleva la pastilla superpuesta,
 *  suficiente distinto como para no forzar un único componente con dos
 *  formas. */
export function ResumenHeader({ token, arrancadoEn, perfil }: {
  token: string; arrancadoEn: number; perfil: ServerProfileSettings | null;
}) {
  const [red, setRed] = useState<NetworkViewData | null>(null);
  const [copiado, setCopiado] = useState(false);

  useEffect(() => { api.networkGet(token).then(setRed).catch(() => setRed(null)); }, [token]);

  function copiar() {
    if (!red) return;
    void navigator.clipboard.writeText(red.server_card);
    setCopiado(true);
    setTimeout(() => setCopiado(false), 1500);
  }

  const pill = red && (
    <div className="flex items-center gap-1.5 rounded-lg border border-white/15 bg-black/45 px-2 py-1 backdrop-blur-sm">
      <code className="max-w-[220px] truncate font-mono text-[9.5px] text-subtle">{red.server_card}</code>
      <button onClick={copiar} className="jg-press shrink-0 rounded-md bg-white/10 px-1.5 py-0.5 text-[8.5px] text-fg">
        {copiado ? "Copiada" : "Copiar"}
      </button>
    </div>
  );

  if (!perfil?.title) {
    return (
      <div className="flex items-end gap-3 border-b border-border pb-[11px]">
        <h2 className="text-[21px] font-medium leading-none tracking-[-.025em]">Resumen</h2>
        <span className="ml-auto pb-0.5 font-mono text-[10.5px] text-subtle">
          en marcha desde hace {desdeHace(arrancadoEn)}
        </span>
        {pill}
      </div>
    );
  }

  return (
    <div className="relative h-[92px] overflow-hidden rounded-[11px] border border-border">
      {perfil.has_banner ? (
        <img src={lumiUrl("/v1/server-profile/banner")} alt="" className="absolute inset-0 h-full w-full object-cover" />
      ) : (
        <div className="absolute inset-0 bg-elevated" />
      )}
      <div className="absolute inset-0 bg-gradient-to-r from-black/10 via-black/40 to-black/85" />
      {perfil.has_avatar && (
        <img src={lumiUrl("/v1/server-profile/avatar")} alt=""
          className="absolute bottom-3.5 left-3.5 h-11 w-11 rounded-[10px] border-2 border-bg object-cover" />
      )}
      <div className="absolute bottom-3.5 left-[66px] right-3.5">
        <p className="text-[15px] font-medium text-fg [text-shadow:0_1px_3px_rgba(0,0,0,.6)]">{perfil.title}</p>
        {perfil.description ? (
          <div className="mt-0.5 max-w-[420px] text-[10px] text-white/70 [&_p]:m-0">
            <AvisoEditor contenido={perfil.description} editable={false} compacto />
          </div>
        ) : null}
      </div>
      <div className="absolute right-3 top-3">{pill}</div>
    </div>
  );
}
```

- [ ] **Step 2: Comprobar tipos**

Run: `cd client && npx tsc -b`
Expected: sin salida.

- [ ] **Step 3: Commit**

```bash
git add client/src/admin/ResumenHeader.tsx
git commit -m "feat: ResumenHeader (identidad del servidor + tarjeta copiable)"
```

---

### Task 10: Ensamblar todo en `ResumenView.tsx`

**Files:**
- Modify: `client/src/admin/ResumenView.tsx`

**Interfaces:**
- Consume: `PrimerosPasos`/`Chequeo` (Task 8), `ResumenHeader` (Task 9),
  `HardwareGlance` (Task 6), `ActividadFeed` (Task 7), `QueueRow`
  (`./QueueRow`, ya existente), `ServerProfileSettings`/`api.serverProfileGet`
  (ya existentes).

- [ ] **Step 1: Añadir los imports y el fetch de perfil**

Sustituir la cabecera del archivo (línea 1-3):

```tsx
import { useEffect, useRef, useState } from "react";
import { api, type Resumen } from "../lib/api";
import type { Seccion } from "./Sidebar";
```

por:

```tsx
import { useEffect, useRef, useState } from "react";
import { api, type Resumen, type ServerProfileSettings } from "../lib/api";
import type { Seccion } from "./Sidebar";
import { ActividadFeed } from "./ActividadFeed";
import { HardwareGlance } from "./HardwareGlance";
import { PrimerosPasos, type Chequeo } from "./PrimerosPasos";
import { QueueRow } from "./QueueRow";
import { ResumenHeader } from "./ResumenHeader";
```

- [ ] **Step 2: Cargar el perfil además del resumen**

Sustituir (línea 89-95):

```tsx
export function ResumenView({ token, onIr }: { token: string; onIr: (s: Seccion) => void }) {
  const [r, setR] = useState<Resumen | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<Resumen>("/v1/admin/resumen", token).then(setR).catch((e) => setError(String(e)));
  }, [token]);
```

por:

```tsx
export function ResumenView({ token, onIr }: { token: string; onIr: (s: Seccion) => void }) {
  const [r, setR] = useState<Resumen | null>(null);
  const [perfil, setPerfil] = useState<ServerProfileSettings | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<Resumen>("/v1/admin/resumen", token).then(setR).catch((e) => setError(String(e)));
    api.serverProfileGet(token).then(setPerfil).catch(() => setPerfil(null));
  }, [token]);
```

- [ ] **Step 3: Reemplazar la cabecera y añadir las secciones nuevas**

Sustituir el `return` de la vista con datos ya cargados (línea 97-124 —
desde `if (error) return ...` hasta el cierre del `</div>` de las fichas,
sin tocar el bloque de los dos placeholders punteados que viene justo
después):

```tsx
  if (error) return <p className="px-6 pt-5 text-[11px] text-danger-fg">{error}</p>;
  if (!r) return <Esqueleto />;

  return (
    <div className="px-6 pb-8 pt-5">
      <span className="mb-1.5 block text-[8.5px] uppercase tracking-[.15em] text-subtle">Servidor</span>
      <div className="flex items-end gap-3 border-b border-border pb-[11px]">
        <h2 className="text-[21px] font-medium leading-none tracking-[-.025em]">Resumen</h2>
        <span className="ml-auto pb-0.5 font-mono text-[10.5px] text-subtle">
          en marcha desde hace {desdeHace(r.arrancado_en)}
        </span>
      </div>

      <div className="mt-[19px] grid grid-cols-4 gap-3">
        <Ficha i={0} k="Pendiente de ti" valor={<Cifra n={r.solicitudes_pendientes} />}
          unidad="solicitudes" onClick={() => onIr("solicitudes")}
          sub={r.solicitud_mas_antigua
            ? `la más antigua, hace ${desdeHace(r.solicitud_mas_antigua)}`
            : "nada esperando"} />
        <Ficha i={1} k="Usuarios" valor={<Cifra n={r.usuarios} />}
          sub={`${r.usuarios_conectados} conectados ahora`} onClick={() => onIr("usuarios")} />
        <Ficha i={2} k="Análisis hoy" valor={<Cifra n={r.analisis_hoy} />}
          sub={`${r.analisis_en_cola} en cola`} serie={r.analisis_serie}
          onClick={() => onIr("cola")} />
        <Ficha i={3} k="Índices instalados" valor={<Cifra n={r.indices} />}
          unidad={`· ${tamano(r.indices_bytes)}`} sub={`${r.teselas} teselas cubiertas`}
          onClick={() => onIr("indices")} />
      </div>
```

por:

```tsx
  if (error) return <p className="px-6 pt-5 text-[11px] text-danger-fg">{error}</p>;
  if (!r) return <Esqueleto />;

  const chequeos: Chequeo[] = [
    { label: "Perfil del servidor (foto, título, descripción)", hecho: !!perfil?.title, ir: "personalizacion" },
    { label: "Instala al menos un modelo para poder analizar", hecho: r.modelos_instalados, ir: "modelos" },
    { label: "Instala un índice para habilitar la búsqueda geográfica", hecho: r.indices > 0, ir: "indices" },
    { label: "Sigues siendo el único usuario del servidor", hecho: r.usuarios > 1, ir: "solicitudes" },
  ];

  return (
    <div className="px-6 pb-8 pt-5">
      <span className="mb-1.5 block text-[8.5px] uppercase tracking-[.15em] text-subtle">Servidor</span>

      <PrimerosPasos chequeos={chequeos} onIr={onIr} />

      <ResumenHeader token={token} arrancadoEn={r.arrancado_en} perfil={perfil} />

      <div className="mt-[19px] grid grid-cols-4 gap-3">
        <Ficha i={0} k="Pendiente de ti" valor={<Cifra n={r.solicitudes_pendientes} />}
          unidad="solicitudes" onClick={() => onIr("solicitudes")}
          sub={r.solicitud_mas_antigua
            ? `la más antigua, hace ${desdeHace(r.solicitud_mas_antigua)}`
            : "nada esperando"} />
        <Ficha i={1} k="Usuarios" valor={<Cifra n={r.usuarios} />}
          sub={`${r.usuarios_conectados} conectados ahora`} onClick={() => onIr("usuarios")} />
        <Ficha i={2} k="Análisis hoy" valor={<Cifra n={r.analisis_hoy} />}
          sub={`${r.analisis_en_cola} en cola`} serie={r.analisis_serie}
          onClick={() => onIr("cola")} />
        <Ficha i={3} k="Índices instalados" valor={<Cifra n={r.indices} />}
          unidad={`· ${tamano(r.indices_bytes)}`} sub={`${r.teselas} teselas cubiertas`}
          onClick={() => onIr("indices")} />
      </div>
```

`desdeHace` sigue siendo necesaria aquí (la usa el `sub` de "Pendiente de
ti") — no se borra del archivo, solo se dejó de usar en la cabecera
(que ahora vive en `ResumenHeader.tsx`, con su propia copia — ver la nota
de la Task 9).

- [ ] **Step 4: Añadir cola/hardware y actividad tras los placeholders**

Localizar el cierre del bloque de los dos placeholders punteados (el
`</div>` que sigue a `{[["Niveles listos"], ["Pesos en disco"]].map(...)}`,
justo antes del `</div>` final que cierra `<div className="px-6 pb-8 pt-5">`)
y añadir, entre ese cierre y el `</div>` final:

```tsx
      <div className="mt-4 grid grid-cols-2 gap-3">
        <QueueRow token={token} />
        <HardwareGlance token={token} />
      </div>

      <ActividadFeed token={token} />
```

- [ ] **Step 5: Comprobar tipos**

Run: `cd client && npx tsc -b`
Expected: sin salida.

- [ ] **Step 6: Verificación manual**

Con `lumid` corriendo y `npm run tauri dev`: entrar como admin, abrir
Resumen. Con un servidor de pruebas recién creado (sin perfil, sin
modelos, sin índices, un solo usuario), debe verse "Primeros pasos" con
0 de 4 hechos y la cabecera simple de siempre. Tras configurar el perfil
de servidor en Customización y recargar, ese chequeo debe aparecer tachado
y la cabecera debe pasar a mostrar el banner/foto/título.

- [ ] **Step 7: Commit**

```bash
git add client/src/admin/ResumenView.tsx
git commit -m "feat: ensambla Primeros pasos, cabecera con perfil, cola/hardware y actividad en el Resumen"
```

---

## Self-Review

**Cobertura de la spec:**
- §1 (primeros pasos) → Task 8, integrado en Task 10.
- §2 (cabecera con identidad) → Task 9, integrado en Task 10.
- §3 (campo nuevo en el endpoint) → Tasks 1, 2.
- §4 (cola y hardware) → Task 6 (hardware nuevo) + `QueueRow` reutilizado en Task 10.
- §5 (actividad reciente) → Tasks 1, 3 (backend), 4 (extraer `ago`), 7 (frontend).
- Animaciones → aplicadas en cada componente nuevo (Tasks 7, 8) reutilizando
  `jg-fade-rise`/`ease-expo`/el patrón de colapso de `SecurityView`, sin
  vocabulario nuevo.
- Fuera de alcance (hardware editable, actividad en vivo, chequeos
  adicionales) → respetado, ninguna tarea lo toca.

**Placeholders:** ninguno — cada paso trae el código completo.

**Consistencia de tipos:** `ActividadItem` (Rust, Task 1) con
`#[serde(tag = "tipo", rename_all = "snake_case")]` produce exactamente
las cuatro variantes con las claves (`cuenta_creada`, `analisis_resuelto`,
`aviso_publicado`, `solicitud_resuelta`) que el tipo TS de la Task 5 y el
`switch` de `ActividadFeed` (Task 7) esperan. `Resumen.modelos_instalados`
(Rust, Task 1/2) ↔ mismo nombre en TS (Task 5) ↔ consumido en el chequeo
de la Task 10. `Chequeo { label, hecho, ir? }` (Task 8) se construye en la
Task 10 con esa misma forma exacta.
