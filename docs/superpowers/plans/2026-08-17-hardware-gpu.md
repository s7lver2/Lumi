# Hardware (GPU) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the "Hardware" admin panel section for GPUs — always-on monitoring, a
básico/avanzado control mode, and safe writes to power limit / clock offset / fan curve with
factory-range confirmation, matching `docs/superpowers/specs/2026-08-17-hardware-gpu-design.md`.

**Architecture:** `lumid` gains a `hardware` module: reads go straight through `nvml-wrapper`
(already a dependency), writes split into two paths — power limit via NVML directly, clock
offset/fan curve via an `nvidia-settings` subprocess (same async-subprocess pattern as
`verificar.rs`). Both writes sit behind two new capability-matrix entries, computed once at
`GET /v1/hello` time. Applied profiles persist in a new SQLite table and get reapplied once at
daemon startup. The client renders a device-row list (a `HardwareView`) and a separate modal
editor (`HardwareEditor`) with a reusable draggable curve component, following the approved
mockups at `.superpowers/brainstorm/859-1786959357/content/full-screen-v2.html` and
`edit-modal-v2.html` — read those two files before starting the frontend tasks; they are the
authoritative visual/interaction reference, this plan defines the component contracts and the
logic that has to be exactly right (drag math, confirmation flow, capability gating).

**Tech Stack:** Rust (axum, rusqlite, `nvml-wrapper` 0.10, `tokio::process::Command`), React +
TypeScript + Tailwind (client/), SVG for the curve editor (no chart library).

## Global Constraints

- No tests unless explicitly requested, except non-trivial pure logic in `lumi-proto`
  (`cargo test -p lumi-proto`) — matches the project's existing convention.
- One commit per finished task.
- Dark theme only, mono font for machine-produced numbers (temps, watts, MHz, %, ips),
  hand-drawn SVG icons only (`viewBox 0 0 24 24`, `stroke="currentColor"`,
  `strokeWidth={1.8}`, round caps/joins) — see `client/src/ui/Icon.tsx`.
- Every capability that isn't `On` must carry a non-empty `reason` (enforced today by
  `caps.rs`'s own test — keep it passing).
- `nvml-wrapper` 0.10 exposes exactly **one** temperature sensor per GPU
  (`TemperatureSensor::Gpu`) and fan speed as a **percentage**
  (`fan_speed(fan_idx) -> Result<u32>`), never rpm. Do not invent hotspot/memory-junction
  readings or rpm anywhere in this plan.

---

### Task 1: Tipos compartidos y matriz de capacidades

**Files:**
- Modify: `crates/lumi-proto/src/api.rs`
- Modify: `crates/lumi-proto/src/caps.rs`
- Modify: `crates/lumid/src/routes/hello.rs`

**Interfaces:**
- Produces: `GpuSample` gains `clock_mhz: Option<u32>` and `fan_pct: Option<u32>`.
- Produces: `PuntoCurva { temp_c: i32, valor: i32 }`, `HardwareDevice`, `HardwareProfile`,
  `PatchHardwareReq`, `AplicarResultado` (all `pub` in `lumi_proto::api`), consumed by Task 3
  (lumid write logic) and Task 7 (client types).
- Produces: `caps::HardwareCaps { potencia: CapState, potencia_reason: Option<String>,
  curvas: CapState, curvas_reason: Option<String> }` and `caps::matrix(mode, gpu_count,
  qdrant_vivo, hw: &HardwareCaps) -> Vec<Capability>` (signature change — old 3-arg call
  sites must be updated in this same task).

- [ ] **Step 1: Extend `GpuSample` and add the hardware types**

In `crates/lumi-proto/src/api.rs`, replace the existing `GpuSample` struct:

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GpuSample {
    pub index: u32,
    pub util_pct: u32,
    pub vram_used_mb: u64,
    pub vram_total_mb: u64,
    pub temp_c: Option<u32>,
    /// Reloj de núcleo actual, en MHz. `None` si NVML no lo da (p. ej. WSL2).
    pub clock_mhz: Option<u32>,
    /// Velocidad de ventilador en %, no rpm — es lo único que expone NVML.
    pub fan_pct: Option<u32>,
}
```

Then append, at the end of the file:

```rust
/// Un punto de una curva editable — de ventilador (temperatura→%) o de offset
/// de reloj (potencia→MHz), según en qué pestaña vive. El mismo tipo sirve
/// para las dos: la interfaz decide qué eje es cuál.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct PuntoCurva {
    pub temp_c: i32,
    pub valor: i32,
}

/// Rango de fábrica de una GPU, tal como lo reporta NVML. Nunca inventado por
/// el servidor — si NVML no lo da, no hay rango y el control avanzado para
/// esa tarjeta se deshabilita (ver `HardwareCaps`).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RangoFabrica {
    pub potencia_min_w: u32,
    pub potencia_max_w: u32,
    pub temp_throttle_c: Option<u32>,
}

/// Lo que devuelve `GET /v1/admin/hardware`: lectura actual + rango de
/// fábrica + el perfil ya persistido para esa tarjeta, si hay uno.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HardwareDevice {
    pub index: u32,
    pub name: String,
    pub sample: GpuSample,
    pub rango: RangoFabrica,
    pub perfil: Option<HardwareProfile>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HardwareProfile {
    pub potencia_w: u32,
    pub offset_nucleo_mhz: i32,
    pub offset_memoria_mhz: i32,
    pub curva_ventilador: Vec<PuntoCurva>,
}

/// Cuerpo de `PATCH /v1/admin/hardware/{index}`. Cualquier campo ausente deja
/// ese valor como estaba — igual que `PatchSecurityReq`.
#[derive(Debug, Deserialize)]
pub struct PatchHardwareReq {
    pub potencia_w: Option<u32>,
    pub offset_nucleo_mhz: Option<i32>,
    pub offset_memoria_mhz: Option<i32>,
    pub curva_ventilador: Option<Vec<PuntoCurva>>,
    /// `false` (o ausente) y algún valor sale del rango de fábrica → `409`
    /// con el motivo. El modal de "soy consciente" es quien reintenta con
    /// `true`, nunca el primer intento.
    #[serde(default)]
    pub confirmado: bool,
}
```

- [ ] **Step 2: Añadir `HardwareCaps` y cambiar la firma de `matrix()`**

In `crates/lumi-proto/src/caps.rs`, add this struct right after the `Capability` struct
(before `fn cap(...)`):

```rust
/// Lo que decide si los controles de escritura de Hardware aparecen
/// habilitados. Se calcula UNA VEZ por petición a `/v1/hello`, no en cada
/// muestra de telemetría — comprobar `nvidia-settings` de verdad tiene un
/// coste (lanza un subproceso) que no hace falta pagar cada segundo.
#[derive(Debug, Clone, Default)]
pub struct HardwareCaps {
    pub potencia: CapState,
    pub potencia_reason: Option<String>,
    pub curvas: CapState,
    pub curvas_reason: Option<String>,
}
```

`CapState` needs a `Default` impl for the struct above to derive `Default` — add it right
after the existing `CapState` enum definition:

```rust
impl Default for CapState {
    fn default() -> Self {
        CapState::Off
    }
}
```

Change the `matrix` function signature and body — replace:

```rust
pub fn matrix(mode: Mode, gpu_count: usize, qdrant_vivo: bool) -> Vec<Capability> {
```

with:

```rust
pub fn matrix(mode: Mode, gpu_count: usize, qdrant_vivo: bool, hw: &HardwareCaps) -> Vec<Capability> {
```

and, right before the final `match mode { ... }` block (so both arms get it), build the two
new capabilities:

```rust
    let hw_potencia = cap(
        "hardware_potencia",
        "Ajustar límite de potencia de GPU",
        hw.potencia,
        hw.potencia_reason.as_deref(),
    );
    let hw_curvas = cap(
        "hardware_curvas",
        "Curvas de reloj y ventilador",
        hw.curvas,
        hw.curvas_reason.as_deref(),
    );
```

Then add `hw_potencia` and `hw_curvas` to the end of BOTH the `Mode::Native` and
`Mode::Docker` vectors (after `indices`), e.g. `Mode::Native` becomes:

```rust
        Mode::Native => vec![
            cap(
                "shard",
                "Sharding multi-GPU",
                if multi { CapState::On } else { CapState::Off },
                if multi { None } else { Some("Solo hay una GPU en el host.") },
            ),
            cap("offload", "Offload GPU + CPU", CapState::On, None),
            cap("nvml", "Telemetría NVML", CapState::On, None),
            cap("sealed", "Modo sellado", CapState::On, None),
            indices,
            hw_potencia,
            hw_curvas,
        ],
```

(same two pushes at the end of the `Mode::Docker` vec).

Update the existing test at the bottom of the file — its loop calls `matrix(mode, gpus,
qdrant_vivo)` with three args; change the call to pass a fourth:

```rust
                    for c in matrix(mode, gpus, qdrant_vivo, &HardwareCaps::default()) {
```

- [ ] **Step 3: Run the proto tests**

Run: `cargo test -p lumi-proto`
Expected: `todo_recorte_lleva_motivo` passes (both new capabilities are `Off` by default with
`HardwareCaps::default()`, and `Off` always needs a `reason` from `cap()` — but
`potencia_reason`/`curvas_reason` are `None` by default, which would fail the test!). Fix this
by giving `HardwareCaps::default()`'s two reason fields a real default motive instead of
relying on `#[derive(Default)]` for the whole struct — replace the `#[derive(Default)]`
struct with an explicit `impl Default`:

```rust
#[derive(Debug, Clone)]
pub struct HardwareCaps {
    pub potencia: CapState,
    pub potencia_reason: Option<String>,
    pub curvas: CapState,
    pub curvas_reason: Option<String>,
}

impl Default for HardwareCaps {
    fn default() -> Self {
        Self {
            potencia: CapState::Off,
            potencia_reason: Some("todavía no comprobado".into()),
            curvas: CapState::Off,
            curvas_reason: Some("todavía no comprobado".into()),
        }
    }
}
```

Run again: `cargo test -p lumi-proto` — Expected: PASS.

- [ ] **Step 4: Fix the one other call site**

`crates/lumid/src/routes/hello.rs` calls `lumi_proto::caps::matrix(app.mode, app.gpus.len(),
qdrant_vivo)` — this won't compile yet with the new signature. Change it to pass a real
`HardwareCaps` computed from the new `hardware` module built in Task 3:

```rust
        capabilities: lumi_proto::caps::matrix(
            app.mode,
            app.gpus.len(),
            qdrant_vivo,
            &crate::hardware::capacidades().await,
        ),
```

This won't compile until Task 3 adds `crate::hardware::capacidades()` — that's fine, this
step is committed together with Task 3, not before. **Do not run `cargo build` for lumid
alone yet** — Task 3 finishes the wiring. Confirm only `cargo test -p lumi-proto` passes here.

- [ ] **Step 5: Commit**

```bash
git add crates/lumi-proto/src/api.rs crates/lumi-proto/src/caps.rs
git commit -m "feat: tipos de Hardware y capacidades de potencia/curvas en lumi-proto"
```

(Leave `hello.rs` uncommitted here — Task 3's commit includes it, since the code doesn't
compile between the two.)

---

### Task 2: Tabla de persistencia

**Files:**
- Modify: `crates/lumid/src/store.rs`

**Interfaces:**
- Produces: SQLite table `hardware_profiles(gpu_index INTEGER PRIMARY KEY, potencia_w
  INTEGER NOT NULL, offset_nucleo_mhz INTEGER NOT NULL, offset_memoria_mhz INTEGER NOT NULL,
  curva_ventilador TEXT NOT NULL, updated_at INTEGER NOT NULL)`, read/written by Task 3.

- [ ] **Step 1: Add the table to `SCHEMA`**

In `crates/lumid/src/store.rs`, add this block right after the `avisos_usuarios` table
definition, still inside the `SCHEMA` string constant (before the closing `";`):

```sql
CREATE TABLE IF NOT EXISTS hardware_profiles (
    gpu_index          INTEGER PRIMARY KEY,
    potencia_w         INTEGER NOT NULL,
    offset_nucleo_mhz  INTEGER NOT NULL,
    offset_memoria_mhz INTEGER NOT NULL,
    -- JSON de `Vec<PuntoCurva>` — una curva no necesita sus propias filas,
    -- se edita y se relee entera cada vez.
    curva_ventilador   TEXT NOT NULL,
    updated_at         INTEGER NOT NULL
);
```

- [ ] **Step 2: Verify it compiles and the schema applies**

Run: `cargo build -p lumid`
Expected: builds clean (this is additive DDL only, `CREATE TABLE IF NOT EXISTS` is safe to
re-run against an existing `lumi.db`).

- [ ] **Step 3: Commit**

```bash
git add crates/lumid/src/store.rs
git commit -m "feat: tabla hardware_profiles para persistir el perfil de cada GPU"
```

---

### Task 3: Lecturas, escrituras y capacidades de hardware en `lumid`

**Files:**
- Create: `crates/lumid/src/hardware.rs`
- Modify: `crates/lumid/src/main.rs` (add `mod hardware;`, register routes, spawn reaplicación
  al arrancar)
- Modify: `crates/lumid/src/routes/hello.rs` (finish Task 1 Step 4's wiring)
- Modify: `crates/lumid/src/telemetry.rs` (`GpuSample` now needs `clock_mhz`/`fan_pct`)
- Create: `crates/lumid/src/routes/hardware.rs`

**Interfaces:**
- Consumes: `lumi_proto::api::{GpuSample, PuntoCurva, RangoFabrica, HardwareDevice,
  HardwareProfile, PatchHardwareReq}` (Task 1), `lumi_proto::caps::{HardwareCaps, CapState}`
  (Task 1), `App` (has `.store`, `.gpus`, `.dir`).
- Produces: `hardware::capacidades() -> HardwareCaps` (async — checks `nvidia-settings`
  presence via subprocess), `hardware::dispositivos(&App) -> Vec<HardwareDevice>`,
  `hardware::aplicar(&App, gpu_index: u32, req: &PatchHardwareReq) -> Result<HardwareDevice,
  AplicarError>`, `hardware::reaplicar_al_arrancar(&App)` (called once from `main`),
  `hardware::fuera_de_rango(perfil: &HardwareProfile, rango: &RangoFabrica) -> Option<String>`
  (pure, tested).
- Produces (routes): `routes::hardware::listar`, `routes::hardware::aplicar`.

- [ ] **Step 1: Write the pure range-check first, with its test**

Create `crates/lumid/src/hardware.rs`:

```rust
//! Lecturas y escrituras de hardware (GPU). Las lecturas van directo por
//! NVML; la potencia se escribe también por NVML; el offset de reloj y la
//! curva de ventilador solo existen vía `nvidia-settings`, que necesita un
//! servidor X con Coolbits — si no lo hay, esos dos controles se anuncian
//! deshabilitados con el motivo real, nunca se ocultan ni se fingen.

use crate::App;
use lumi_proto::api::{
    GpuSample, HardwareDevice, HardwareProfile, PatchHardwareReq, PuntoCurva, RangoFabrica,
};
use lumi_proto::caps::{CapState, HardwareCaps};
use nvml_wrapper::enum_wrappers::device::{Clock, TemperatureSensor};
use nvml_wrapper::Nvml;

/// `None` si el perfil está dentro del rango de fábrica; si no, el motivo
/// legible que va tanto al `409` como al modal de "soy consciente" — un solo
/// texto para las dos cosas, no dos redacciones que puedan desincronizarse.
pub fn fuera_de_rango(perfil: &HardwareProfile, rango: &RangoFabrica) -> Option<String> {
    if perfil.potencia_w > rango.potencia_max_w {
        return Some(format!(
            "{}W supera el máximo de fábrica certificado ({}W). Puede acortar la vida útil de la tarjeta o causar apagados bajo carga.",
            perfil.potencia_w, rango.potencia_max_w
        ));
    }
    if perfil.potencia_w < rango.potencia_min_w {
        return Some(format!(
            "{}W está por debajo del mínimo de fábrica ({}W).",
            perfil.potencia_w, rango.potencia_min_w
        ));
    }
    if let Some(throttle) = rango.temp_throttle_c {
        for p in &perfil.curva_ventilador {
            if p.temp_c as u32 > throttle {
                return Some(format!(
                    "la curva de ventilador tiene un punto a {}°C, por encima del umbral de throttle de fábrica ({}°C).",
                    p.temp_c, throttle
                ));
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rango() -> RangoFabrica {
        RangoFabrica { potencia_min_w: 125, potencia_max_w: 220, temp_throttle_c: Some(85) }
    }

    fn perfil(potencia_w: u32) -> HardwareProfile {
        HardwareProfile {
            potencia_w,
            offset_nucleo_mhz: 0,
            offset_memoria_mhz: 0,
            curva_ventilador: vec![PuntoCurva { temp_c: 60, valor: 50 }],
        }
    }

    #[test]
    fn dentro_de_fabrica_no_da_motivo() {
        assert!(fuera_de_rango(&perfil(185), &rango()).is_none());
    }

    #[test]
    fn por_encima_de_fabrica_da_motivo() {
        let m = fuera_de_rango(&perfil(225), &rango()).unwrap();
        assert!(m.contains("225"));
        assert!(m.contains("220"));
    }

    #[test]
    fn por_debajo_de_fabrica_da_motivo() {
        let m = fuera_de_rango(&perfil(100), &rango()).unwrap();
        assert!(m.contains("100"));
    }

    #[test]
    fn punto_de_curva_sobre_el_throttle_da_motivo() {
        let mut p = perfil(185);
        p.curva_ventilador.push(PuntoCurva { temp_c: 90, valor: 100 });
        let m = fuera_de_rango(&p, &rango()).unwrap();
        assert!(m.contains("90"));
        assert!(m.contains("85"));
    }
}
```

- [ ] **Step 2: Run the test to verify it passes**

Run: `cargo test -p lumid hardware::tests`
Expected: 4 tests pass (`dentro_de_fabrica_no_da_motivo`, `por_encima_de_fabrica_da_motivo`,
`por_debajo_de_fabrica_da_motivo`, `punto_de_curva_sobre_el_throttle_da_motivo`).

- [ ] **Step 3: Add the NVML reads and the capability probe**

Append to `crates/lumid/src/hardware.rs`:

```rust
/// Se comprueba una vez por conexión (`GET /v1/hello`), no en cada muestra:
/// lanzar `nvidia-settings` tiene coste real y el resultado no cambia salvo
/// que alguien arranque o pare un servidor X entre medias.
pub async fn capacidades() -> HardwareCaps {
    let potencia_ok = Nvml::init().is_ok();
    let (potencia, potencia_reason) = if potencia_ok {
        (CapState::On, None)
    } else {
        (CapState::Off, Some("NVML no está disponible en este host.".to_string()))
    };

    let curvas_ok = tokio::process::Command::new("nvidia-settings")
        .args(["-q", "GPUGraphicsClockOffset"])
        .output()
        .await
        .is_ok_and(|o| o.status.success());
    let (curvas, curvas_reason) = if curvas_ok {
        (CapState::On, None)
    } else {
        (
            CapState::Off,
            Some("Requiere nvidia-settings con un servidor X y Coolbits activo. En WSL2 esto nunca está disponible: la GPU se pasa en modo de solo lectura.".to_string()),
        )
    };

    HardwareCaps { potencia, potencia_reason, curvas, curvas_reason }
}

fn rango_de(nvml: &Nvml, index: u32) -> Option<RangoFabrica> {
    let d = nvml.device_by_index(index).ok()?;
    let c = d.power_management_limit_constraints().ok()?;
    let throttle = d
        .temperature_threshold(nvml_wrapper::enum_wrappers::device::TemperatureThreshold::Slowdown)
        .ok();
    Some(RangoFabrica {
        potencia_min_w: c.min_limit / 1000,
        potencia_max_w: c.max_limit / 1000,
        temp_throttle_c: throttle,
    })
}

fn muestra_de(nvml: &Nvml, index: u32) -> Option<GpuSample> {
    let d = nvml.device_by_index(index).ok()?;
    let m = d.memory_info().ok()?;
    Some(GpuSample {
        index,
        util_pct: d.utilization_rates().map(|u| u.gpu).unwrap_or(0),
        vram_used_mb: m.used / 1024 / 1024,
        vram_total_mb: m.total / 1024 / 1024,
        temp_c: d.temperature(TemperatureSensor::Gpu).ok(),
        clock_mhz: d.clock(Clock::Graphics, nvml_wrapper::enum_wrappers::device::ClockId::Current).ok(),
        fan_pct: d.fan_speed(0).ok(),
    })
}

fn perfil_guardado(app: &App, index: u32) -> Option<HardwareProfile> {
    let c = app.store.conn();
    c.query_row(
        "SELECT potencia_w, offset_nucleo_mhz, offset_memoria_mhz, curva_ventilador
           FROM hardware_profiles WHERE gpu_index = ?1",
        [index],
        |r| {
            let curva_json: String = r.get(3)?;
            Ok(HardwareProfile {
                potencia_w: r.get(0)?,
                offset_nucleo_mhz: r.get(1)?,
                offset_memoria_mhz: r.get(2)?,
                curva_ventilador: serde_json::from_str(&curva_json).unwrap_or_default(),
            })
        },
    )
    .ok()
}

/// Lista para `GET /v1/admin/hardware`. Si NVML no responde, la lista sale
/// vacía — no es un error de la ruta, es que no hay nada que enseñar.
pub fn dispositivos(app: &App) -> Vec<HardwareDevice> {
    let Ok(nvml) = Nvml::init() else { return Vec::new() };
    (0..app.gpus.len() as u32)
        .filter_map(|i| {
            let sample = muestra_de(&nvml, i)?;
            let rango = rango_de(&nvml, i)?;
            let name = app.gpus.get(i as usize).map(|g| g.name.clone()).unwrap_or_default();
            Some(HardwareDevice { index: i, name, sample, rango, perfil: perfil_guardado(app, i) })
        })
        .collect()
}
```

- [ ] **Step 4: Add the writes and persistence**

Append:

```rust
#[derive(Debug)]
pub enum AplicarError {
    /// El valor pedido sale de fábrica y no venía `confirmado: true`. Lleva
    /// el motivo exacto — el mismo texto que enseñará el modal.
    FueraDeRango(String),
    Nvml(String),
    Curvas(String),
}

/// Aplica un perfil nuevo. Si algo sale de fábrica y `req.confirmado` es
/// `false`, no toca nada y devuelve el motivo — la ruta lo traduce a `409`.
pub async fn aplicar(
    app: &App,
    index: u32,
    req: &PatchHardwareReq,
) -> Result<HardwareDevice, AplicarError> {
    let existente = perfil_guardado(app, index);
    let nuevo = HardwareProfile {
        potencia_w: req.potencia_w.unwrap_or_else(|| existente.as_ref().map(|p| p.potencia_w).unwrap_or(0)),
        offset_nucleo_mhz: req
            .offset_nucleo_mhz
            .unwrap_or_else(|| existente.as_ref().map(|p| p.offset_nucleo_mhz).unwrap_or(0)),
        offset_memoria_mhz: req
            .offset_memoria_mhz
            .unwrap_or_else(|| existente.as_ref().map(|p| p.offset_memoria_mhz).unwrap_or(0)),
        curva_ventilador: req
            .curva_ventilador
            .clone()
            .unwrap_or_else(|| existente.as_ref().map(|p| p.curva_ventilador.clone()).unwrap_or_default()),
    };

    let nvml = Nvml::init().map_err(|e| AplicarError::Nvml(e.to_string()))?;
    let rango = rango_de(&nvml, index).ok_or_else(|| AplicarError::Nvml("no se pudo leer el rango de fábrica".into()))?;

    if !req.confirmado {
        if let Some(motivo) = fuera_de_rango(&nuevo, &rango) {
            return Err(AplicarError::FueraDeRango(motivo));
        }
    }

    if req.potencia_w.is_some() {
        let mut d = nvml.device_by_index(index).map_err(|e| AplicarError::Nvml(e.to_string()))?;
        d.set_power_management_limit(nuevo.potencia_w * 1000)
            .map_err(|e| AplicarError::Nvml(e.to_string()))?;
    }

    if req.offset_nucleo_mhz.is_some() || req.offset_memoria_mhz.is_some() || req.curva_ventilador.is_some() {
        aplicar_curvas(index, &nuevo).await.map_err(AplicarError::Curvas)?;
    }

    guardar_perfil(app, index, &nuevo).map_err(|e| AplicarError::Nvml(e.to_string()))?;

    let sample = muestra_de(&nvml, index).ok_or_else(|| AplicarError::Nvml("no se pudo releer la tarjeta".into()))?;
    let name = app.gpus.get(index as usize).map(|g| g.name.clone()).unwrap_or_default();
    Ok(HardwareDevice { index, name, sample, rango, perfil: Some(nuevo) })
}

async fn aplicar_curvas(index: u32, perfil: &HardwareProfile) -> Result<(), String> {
    let mut cmd = tokio::process::Command::new("nvidia-settings");
    cmd.arg("-a").arg(format!("[gpu:{index}]/GPUGraphicsClockOffset[3]={}", perfil.offset_nucleo_mhz));
    cmd.arg("-a").arg(format!("[gpu:{index}]/GPUMemoryTransferRateOffset[3]={}", perfil.offset_memoria_mhz));
    // La curva se aplica punto a punto: nvidia-settings no acepta una curva
    // entera de una vez, solo un target de ventilador instantáneo — el punto
    // más caliente de la curva es la aproximación más segura a "aplicado".
    if let Some(mas_caliente) = perfil.curva_ventilador.iter().max_by_key(|p| p.temp_c) {
        cmd.arg("-a").arg(format!("[fan:{index}]/GPUTargetFanSpeed={}", mas_caliente.valor));
    }
    let out = cmd.output().await.map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).to_string());
    }
    Ok(())
}

fn guardar_perfil(app: &App, index: u32, perfil: &HardwareProfile) -> rusqlite::Result<()> {
    let curva_json = serde_json::to_string(&perfil.curva_ventilador).unwrap_or_default();
    app.store.conn().execute(
        "INSERT INTO hardware_profiles (gpu_index, potencia_w, offset_nucleo_mhz, offset_memoria_mhz, curva_ventilador, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(gpu_index) DO UPDATE SET
           potencia_w = excluded.potencia_w,
           offset_nucleo_mhz = excluded.offset_nucleo_mhz,
           offset_memoria_mhz = excluded.offset_memoria_mhz,
           curva_ventilador = excluded.curva_ventilador,
           updated_at = excluded.updated_at",
        rusqlite::params![
            index,
            perfil.potencia_w,
            perfil.offset_nucleo_mhz,
            perfil.offset_memoria_mhz,
            curva_json,
            crate::routes::access::now(),
        ],
    )?;
    Ok(())
}

/// Se llama una vez al arrancar, después de detectar las GPUs. Un perfil
/// guardado para un índice que ya no existe (se quitó la tarjeta, o cambió
/// de índice) se queda huérfano en la tabla sin tocar ninguna otra — nunca
/// se reaplica "a lo que haya" en ese índice.
pub async fn reaplicar_al_arrancar(app: &App) {
    for i in 0..app.gpus.len() as u32 {
        let Some(perfil) = perfil_guardado(app, i) else { continue };
        let req = PatchHardwareReq {
            potencia_w: Some(perfil.potencia_w),
            offset_nucleo_mhz: Some(perfil.offset_nucleo_mhz),
            offset_memoria_mhz: Some(perfil.offset_memoria_mhz),
            curva_ventilador: Some(perfil.curva_ventilador),
            confirmado: true,
        };
        if let Err(e) = aplicar(app, i, &req).await {
            tracing::warn!("no se pudo reaplicar el perfil de hardware de la GPU {i}: {e:?}");
        }
    }
}
```

- [ ] **Step 5: Routes**

Create `crates/lumid/src/routes/hardware.rs`:

```rust
//! GET/PATCH de la sección Hardware. La lógica de rango/escritura vive en
//! `crate::hardware`; aquí solo se autentica y se traduce a HTTP.

use crate::routes::auth::{bearer, require_admin};
use crate::App;
use axum::extract::{Path, State};
use axum::{http::HeaderMap, http::StatusCode, Json};
use lumi_proto::api::{HardwareDevice, PatchHardwareReq};

pub async fn listar(State(app): State<App>, headers: HeaderMap) -> Result<Json<Vec<HardwareDevice>>, StatusCode> {
    require_admin(&app, &bearer(&headers))?;
    Ok(Json(crate::hardware::dispositivos(&app)))
}

pub async fn aplicar(
    State(app): State<App>,
    headers: HeaderMap,
    Path(index): Path<u32>,
    Json(req): Json<PatchHardwareReq>,
) -> Result<Json<HardwareDevice>, (StatusCode, String)> {
    require_admin(&app, &bearer(&headers)).map_err(|c| (c, "hace falta ser administrador".to_string()))?;
    match crate::hardware::aplicar(&app, index, &req).await {
        Ok(dev) => Ok(Json(dev)),
        Err(crate::hardware::AplicarError::FueraDeRango(motivo)) => Err((StatusCode::CONFLICT, motivo)),
        Err(crate::hardware::AplicarError::Nvml(e)) => Err((StatusCode::INTERNAL_SERVER_ERROR, e)),
        Err(crate::hardware::AplicarError::Curvas(e)) => Err((StatusCode::INTERNAL_SERVER_ERROR, e)),
    }
}
```

- [ ] **Step 6: Wire everything into `main.rs` and `hello.rs`**

In `crates/lumid/src/main.rs`, add `mod hardware;` next to the other `mod` declarations
(alphabetically, between `mod exif;` and `mod indices;`):

```rust
mod exif;
mod hardware;
mod indices;
```

Register the two routes — add these two lines to the `Router::new()` chain, right after the
`/v1/admin/resumen` line:

```rust
        .route("/v1/admin/hardware", get(routes::hardware::listar))
        .route("/v1/admin/hardware/:index", axum::routing::patch(routes::hardware::aplicar))
```

Spawn the startup reapplication right after `let app = App { ... };` finishes (after the
struct literal, before `let router = ...`):

```rust
    tokio::spawn({
        let app = app.clone();
        async move { hardware::reaplicar_al_arrancar(&app).await }
    });
```

Finish Task 1 Step 4's wiring in `crates/lumid/src/routes/hello.rs` — the call already
written there now compiles:

```rust
        capabilities: lumi_proto::caps::matrix(
            app.mode,
            app.gpus.len(),
            qdrant_vivo,
            &crate::hardware::capacidades().await,
        ),
```

- [ ] **Step 7: Extend telemetry's `GpuSample` construction**

In `crates/lumid/src/telemetry.rs`, the `sample()` function's GPU-building closure constructs
a `GpuSample` — add the two new fields there too, reusing the same `d` device handle:

```rust
                Some(GpuSample {
                    index: i,
                    util_pct: d.utilization_rates().map(|u| u.gpu).unwrap_or(0),
                    vram_used_mb: m.used / 1024 / 1024,
                    vram_total_mb: m.total / 1024 / 1024,
                    temp_c: d
                        .temperature(nvml_wrapper::enum_wrappers::device::TemperatureSensor::Gpu)
                        .ok(),
                    clock_mhz: d
                        .clock(
                            nvml_wrapper::enum_wrappers::device::Clock::Graphics,
                            nvml_wrapper::enum_wrappers::device::ClockId::Current,
                        )
                        .ok(),
                    fan_pct: d.fan_speed(0).ok(),
                })
```

- [ ] **Step 8: Build and test**

Run: `cargo build -p lumid`
Expected: builds clean.

Run: `cargo test -p lumid hardware::`
Expected: the 4 tests from Step 2 still pass.

Run: `cargo test -p lumi-proto`
Expected: passes (from Task 1).

- [ ] **Step 9: Commit**

```bash
git add crates/lumid/src/hardware.rs crates/lumid/src/routes/hardware.rs \
        crates/lumid/src/main.rs crates/lumid/src/routes/hello.rs crates/lumid/src/telemetry.rs
git commit -m "feat: lecturas/escrituras de GPU (potencia, offsets, curva), persistencia y reaplicación al arrancar"
```

---

### Task 4: Tipos y llamadas en el cliente

**Files:**
- Modify: `client/src/lib/api.ts`

**Interfaces:**
- Consumes: routes from Task 3 (`GET /v1/admin/hardware`, `PATCH /v1/admin/hardware/{index}`).
- Produces: TS types `PuntoCurva`, `RangoFabrica`, `HardwareDevice`, `HardwareProfile`,
  `PatchHardwareReq`, and `api.hardwareListar` / `api.hardwareAplicar`, consumed by Task 6/7.

- [ ] **Step 1: Extend `GpuSample` and add the new types**

In `client/src/lib/api.ts`, replace the existing `GpuSample` interface:

```ts
export interface GpuSample {
  index: number; util_pct: number; vram_used_mb: number; vram_total_mb: number;
  temp_c: number | null; clock_mhz: number | null; fan_pct: number | null;
}
```

Add, right after it:

```ts
export interface PuntoCurva { temp_c: number; valor: number }
export interface RangoFabrica { potencia_min_w: number; potencia_max_w: number; temp_throttle_c: number | null }
export interface HardwareProfile {
  potencia_w: number; offset_nucleo_mhz: number; offset_memoria_mhz: number;
  curva_ventilador: PuntoCurva[];
}
export interface HardwareDevice {
  index: number; name: string; sample: GpuSample; rango: RangoFabrica;
  perfil: HardwareProfile | null;
}
export interface PatchHardwareReq {
  potencia_w?: number; offset_nucleo_mhz?: number; offset_memoria_mhz?: number;
  curva_ventilador?: PuntoCurva[]; confirmado?: boolean;
}
```

- [ ] **Step 2: Add the two API methods**

In the `api` object at the end of the file, add:

```ts
  hardwareListar: (token: string) => api.get<HardwareDevice[]>("/v1/admin/hardware", token),
  hardwareAplicar: (index: number, req: PatchHardwareReq, token: string) =>
    api.patch<HardwareDevice>(`/v1/admin/hardware/${index}`, req, token),
```

- [ ] **Step 3: Typecheck**

Run: `cd client && npx tsc -b`
Expected: no errors (the `api` object references itself inside its own literal — check that
`hardwareListar`/`hardwareAplicar` use `api.get`/`api.patch` via the already-defined methods
above them in the same object, which works in TS since methods are looked up at call time, not
definition time — if `tsc` complains about referencing `api` before it's fully typed, fall
back to calling `call("GET", ...)`/`call("PATCH", ...)` directly the same way `get`/`patch`
themselves do).

- [ ] **Step 4: Commit**

```bash
git add client/src/lib/api.ts
git commit -m "feat: tipos y llamadas de Hardware en el cliente"
```

---

### Task 5: Icono de dispositivo GPU

**Files:**
- Modify: `client/src/ui/Icon.tsx`

**Interfaces:**
- Produces: `Icon name="gpu"` — used by Task 6.

- [ ] **Step 1: Add the hand-drawn GPU icon**

In `client/src/ui/Icon.tsx`, add to the `PATHS` map (same style as the existing `device`
entry — `viewBox 0 0 24 24`, drawn to fill it):

```tsx
  gpu: (
    <>
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <circle cx="8" cy="12" r="2.6" />
      <circle cx="16" cy="12" r="2.6" />
      <path d="M0 9v2M0 14v2M24 9v2M24 14v2" />
    </>
  ),
```

Check the `IconName` type (derived from `keyof typeof PATHS` or an explicit union near the
top of the file) picks up `"gpu"` automatically — if it's an explicit union type instead of
derived from `PATHS`, add `"gpu"` to it by hand.

- [ ] **Step 2: Typecheck**

Run: `cd client && npx tsc -b`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add client/src/ui/Icon.tsx
git commit -m "feat: icono de GPU dibujado a mano"
```

---

### Task 6: Curva editable reutilizable (arrastre por puntos)

**Files:**
- Create: `client/src/admin/CurvaEditable.tsx`

**Interfaces:**
- Consumes: nothing beyond React.
- Produces: `<CurvaEditable puntos={PuntoCurva[]} onChange={(p: PuntoCurva[]) => void}
  ejeXMin={number} ejeXMax={number} ejeYMin={number} ejeYMax={number}
  zonaPeligroDesde={number | null} etiquetaEjeX={string} etiquetaEjeY={string}
  formatoPunto={(p: PuntoCurva) => string} />`, consumed by Task 7's `HardwareEditor`.

- [ ] **Step 1: Write the component**

Create `client/src/admin/CurvaEditable.tsx`. This is the drag-by-point coordinate editor from
the approved mockup (`.superpowers/brainstorm/859-1786959357/content/edit-modal-v2.html`,
`#curveSvg` + its pointer handlers) ported to React — same math, state-driven instead of
direct DOM mutation:

```tsx
import { useRef, useState } from "react";
import type { PuntoCurva } from "../lib/api";

const W = 420, H = 190, PAD_L = 34, PAD_R = 16, PAD_T = 10;

export function CurvaEditable({
  puntos, onChange, ejeXMin, ejeXMax, ejeYMin, ejeYMax, zonaPeligroDesde, formatoPunto,
}: {
  puntos: PuntoCurva[];
  onChange: (p: PuntoCurva[]) => void;
  ejeXMin: number; ejeXMax: number; ejeYMin: number; ejeYMax: number;
  zonaPeligroDesde: number | null;
  formatoPunto: (p: PuntoCurva) => string;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [arrastrando, setArrastrando] = useState<number | null>(null);
  const [seleccionado, setSeleccionado] = useState(0);

  const xADistancia = (temp: number) =>
    PAD_L + ((temp - ejeXMin) / (ejeXMax - ejeXMin)) * (W - PAD_L - PAD_R);
  const yADistancia = (valor: number) =>
    PAD_T + (1 - (valor - ejeYMin) / (ejeYMax - ejeYMin)) * (H - PAD_T - 20);
  const distanciaATemp = (x: number) => Math.round(ejeXMin + ((x - PAD_L) / (W - PAD_L - PAD_R)) * (ejeXMax - ejeXMin));
  const distanciaAValor = (y: number) => Math.round(ejeYMin + (1 - (y - PAD_T) / (H - PAD_T - 20)) * (ejeYMax - ejeYMin));

  const coords = puntos.map((p) => [xADistancia(p.temp_c), yADistancia(p.valor)] as const);
  const linea = "M " + coords.map(([x, y]) => `${x},${y}`).join(" L ");
  const relleno = `${linea} L ${coords[coords.length - 1]?.[0] ?? W - PAD_R},${H - 20} L ${PAD_L},${H - 20} Z`;

  function mover(e: React.PointerEvent) {
    if (arrastrando === null || !svgRef.current) return;
    const r = svgRef.current.getBoundingClientRect();
    const x = Math.max(PAD_L, Math.min(W - PAD_R, (e.clientX - r.left) * (W / r.width)));
    const y = Math.max(PAD_T, Math.min(H - 20, (e.clientY - r.top) * (H / r.height)));
    const nuevo = puntos.slice();
    nuevo[arrastrando] = { temp_c: distanciaATemp(x), valor: distanciaAValor(y) };
    onChange(nuevo);
  }

  const puntoActivo = puntos[seleccionado];
  const xPeligro = zonaPeligroDesde !== null ? xADistancia(zonaPeligroDesde) : null;

  return (
    <div>
      {puntoActivo && (
        <div className="mb-1.5 flex justify-between text-[9px] text-subtle">
          <span>arrastra un punto</span>
          <span className="font-mono">{formatoPunto(puntoActivo)}</span>
        </div>
      )}
      <svg
        ref={svgRef} width="100%" height={H} viewBox={`0 0 ${W} ${H}`}
        style={{ overflow: "visible", touchAction: "none" }}
        onPointerMove={mover}
        onPointerUp={() => setArrastrando(null)}
      >
        <line x1={PAD_L} y1={PAD_T} x2={PAD_L} y2={H - 20} stroke="#1c1e21" />
        <line x1={PAD_L} y1={H - 20} x2={W - PAD_R} y2={H - 20} stroke="#1c1e21" />
        {xPeligro !== null && (
          <>
            <rect x={xPeligro} y={PAD_T} width={W - PAD_R - xPeligro} height={H - 20 - PAD_T} fill="rgba(163,51,51,.06)" />
            <line x1={xPeligro} y1={PAD_T} x2={xPeligro} y2={H - 20} stroke="rgba(232,143,143,.28)" strokeDasharray="3 3" />
          </>
        )}
        <path d={relleno} fill="rgba(255,255,255,.035)" />
        <path d={linea} fill="none" stroke="#c9c9c6" strokeWidth={1.8} />
        {coords.map(([x, y], i) => (
          <circle
            key={i} cx={x} cy={y} r={i === seleccionado ? 6.5 : 5}
            fill={i === seleccionado ? "#e8e8e6" : "#0e0f11"}
            stroke={i === seleccionado ? "#e8e8e6" : "#8a8a86"} strokeWidth={1.8}
            style={{ cursor: "grab" }}
            onPointerDown={(e) => {
              setSeleccionado(i); setArrastrando(i);
              (e.target as Element).setPointerCapture(e.pointerId);
            }}
          />
        ))}
      </svg>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `cd client && npx tsc -b`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add client/src/admin/CurvaEditable.tsx
git commit -m "feat: componente de curva editable por puntos, reutilizable entre ventilador y reloj"
```

---

### Task 7: Modal de confirmación de peligro

**Files:**
- Create: `client/src/admin/ConfirmarPeligro.tsx`

**Interfaces:**
- Produces: `<ConfirmarPeligro motivo={string} onCancelar={() => void} onConfirmar={() =>
  void} />`, consumed by Task 8.

- [ ] **Step 1: Write the component**

Port of the approved mockup's confirm popup
(`.superpowers/brainstorm/859-1786959357/content/confirm-modal-v2.html`) — big centered
warning icon, text field that must read exactly "soy consciente" before the confirm button
enables:

```tsx
import { useState } from "react";

export function ConfirmarPeligro({
  motivo, onCancelar, onConfirmar,
}: { motivo: string; onCancelar: () => void; onConfirmar: () => void }) {
  const [texto, setTexto] = useState("");
  const ok = texto.trim().toLowerCase() === "soy consciente";

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70"
      style={{ animation: "jg-backdrop-in .28s ease both" }}>
      <div className="w-[300px] rounded-card border border-border bg-panel p-5 text-center"
        style={{ animation: "jg-popup-scale-in .3s cubic-bezier(.16,1,.3,1) both" }}>
        <div className="mx-auto mb-3 grid h-[52px] w-[52px] place-items-center rounded-full
          border border-danger/40 bg-danger/10">
          <span className="text-[26px] text-danger-fg">⚠</span>
        </div>
        <p className="text-[13px] font-medium text-fg">Vas a superar el límite de fábrica</p>
        <p className="mt-1.5 text-[10.5px] leading-relaxed text-muted">{motivo}</p>
        <p className="mt-3.5 text-left text-[10px] text-subtle">
          Escribe <b className="font-mono text-fg">soy consciente</b> para aplicar de todas formas
        </p>
        <input
          value={texto} onChange={(e) => setTexto(e.target.value)}
          placeholder="soy consciente"
          className="mt-1.5 w-full rounded-lg border border-border bg-bg px-2.5 py-2 text-[11.5px] text-fg"
        />
        <div className="mt-3 flex justify-center gap-2">
          <button onClick={onCancelar} className="jg-press rounded-lg px-3.5 py-1.5 text-[10.5px] text-subtle">
            Cancelar
          </button>
          <button
            onClick={onConfirmar} disabled={!ok}
            className="jg-press rounded-lg border border-danger/40 bg-danger/20 px-3.5 py-1.5
              text-[11px] text-danger-fg disabled:opacity-50"
          >
            Aplicar de todas formas
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `cd client && npx tsc -b`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add client/src/admin/ConfirmarPeligro.tsx
git commit -m "feat: modal de confirmacion 'soy consciente' para valores fuera de fabrica"
```

---

### Task 8: Editor modal de un dispositivo (pestañas Potencia/Ventilador/Reloj/Sensores)

**Files:**
- Create: `client/src/admin/HardwareEditor.tsx`

**Interfaces:**
- Consumes: `CurvaEditable` (Task 6), `ConfirmarPeligro` (Task 7), `api.hardwareAplicar`
  (Task 4).
- Produces: `<HardwareEditor device={HardwareDevice} token={string} onCerrar={() => void}
  onAplicado={(d: HardwareDevice) => void} curvasHabilitadas={boolean}
  curvasMotivo={string | null} />`, consumed by Task 9.

- [ ] **Step 1: Write the component**

Port of `.superpowers/brainstorm/859-1786959357/content/edit-modal-v2.html` — same four tabs,
same footer. State lives in React instead of the mockup's manual DOM/table sync:

```tsx
import { useState } from "react";
import { api, type HardwareDevice, type PuntoCurva } from "../lib/api";
import { CurvaEditable } from "./CurvaEditable";
import { ConfirmarPeligro } from "./ConfirmarPeligro";
import { Icon } from "../ui/Icon";

type Pestana = "potencia" | "ventilador" | "reloj" | "sensores";

export function HardwareEditor({
  device, token, onCerrar, onAplicado, curvasHabilitadas, curvasMotivo,
}: {
  device: HardwareDevice; token: string; onCerrar: () => void;
  onAplicado: (d: HardwareDevice) => void;
  curvasHabilitadas: boolean; curvasMotivo: string | null;
}) {
  const [pestana, setPestana] = useState<Pestana>("ventilador");
  const perfil = device.perfil ?? {
    potencia_w: device.rango.potencia_max_w,
    offset_nucleo_mhz: 0,
    offset_memoria_mhz: 0,
    curva_ventilador: [
      { temp_c: 30, valor: 30 }, { temp_c: 50, valor: 45 }, { temp_c: 65, valor: 60 },
      { temp_c: 75, valor: 75 }, { temp_c: 85, valor: 90 }, { temp_c: 95, valor: 100 },
    ] as PuntoCurva[],
  };
  const [potenciaW, setPotenciaW] = useState(perfil.potencia_w);
  const [curvaVentilador, setCurvaVentilador] = useState(perfil.curva_ventilador);
  const [offsetNucleo, setOffsetNucleo] = useState(perfil.offset_nucleo_mhz);
  const [offsetMemoria, setOffsetMemoria] = useState(perfil.offset_memoria_mhz);
  const [confirmando, setConfirmando] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function aplicar(confirmado: boolean) {
    setError(null);
    try {
      const dev = await api.hardwareAplicar(device.index, {
        potencia_w: potenciaW,
        // Si `hardware_curvas` está `off`, ni siquiera se mandan estos tres
        // campos — mandarlos igual haría que el backend intentara el
        // subproceso `nvidia-settings` sabiendo ya que va a fallar, y el
        // usuario vería un error de "no se pudo" en vez de que el control
        // simplemente no exista para él.
        ...(curvasHabilitadas ? {
          offset_nucleo_mhz: offsetNucleo,
          offset_memoria_mhz: offsetMemoria,
          curva_ventilador: curvaVentilador,
        } : {}),
        confirmado,
      }, token);
      setConfirmando(null);
      onAplicado(dev);
      onCerrar();
    } catch (e) {
      const msg = String(e);
      // El backend responde 409 con el motivo en el cuerpo cuando hace falta
      // confirmación — `api.patch` propaga el texto de error tal cual.
      if (!confirmado) { setConfirmando(msg); return; }
      setError(msg);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div className="w-[860px] max-w-[94vw] overflow-hidden rounded-card border border-border bg-panel"
        style={{ animation: "jg-popup-scale-in .3s cubic-bezier(.16,1,.3,1) both" }}>

        <div className="flex items-center gap-3 border-b border-border px-5 py-4">
          <Icon name="gpu" size={26} className="text-subtle" />
          <div className="flex-1">
            <div className="text-[14px] text-fg">{device.name} · GPU {device.index}</div>
            <div className="text-[9.5px] text-subtle">editando perfil avanzado</div>
          </div>
          <button onClick={onCerrar} className="jg-press rounded-lg px-2 py-1 text-subtle">✕</button>
        </div>

        <div className="flex gap-6 border-b border-border px-5">
          {(["potencia", "ventilador", "reloj", "sensores"] as Pestana[]).map((p) => (
            <button key={p} onClick={() => setPestana(p)}
              className={`border-b-2 py-2.5 text-[11px] capitalize transition-colors
                ${pestana === p ? "border-fg text-fg" : "border-transparent text-subtle hover:text-muted"}`}>
              {p}
            </button>
          ))}
        </div>

        <div className="flex min-h-[330px]">
          {pestana === "potencia" && (
            <div className="flex-1 p-5">
              <div className="mb-1.5 text-[9px] uppercase tracking-[.08em] text-subtle">límite de potencia</div>
              <input type="range" min={device.rango.potencia_min_w} max={device.rango.potencia_max_w * 1.2}
                value={potenciaW} onChange={(e) => setPotenciaW(+e.target.value)} className="w-full accent-fg" />
              <div className="flex justify-between font-mono text-[9px] text-subtle">
                <span>{device.rango.potencia_min_w}W</span>
                <span className="text-fg">{potenciaW}W</span>
                <span>{device.rango.potencia_max_w}W fábrica</span>
              </div>
            </div>
          )}

          {pestana === "ventilador" && (
            curvasHabilitadas ? (
              <div className="flex-1 p-5">
                <CurvaEditable
                  puntos={curvaVentilador} onChange={setCurvaVentilador}
                  ejeXMin={30} ejeXMax={100} ejeYMin={0} ejeYMax={100}
                  zonaPeligroDesde={device.rango.temp_throttle_c}
                  formatoPunto={(p) => `${p.temp_c}° → ${p.valor}%`}
                />
              </div>
            ) : (
              <p className="flex-1 p-5 text-[11px] text-muted">{curvasMotivo}</p>
            )
          )}

          {pestana === "reloj" && (
            curvasHabilitadas ? (
              <div className="flex-1 p-5">
                <div className="mb-3">
                  <div className="mb-1 text-[9px] uppercase tracking-[.08em] text-subtle">offset núcleo</div>
                  <input type="range" min={-100} max={200} value={offsetNucleo}
                    onChange={(e) => setOffsetNucleo(+e.target.value)} className="w-full accent-fg" />
                  <span className="font-mono text-[10px] text-muted">{offsetNucleo} MHz</span>
                </div>
                <div>
                  <div className="mb-1 text-[9px] uppercase tracking-[.08em] text-subtle">offset memoria</div>
                  <input type="range" min={-200} max={800} value={offsetMemoria}
                    onChange={(e) => setOffsetMemoria(+e.target.value)} className="w-full accent-draw" />
                  <span className="font-mono text-[10px] text-muted">{offsetMemoria} MHz</span>
                </div>
              </div>
            ) : (
              <p className="flex-1 p-5 text-[11px] text-muted">{curvasMotivo}</p>
            )
          )}

          {pestana === "sensores" && (
            <div className="flex-1 p-5">
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="text-left text-[8.5px] uppercase tracking-[.06em] text-subtle">
                    <th className="pb-1.5">sensor</th><th className="pb-1.5">valor</th><th className="pb-1.5">rango de fábrica</th>
                  </tr>
                </thead>
                <tbody className="font-mono">
                  <tr><td className="py-1 text-fg">temperatura</td><td>{device.sample.temp_c ?? "—"}°C</td>
                    <td className="text-subtle">hasta {device.rango.temp_throttle_c ?? "—"}°</td></tr>
                  <tr><td className="py-1 text-fg">potencia</td><td>{potenciaW}W</td>
                    <td className="text-subtle">{device.rango.potencia_min_w}–{device.rango.potencia_max_w}W</td></tr>
                  <tr><td className="py-1 text-fg">ventilador</td><td>{device.sample.fan_pct ?? "—"}%</td><td className="text-subtle">0–100%</td></tr>
                  <tr><td className="py-1 text-fg">reloj</td><td>{device.sample.clock_mhz ?? "—"} MHz</td><td className="text-subtle">—</td></tr>
                </tbody>
              </table>
            </div>
          )}
        </div>

        {error && <p className="px-5 pb-2 text-[10.5px] text-danger-fg">{error}</p>}
        <div className="flex items-center justify-between border-t border-border bg-bg px-5 py-3.5">
          <span className="text-[9.5px] text-subtle">
            los cambios se aplican al pulsar «Aplicar» · un valor fuera de fábrica pedirá confirmación
          </span>
          <div className="flex gap-2">
            <button onClick={onCerrar} className="jg-press rounded-lg border border-border px-3.5 py-1.5 text-[11px] text-subtle">
              Cancelar
            </button>
            <button onClick={() => aplicar(false)} className="jg-press rounded-lg bg-accent px-3.5 py-1.5 text-[11px] font-medium text-black">
              Aplicar cambios
            </button>
          </div>
        </div>
      </div>

      {confirmando && (
        <ConfirmarPeligro
          motivo={confirmando}
          onCancelar={() => setConfirmando(null)}
          onConfirmar={() => aplicar(true)}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `cd client && npx tsc -b`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add client/src/admin/HardwareEditor.tsx
git commit -m "feat: editor modal de Hardware con pestañas Potencia/Ventilador/Reloj/Sensores"
```

---

### Task 9: Vista principal, interruptor básico/avanzado, y alta en el panel

**Files:**
- Create: `client/src/admin/HardwareView.tsx`
- Modify: `client/src/admin/Sidebar.tsx`
- Modify: `client/src/admin/Hueco.tsx`
- Modify: `client/src/admin/AdminPanel.tsx`

**Interfaces:**
- Consumes: `HardwareEditor` (Task 8), `api.hardwareListar` (Task 4), `useServer` (existing
  zustand store, for `capabilities` and the live telemetry `sample`).
- Produces: the "Hardware" sidebar entry stops being `pronto`.

- [ ] **Step 1: Write `HardwareView`**

Port of `.superpowers/brainstorm/859-1786959357/content/full-screen-v2.html`'s row list (not
its sidebar — the real one already exists in `Sidebar.tsx`) into
`client/src/admin/HardwareView.tsx`:

```tsx
import { useEffect, useState } from "react";
import { api, type HardwareDevice } from "../lib/api";
import { useServer } from "../lib/store";
import { HardwareEditor } from "./HardwareEditor";
import { Icon } from "../ui/Icon";

export function HardwareView({ token }: { token: string }) {
  const [dispositivos, setDispositivos] = useState<HardwareDevice[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [avanzado, setAvanzado] = useState(false);
  const [editando, setEditando] = useState<number | null>(null);
  const capPotencia = useServer((s) => s.hello?.capabilities.find((c) => c.id === "hardware_potencia"));
  const capCurvas = useServer((s) => s.hello?.capabilities.find((c) => c.id === "hardware_curvas"));

  useEffect(() => {
    api.hardwareListar(token).then(setDispositivos).catch((e) => setError(String(e)));
  }, [token]);

  // Básico: el slider de potencia se aplica directo desde la fila, acotado al
  // rango de fábrica — nunca puede salir de rango, así que nunca dispara la
  // confirmación de "soy consciente" (esa solo existe en avanzado).
  async function aplicarBasico(index: number, potencia_w: number) {
    const dev = await api.hardwareAplicar(index, { potencia_w, confirmado: false }, token);
    setDispositivos((prev) => prev!.map((x) => (x.index === dev.index ? dev : x)));
  }

  if (error) return <p className="px-6 pt-5 text-[11px] text-danger-fg">{error}</p>;
  if (!dispositivos) return <p className="px-6 pt-5 text-[11px] text-subtle">cargando</p>;

  return (
    <div className="px-6 pb-8 pt-5">
      <div className="flex items-end justify-between border-b border-border pb-[11px]">
        <h2 className="text-[21px] font-medium tracking-[-.025em]">Hardware</h2>
        <div className="relative flex w-[126px] rounded-lg border border-border bg-surface p-[3px]">
          <span className="absolute left-[3px] top-[3px] h-[calc(100%-6px)] w-[60px] rounded-md bg-elevated
            transition-transform duration-[420ms] ease-expo"
            style={{ transform: avanzado ? "translateX(60px)" : "translateX(0)" }} />
          {(["Básico", "Avanzado"] as const).map((l, i) => (
            <button key={l} onClick={() => setAvanzado(i === 1)}
              className={`relative z-10 flex-1 py-[5px] text-[10px] transition-colors
                ${(i === 1) === avanzado ? "text-fg" : "text-subtle"}`}>
              {l}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-3 space-y-2.5">
        {dispositivos.map((d) => (
          <div key={d.index}
            onClick={() => avanzado && capCurvas?.state !== "off" && setEditando(d.index)}
            className={`rounded-[14px] border border-border/70 bg-panel p-[18px_20px]
              transition-colors ${avanzado ? "cursor-pointer hover:border-border" : ""}`}>
            <div className="flex items-center gap-6">
              <Icon name="gpu" size={44} className="shrink-0 text-subtle" />
              <div className="w-[150px] shrink-0">
                <div className="text-[13.5px] text-fg">{d.name}</div>
                <div className="mt-0.5 font-mono text-[9.5px] text-subtle">GPU {d.index}</div>
              </div>
              <div className="relative h-16 w-16 shrink-0">
                <svg viewBox="0 0 64 64" className="absolute inset-0">
                  <circle cx="32" cy="32" r="27" fill="none" stroke="#1a1c1f" strokeWidth={4} />
                  <circle cx="32" cy="32" r="27" fill="none" strokeWidth={4} strokeLinecap="round"
                    stroke={d.perfil && d.perfil.potencia_w > d.rango.potencia_max_w ? "#e88f8f" : "#e8e8e6"}
                    strokeDasharray={`${((d.sample.temp_c ?? 0) / 100) * 170} 170`}
                    transform="rotate(-90 32 32)" />
                </svg>
                <span className="absolute inset-0 flex items-center justify-center font-mono text-[14px]">
                  {d.sample.temp_c ?? "—"}°
                </span>
              </div>
              <div className="flex flex-1 gap-6">
                <Stat v={`${d.perfil?.potencia_w ?? "—"}`} u="W" l="potencia"
                  alerta={!!d.perfil && d.perfil.potencia_w > d.rango.potencia_max_w} />
                <Stat v={`${d.sample.clock_mhz ?? "—"}`} u="MHz" l="reloj" />
                <Stat v={`${d.sample.fan_pct ?? "—"}`} u="%" l="ventilador" />
              </div>
              {d.perfil && d.perfil.potencia_w > d.rango.potencia_max_w && (
                <span className="rounded-full border border-danger/40 bg-danger/10 px-2.5 py-[3px] text-[9px] text-danger-fg">
                  ⚠ sobre fábrica
                </span>
              )}
            </div>

            {!avanzado && capPotencia?.state !== "off" && (
              <div className="mt-3 border-t border-border/60 pt-3" onClick={(e) => e.stopPropagation()}>
                <input
                  type="range" min={d.rango.potencia_min_w} max={d.rango.potencia_max_w}
                  defaultValue={d.perfil?.potencia_w ?? d.rango.potencia_max_w}
                  onPointerUp={(e) => aplicarBasico(d.index, +(e.target as HTMLInputElement).value)}
                  className="w-full accent-fg"
                />
                <div className="flex justify-between font-mono text-[9px] text-subtle">
                  <span>{d.rango.potencia_min_w}W</span><span>{d.rango.potencia_max_w}W</span>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {editando !== null && (() => {
        const d = dispositivos.find((x) => x.index === editando)!;
        return (
          <HardwareEditor
            device={d} token={token} onCerrar={() => setEditando(null)}
            onAplicado={(nuevo) => setDispositivos((prev) => prev!.map((x) => (x.index === nuevo.index ? nuevo : x)))}
            curvasHabilitadas={capCurvas?.state !== "off"}
            curvasMotivo={capCurvas?.reason ?? null}
          />
        );
      })()}

      {(capPotencia?.state === "off" || capCurvas?.state === "off") && (
        <p className="mt-4 text-[10.5px] leading-relaxed text-subtle">
          {capPotencia?.state === "off" && <>Potencia: {capPotencia.reason} </>}
          {capCurvas?.state === "off" && <>Curvas: {capCurvas.reason}</>}
        </p>
      )}
    </div>
  );
}

function Stat({ v, u, l, alerta }: { v: string; u: string; l: string; alerta?: boolean }) {
  return (
    <div>
      <div className={`font-mono text-[16px] ${alerta ? "text-danger-fg" : "text-fg"}`}>
        {v}<small className="ml-0.5 text-[9.5px] text-subtle">{u}</small>
      </div>
      <div className="text-[8px] uppercase tracking-[.07em] text-subtle">{l}</div>
    </div>
  );
}
```

- [ ] **Step 2: Remove the "pronto" placeholder**

In `client/src/admin/Sidebar.tsx`, find the `"Operación"` group's `hardware` entry:

```tsx
      { id: "hardware", label: "Hardware", icon: "device", pronto: true },
```

Change it to:

```tsx
      { id: "hardware", label: "Hardware", icon: "gpu" },
```

In `client/src/admin/Hueco.tsx`, remove the `hardware` entry from the `QUE` record (it no
longer needs a placeholder screen):

```tsx
const QUE: Record<string, { titulo: string; grupo: string; ciclo: string; que: string }> = {
};
```

If `QUE` becomes empty and this makes `Hueco.tsx` pointless (no other placeholder currently
uses it — check with `grep -r "Hueco" client/src` first), leave the file as-is with an empty
record rather than deleting it: other "pronto" sections may be added later and this is the
established pattern for them.

- [ ] **Step 3: Wire `HardwareView` into `AdminPanel`**

In `client/src/admin/AdminPanel.tsx`:

Add the import near the other view imports:

```tsx
import { HardwareView } from "./HardwareView";
```

Change the `PRONTO` constant — remove `"hardware"`:

```tsx
const PRONTO: Seccion[] = [];
```

Add a render branch for `"hardware"` in the big ternary chain — insert it right before the
final `:` catch-all (índices) branch:

```tsx
          : seccion === "hardware" ? <HardwareView token={token} />
```

- [ ] **Step 4: Typecheck and lint**

Run: `cd client && npx tsc -b`
Expected: no errors.

Run: `cd client && npx oxlint`
Expected: no new warnings on the files touched in this task.

- [ ] **Step 5: Commit**

```bash
git add client/src/admin/HardwareView.tsx client/src/admin/Sidebar.tsx \
        client/src/admin/Hueco.tsx client/src/admin/AdminPanel.tsx
git commit -m "feat: pantalla principal de Hardware, interruptor basico/avanzado, y alta en el panel"
```

---

### Task 10: Anotar lo que queda fuera en FUTURO.md

**Files:**
- Modify: `FUTURO.md`

- [ ] **Step 1: Add the deferred items**

Add a new subsection under the existing Lumi Station section of `FUTURO.md` (check the file's
current heading structure first with `grep -n "^##" FUTURO.md` and place it alongside similar
per-subsystem entries):

```markdown
### Hardware: CPU (temperatura por núcleo, PPT/PBO)

La sección Hardware de esta entrega cubre solo GPU. CPU necesita su propia spec: lectura por
núcleo físico (Linux expone esto vía `coretemp`/`k10temp`, no NVML) y su propio control de
potencia (PL1/PL2 en Intel, PPT/PBO en AMD) — mecanismos completamente distintos a los de GPU,
con su propia matriz de capacidades.

### Hardware: comprobación de firmware de ventilador antes de escribir

El control de curva de ventilador se intenta siempre que `nvidia-settings` responde
(`hardware_curvas` en `On`), pero algunas tarjetas de diseño de referencia o blower rechazan
la escritura a nivel de firmware aunque el software la permita. Hoy ese rechazo se propaga tal
cual venga de `nvidia-settings`; sería mejor detectarlo por adelantado y anunciarlo en la
capacidad en vez de que el usuario lo descubra al intentar aplicar un cambio.
```

- [ ] **Step 2: Commit**

```bash
git add FUTURO.md
git commit -m "docs: anota CPU y comprobacion de firmware de ventilador como fuera de esta entrega"
```
