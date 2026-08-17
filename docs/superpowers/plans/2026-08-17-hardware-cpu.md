# Hardware (CPU) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add CPU monitoring (temperature per core, usage per core) and power-limit control
(Intel RAPL PL1/PL2, AMD PPT via `ryzenadj`) as a new row in the existing Hardware admin
screen, per `docs/superpowers/specs/2026-08-17-hardware-cpu-design.md`.

**Architecture:** CPU gets its own backend module (`hardware_cpu.rs`), its own routes, its own
SQLite table, and its own small `CpuEditor` modal — deliberately **not** shoehorned into the
existing GPU `HardwareEditor`/`CurvaEditable`, which are built around curve-editing concepts
(fan curve, clock offset) that don't apply to CPU at all. The GPU components stay untouched.
`HardwareView` gains one more row after the GPU rows, following the exact same visual pattern
already approved (`.superpowers/brainstorm/859-1786959357/content/full-screen-v2.html`'s CPU
row — the heat-map grid of per-core temperature).

**Tech Stack:** Rust (axum, rusqlite, `sysinfo` — already a dependency, `tokio::process::Command`
for `ryzenadj`, plain `std::fs` reads for `hwmon`/`/proc/cpuinfo`/RAPL sysfs), React + TypeScript
+ Tailwind (client/).

## Global Constraints

- No tests unless explicitly requested, except non-trivial pure logic in `lumid`
  (`cargo test -p lumid`), matching the project's convention and the pattern already
  established for GPU's `fuera_de_rango`.
- One commit per finished task.
- Dark theme only, mono font for machine-produced numbers, hand-drawn SVG icons only
  (`viewBox 0 0 24 24`, `stroke="currentColor"`, `strokeWidth={1.8}`).
- Every capability that isn't `On` must carry a non-empty `reason` — enforced by the existing
  `caps.rs` test (`todo_recorte_lleva_motivo`); keep it passing.
- **WSL2 exposes NONE of this** — verified empirically this session: `/sys/class/hwmon/` and
  `/sys/class/powercap/` are both completely empty under WSL2. All three CPU capabilities will
  correctly show `off` there. Do not treat an empty result under WSL2 as a bug while testing.
- `ryzenadj`'s exact CLI output format varies by version and is not a stable, documented API —
  the parsing code in this plan is best-effort (`.ok()`-tolerant, same pattern as the rest of
  hardware detection in this project) and may need adjusting against whatever version is
  actually installed on a real AMD box. This is expected and matches the spec's own framing of
  `ryzenadj` as the highest-risk, least-guaranteed control in the whole Hardware section.

---

### Task 1: Tipos compartidos y capacidades de CPU

**Files:**
- Modify: `crates/lumi-proto/src/api.rs`
- Modify: `crates/lumi-proto/src/caps.rs`
- Modify: `crates/lumid/src/routes/hello.rs`

**Interfaces:**
- Produces: `CpuCoreSample { indice: u32, temp_c: Option<i32>, uso_pct: f32 }`,
  `CpuSample { nucleos: Vec<CpuCoreSample>, potencia_w: Option<f32> }`, `CpuRango {
  potencia_min_w: f32, potencia_max_w: f32, aproximado: bool }`, `CpuProfile { pl1_w: f32,
  pl2_w: f32 }`, `CpuDevice { fabricante: String, sample: CpuSample, rango: CpuRango, perfil:
  Option<CpuProfile> }`, `PatchCpuReq { pl1_w: Option<f32>, pl2_w: Option<f32>, #[serde(default)]
  confirmado: bool }` — all `pub` in `lumi_proto::api`, consumed by Task 3 (lumid) and Task 5
  (client types).
- Produces: `HardwareCaps` gains `cpu_potencia_intel: CapState`, `cpu_potencia_intel_reason:
  Option<String>`, `cpu_potencia_amd: CapState`, `cpu_potencia_amd_reason: Option<String>`,
  `cpu_temperatura: CapState`, `cpu_temperatura_reason: Option<String>`. `matrix()` gains three
  more `Capability` entries in both `Mode` arms: `"cpu_potencia_intel"`, `"cpu_potencia_amd"`,
  `"cpu_temperatura"`.

- [ ] **Step 1: Add the CPU types**

In `crates/lumi-proto/src/api.rs`, append at the end of the file:

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CpuCoreSample {
    pub indice: u32,
    /// `None` si no hay sensor `hwmon` para este host (WSL2, siempre).
    pub temp_c: Option<i32>,
    pub uso_pct: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CpuSample {
    pub nucleos: Vec<CpuCoreSample>,
    /// Consumo real actual. `None` si no hay RAPL (WSL2) ni `ryzenadj` legible.
    pub potencia_w: Option<f32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CpuRango {
    pub potencia_min_w: f32,
    pub potencia_max_w: f32,
    /// `true` en AMD: no hay rango de fábrica leído del hardware, es una
    /// aproximación (50–100% del TDP declarado) — la interfaz lo anuncia
    /// como tal, no lo hace pasar por un dato real como en Intel.
    pub aproximado: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CpuProfile {
    /// PL1 en Intel (sostenido); STAPM/slow-limit en AMD. Mismo campo, otra
    /// semántica según fabricante — no hay dos CPUs a la vez, no hace falta
    /// distinguir en el esquema.
    pub pl1_w: f32,
    /// PL2 en Intel (boost); fast-limit en AMD.
    pub pl2_w: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CpuDevice {
    /// `"intel"` | `"amd"` | `"otro"`.
    pub fabricante: String,
    pub sample: CpuSample,
    pub rango: CpuRango,
    pub perfil: Option<CpuProfile>,
}

#[derive(Debug, Deserialize)]
pub struct PatchCpuReq {
    pub pl1_w: Option<f32>,
    pub pl2_w: Option<f32>,
    #[serde(default)]
    pub confirmado: bool,
}
```

- [ ] **Step 2: Extend `HardwareCaps` and `matrix()`**

In `crates/lumi-proto/src/caps.rs`, replace the `HardwareCaps` struct and its `Default` impl:

```rust
#[derive(Debug, Clone)]
pub struct HardwareCaps {
    pub potencia: CapState,
    pub potencia_reason: Option<String>,
    pub curvas: CapState,
    pub curvas_reason: Option<String>,
    pub cpu_potencia_intel: CapState,
    pub cpu_potencia_intel_reason: Option<String>,
    pub cpu_potencia_amd: CapState,
    pub cpu_potencia_amd_reason: Option<String>,
    pub cpu_temperatura: CapState,
    pub cpu_temperatura_reason: Option<String>,
}

impl Default for HardwareCaps {
    fn default() -> Self {
        Self {
            potencia: CapState::Off,
            potencia_reason: Some("todavía no comprobado".into()),
            curvas: CapState::Off,
            curvas_reason: Some("todavía no comprobado".into()),
            cpu_potencia_intel: CapState::Off,
            cpu_potencia_intel_reason: Some("todavía no comprobado".into()),
            cpu_potencia_amd: CapState::Off,
            cpu_potencia_amd_reason: Some("todavía no comprobado".into()),
            cpu_temperatura: CapState::Off,
            cpu_temperatura_reason: Some("todavía no comprobado".into()),
        }
    }
}
```

In `matrix()`, right after the `hw_curvas` binding, add:

```rust
    let hw_cpu_intel = cap(
        "cpu_potencia_intel",
        "Ajustar PL1/PL2 de CPU (Intel)",
        hw.cpu_potencia_intel,
        hw.cpu_potencia_intel_reason.as_deref(),
    );
    let hw_cpu_amd = cap(
        "cpu_potencia_amd",
        "Ajustar PPT de CPU (AMD, vía ryzenadj — sin garantía del fabricante)",
        hw.cpu_potencia_amd,
        hw.cpu_potencia_amd_reason.as_deref(),
    );
    let hw_cpu_temp = cap(
        "cpu_temperatura",
        "Temperatura de CPU por núcleo",
        hw.cpu_temperatura,
        hw.cpu_temperatura_reason.as_deref(),
    );
```

Then push `hw_cpu_intel`, `hw_cpu_amd`, `hw_cpu_temp` onto the end of BOTH the `Mode::Native`
and `Mode::Docker` vectors (after `hw_curvas`), same pattern as `hw_potencia`/`hw_curvas` were
added in the GPU plan.

- [ ] **Step 3: Run the proto tests**

Run: `cargo test -p lumi-proto`
Expected: `todo_recorte_lleva_motivo` still passes — the new fields all default to `Off` with a
non-empty reason, same as `potencia`/`curvas` did.

- [ ] **Step 4: Finish `hello.rs`'s wiring (compiles together with Task 3)**

`crates/lumid/src/routes/hello.rs` already calls `&crate::hardware::capacidades().await` (from
the GPU plan) — this doesn't need to change here, since `capacidades()` itself is what Task 3
extends to also fill the three new CPU fields. **Do not run `cargo build -p lumid` alone after
this step** — it won't compile until Task 3 extends `capacidades()`'s return type usage.
Confirm only `cargo test -p lumi-proto` passes here, same sequencing caveat as the GPU plan's
Task 1.

- [ ] **Step 5: Commit**

```bash
git add crates/lumi-proto/src/api.rs crates/lumi-proto/src/caps.rs
git commit -m "feat: tipos de Hardware CPU y capacidades de potencia Intel/AMD en lumi-proto"
```

---

### Task 2: Tabla de persistencia de CPU

**Files:**
- Modify: `crates/lumid/src/store.rs`

**Interfaces:**
- Produces: SQLite table `cpu_profile(id INTEGER PRIMARY KEY CHECK (id = 1), pl1_w REAL NOT
  NULL, pl2_w REAL NOT NULL, updated_at INTEGER NOT NULL)` — single row enforced by the
  `CHECK (id = 1)`, since there's only ever one CPU.

- [ ] **Step 1: Add the table**

In `crates/lumid/src/store.rs`, add right after the `hardware_profiles` table definition
(inside the `SCHEMA` string, before the closing `";`):

```sql
CREATE TABLE IF NOT EXISTS cpu_profile (
    id         INTEGER PRIMARY KEY CHECK (id = 1),
    pl1_w      REAL NOT NULL,
    pl2_w      REAL NOT NULL,
    updated_at INTEGER NOT NULL
);
```

- [ ] **Step 2: Verify it compiles**

Run: `cargo build -p lumid`
Expected: builds clean (additive DDL only).

- [ ] **Step 3: Commit**

```bash
git add crates/lumid/src/store.rs
git commit -m "feat: tabla cpu_profile para persistir el perfil de potencia de CPU"
```

---

### Task 3: Lecturas, escrituras y capacidades de CPU en `lumid`

**Files:**
- Create: `crates/lumid/src/hardware_cpu.rs`
- Modify: `crates/lumid/src/main.rs` (add `mod hardware_cpu;`, register routes, extend startup
  reapply)
- Create: `crates/lumid/src/routes/hardware_cpu.rs`
- Modify: `crates/lumid/src/routes/mod.rs` (register the new route module)

**Interfaces:**
- Consumes: `lumi_proto::api::{CpuCoreSample, CpuSample, CpuRango, CpuProfile, CpuDevice,
  PatchCpuReq}` (Task 1), `lumi_proto::caps::HardwareCaps` (Task 1), `App` (has `.store`,
  `.sysinfo`).
- Produces: `hardware_cpu::fabricante() -> String`, `hardware_cpu::rango(fabricante: &str) ->
  CpuRango`, `hardware_cpu::fuera_de_rango(perfil: &CpuProfile, rango: &CpuRango) ->
  Option<String>` (pure, tested), `hardware_cpu::dispositivo(app: &App) -> CpuDevice`,
  `hardware_cpu::aplicar(app: &App, req: &PatchCpuReq) -> Result<CpuDevice, AplicarCpuError>`,
  `hardware_cpu::reaplicar_al_arrancar(app: &App)`, `hardware_cpu::capacidades() -> (CapState,
  Option<String>, CapState, Option<String>, CapState, Option<String>)` (intel, intel_reason,
  amd, amd_reason, temp, temp_reason — folded into `HardwareCaps` by the caller).

- [ ] **Step 1: Fabricante detection and the pure range check, with tests**

Create `crates/lumid/src/hardware_cpu.rs`:

```rust
//! Lecturas y escrituras de hardware (CPU). Dos mecanismos de control
//! completamente distintos según fabricante: RAPL por sysfs en Intel
//! (interfaz oficial de kernel), `ryzenadj` en AMD (sin interfaz oficial,
//! escribe en registros del SMU vía acceso crudo — el control de más riesgo
//! de toda la sección Hardware, y la interfaz lo dice explícitamente).

use crate::App;
use lumi_proto::api::{CpuCoreSample, CpuDevice, CpuProfile, CpuRango, CpuSample, PatchCpuReq};
use lumi_proto::caps::CapState;
use std::path::Path;

/// `"intel"` | `"amd"` | `"otro"`. De `/proc/cpuinfo`, igual que ya hace
/// `lumi-cli::detect` para el resumen de CPU del instalador — no se
/// reinventa la detección, se repite la misma lectura porque `lumid` y
/// `lumi-cli` son binarios distintos que no comparten ese módulo.
pub fn fabricante() -> String {
    let Ok(texto) = std::fs::read_to_string("/proc/cpuinfo") else { return "otro".into() };
    if texto.contains("GenuineIntel") {
        "intel".into()
    } else if texto.contains("AuthenticAMD") {
        "amd".into()
    } else {
        "otro".into()
    }
}

fn tdp_declarado_w() -> f32 {
    // ponytail: no hay una forma portable de leer el TDP declarado sin
    // parsear el nombre comercial del modelo (no lo expone /proc/cpuinfo
    // como número). 65W es el techo típico de un procesador de escritorio
    // sin sufijo "K"/"X" — una aproximación deliberada, documentada como tal
    // en `CpuRango.aproximado`, no un dato leído del hardware.
    65.0
}

pub fn rango(fabricante: &str) -> CpuRango {
    if fabricante == "intel" {
        if let Some(max_uw) = leer_sysfs_u64("/sys/class/powercap/intel-rapl:0/constraint_0_max_power_uw") {
            return CpuRango {
                potencia_min_w: (max_uw as f32 / 1_000_000.0) * 0.5,
                potencia_max_w: max_uw as f32 / 1_000_000.0,
                aproximado: false,
            };
        }
    }
    let tdp = tdp_declarado_w();
    CpuRango { potencia_min_w: tdp * 0.5, potencia_max_w: tdp, aproximado: true }
}

fn leer_sysfs_u64(ruta: &str) -> Option<u64> {
    std::fs::read_to_string(ruta).ok()?.trim().parse().ok()
}

/// Mismo motivo que en GPU: un solo texto para el `409` y para el modal de
/// "soy consciente".
pub fn fuera_de_rango(perfil: &CpuProfile, rango: &CpuRango) -> Option<String> {
    if perfil.pl2_w > rango.potencia_max_w {
        return Some(format!(
            "{:.0}W (PL2/fast-limit) supera el {} de {:.0}W.",
            perfil.pl2_w,
            if rango.aproximado { "máximo aproximado" } else { "máximo de fábrica" },
            rango.potencia_max_w
        ));
    }
    if perfil.pl1_w < rango.potencia_min_w {
        return Some(format!(
            "{:.0}W (PL1/slow-limit) está por debajo del mínimo seguro de {:.0}W.",
            perfil.pl1_w, rango.potencia_min_w
        ));
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detecta_fabricante_por_texto() {
        // `fabricante()` lee de disco; aquí se prueba solo la lógica de
        // clasificación de texto, extraída para no depender de /proc/cpuinfo
        // real en CI.
        fn clasifica(texto: &str) -> &'static str {
            if texto.contains("GenuineIntel") { "intel" }
            else if texto.contains("AuthenticAMD") { "amd" }
            else { "otro" }
        }
        assert_eq!(clasifica("vendor_id\t: GenuineIntel\n"), "intel");
        assert_eq!(clasifica("vendor_id\t: AuthenticAMD\n"), "amd");
        assert_eq!(clasifica("vendor_id\t: ARM\n"), "otro");
    }

    fn rango_intel() -> CpuRango {
        CpuRango { potencia_min_w: 32.5, potencia_max_w: 65.0, aproximado: false }
    }

    #[test]
    fn dentro_de_rango_no_da_motivo() {
        let p = CpuProfile { pl1_w: 45.0, pl2_w: 60.0 };
        assert!(fuera_de_rango(&p, &rango_intel()).is_none());
    }

    #[test]
    fn pl2_sobre_el_maximo_da_motivo() {
        let p = CpuProfile { pl1_w: 45.0, pl2_w: 90.0 };
        let m = fuera_de_rango(&p, &rango_intel()).unwrap();
        assert!(m.contains("90"));
        assert!(m.contains("65"));
    }

    #[test]
    fn pl1_bajo_el_minimo_da_motivo() {
        let p = CpuProfile { pl1_w: 10.0, pl2_w: 60.0 };
        let m = fuera_de_rango(&p, &rango_intel()).unwrap();
        assert!(m.contains("10"));
    }

    #[test]
    fn amd_aproximado_se_marca_como_tal() {
        assert!(rango("amd").aproximado);
        assert!(!rango("otro").aproximado || rango("otro").potencia_max_w > 0.0);
    }
}
```

- [ ] **Step 2: Run the tests**

Run: `cargo test -p lumid hardware_cpu::tests`
Expected: 5 tests pass.

- [ ] **Step 3: Add reads (hwmon temperature, sysinfo usage, RAPL/ryzenadj power)**

Append to `crates/lumid/src/hardware_cpu.rs`:

```rust
/// Busca el `hwmon` correcto por su `name` (`coretemp` en Intel, `k10temp`
/// en AMD) y lee sus `tempN_input`, uno por núcleo con sensor propio. `None`
/// si no hay ninguno — WSL2, siempre, porque `/sys/class/hwmon` está vacío.
fn temperaturas_por_nucleo() -> Vec<Option<i32>> {
    let Ok(entradas) = std::fs::read_dir("/sys/class/hwmon") else { return Vec::new() };
    for entrada in entradas.flatten() {
        let ruta = entrada.path();
        let Ok(nombre) = std::fs::read_to_string(ruta.join("name")) else { continue };
        let nombre = nombre.trim();
        if nombre != "coretemp" && nombre != "k10temp" {
            continue;
        }
        let mut temps = Vec::new();
        for i in 1.. {
            let Some(mili) = leer_sysfs_u64(ruta.join(format!("temp{i}_input")).to_str().unwrap_or(""))
            else {
                break;
            };
            temps.push(Some((mili / 1000) as i32));
        }
        if !temps.is_empty() {
            return temps;
        }
    }
    Vec::new()
}

fn potencia_actual_w(fabricante: &str) -> Option<f32> {
    if fabricante == "intel" {
        let energia_uj = leer_sysfs_u64("/sys/class/powercap/intel-rapl:0/energy_uj")?;
        // Una sola lectura de energía acumulada no da potencia instantánea
        // sin una segunda muestra separada en el tiempo — se deja `None`
        // aquí y se calcula por diferencia si hace falta en una iteración
        // futura; no se inventa un número de una sola lectura.
        let _ = energia_uj;
        return None;
    }
    leer_potencia_ryzenadj()
}

fn leer_potencia_ryzenadj() -> Option<f32> {
    let salida = std::process::Command::new("ryzenadj").arg("-i").output().ok()?;
    let texto = String::from_utf8_lossy(&salida.stdout);
    // Formato típico de `ryzenadj -i`: " STAPM VALUE | 25.234 | W" — se busca
    // la línea y se toma el número entre las dos barras. No es un formato
    // documentado ni estable entre versiones; si cambia, esto vuelve `None`
    // en vez de inventar un valor.
    texto.lines().find(|l| l.contains("STAPM VALUE")).and_then(|l| {
        l.split('|').nth(1)?.trim().parse().ok()
    })
}

pub fn dispositivo(app: &App) -> CpuDevice {
    let fab = fabricante();
    let temps = temperaturas_por_nucleo();
    let nucleos = {
        let mut s = app.sysinfo.lock().expect("mutex de sysinfo envenenado");
        s.refresh_cpu_all();
        s.cpus()
            .iter()
            .enumerate()
            .map(|(i, c)| CpuCoreSample {
                indice: i as u32,
                temp_c: temps.get(i).copied().flatten(),
                uso_pct: c.cpu_usage(),
            })
            .collect()
    };
    CpuDevice {
        rango: rango(&fab),
        sample: CpuSample { nucleos, potencia_w: potencia_actual_w(&fab) },
        perfil: perfil_guardado(app),
        fabricante: fab,
    }
}

fn perfil_guardado(app: &App) -> Option<CpuProfile> {
    app.store
        .conn()
        .query_row("SELECT pl1_w, pl2_w FROM cpu_profile WHERE id = 1", [], |r| {
            Ok(CpuProfile { pl1_w: r.get(0)?, pl2_w: r.get(1)? })
        })
        .ok()
}
```

- [ ] **Step 4: Writes, capacity probes, and reapply-on-boot**

Append:

```rust
#[derive(Debug)]
pub enum AplicarCpuError {
    FueraDeRango(String),
    Escritura(String),
}

pub async fn aplicar(app: &App, req: &PatchCpuReq) -> Result<CpuDevice, AplicarCpuError> {
    let fab = fabricante();
    let existente = perfil_guardado(app);
    let nuevo = CpuProfile {
        pl1_w: req.pl1_w.unwrap_or_else(|| existente.as_ref().map(|p| p.pl1_w).unwrap_or(0.0)),
        pl2_w: req.pl2_w.unwrap_or_else(|| existente.as_ref().map(|p| p.pl2_w).unwrap_or(0.0)),
    };
    let rango_actual = rango(&fab);
    if !req.confirmado {
        if let Some(motivo) = fuera_de_rango(&nuevo, &rango_actual) {
            return Err(AplicarCpuError::FueraDeRango(motivo));
        }
    }

    match fab.as_str() {
        "intel" => escribir_rapl(&nuevo).map_err(AplicarCpuError::Escritura)?,
        "amd" => escribir_ryzenadj(&nuevo).await.map_err(AplicarCpuError::Escritura)?,
        _ => return Err(AplicarCpuError::Escritura("fabricante de CPU no reconocido".into())),
    }

    guardar_perfil(app, &nuevo).map_err(|e| AplicarCpuError::Escritura(e.to_string()))?;
    Ok(dispositivo(app))
}

fn escribir_rapl(perfil: &CpuProfile) -> Result<(), String> {
    let pl1_uw = (perfil.pl1_w * 1_000_000.0) as u64;
    let pl2_uw = (perfil.pl2_w * 1_000_000.0) as u64;
    std::fs::write(
        "/sys/class/powercap/intel-rapl:0/constraint_0_power_limit_uw",
        pl1_uw.to_string(),
    )
    .map_err(|e| e.to_string())?;
    std::fs::write(
        "/sys/class/powercap/intel-rapl:0/constraint_1_power_limit_uw",
        pl2_uw.to_string(),
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

async fn escribir_ryzenadj(perfil: &CpuProfile) -> Result<(), String> {
    let out = tokio::process::Command::new("ryzenadj")
        .arg(format!("--stapm-limit={}", (perfil.pl1_w * 1000.0) as u64))
        .arg(format!("--slow-limit={}", (perfil.pl1_w * 1000.0) as u64))
        .arg(format!("--fast-limit={}", (perfil.pl2_w * 1000.0) as u64))
        .output()
        .await
        .map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).to_string());
    }
    Ok(())
}

fn guardar_perfil(app: &App, perfil: &CpuProfile) -> rusqlite::Result<()> {
    app.store.conn().execute(
        "INSERT INTO cpu_profile (id, pl1_w, pl2_w, updated_at) VALUES (1, ?1, ?2, ?3)
         ON CONFLICT(id) DO UPDATE SET pl1_w = excluded.pl1_w, pl2_w = excluded.pl2_w, updated_at = excluded.updated_at",
        rusqlite::params![perfil.pl1_w, perfil.pl2_w, crate::routes::access::now()],
    )?;
    Ok(())
}

pub async fn reaplicar_al_arrancar(app: &App) {
    let Some(perfil) = perfil_guardado(app) else { return };
    let req = PatchCpuReq { pl1_w: Some(perfil.pl1_w), pl2_w: Some(perfil.pl2_w), confirmado: true };
    if let Err(e) = aplicar(app, &req).await {
        tracing::warn!("no se pudo reaplicar el perfil de potencia de CPU: {e:?}");
    }
}

/// Se comprueba una vez por conexión a `/v1/hello`. Igual que en GPU: no
/// basta con que exista el fichero, hay que intentar la escritura de verdad
/// para saber si el proceso puede escribir ahí (WSL2 podría, en teoría,
/// tener el sysfs montado pero de solo lectura — se prueba, no se adivina).
pub async fn capacidades() -> (CapState, Option<String>, CapState, Option<String>, CapState, Option<String>) {
    let fab = fabricante();
    let hay_hwmon = !temperaturas_por_nucleo().is_empty();
    let (temp, temp_reason) = if hay_hwmon {
        (CapState::On, None)
    } else {
        (CapState::Off, Some("Sin sensor coretemp/k10temp en /sys/class/hwmon. En WSL2 esto ocurre siempre: no hay acceso a los sensores del host.".to_string()))
    };

    let (intel, intel_reason) = if fab != "intel" {
        (CapState::Off, Some("Esta CPU es de otro fabricante.".to_string()))
    } else if sondear_rapl() {
        (CapState::On, None)
    } else {
        (CapState::Off, Some("No hay /sys/class/powercap/intel-rapl:0 con permiso de escritura. En WSL2 esto ocurre siempre.".to_string()))
    };

    let (amd, amd_reason) = if fab != "amd" {
        (CapState::Off, Some("Esta CPU es de otro fabricante.".to_string()))
    } else {
        let ryzenadj_ok = tokio::process::Command::new("ryzenadj")
            .arg("-i")
            .output()
            .await
            .is_ok_and(|o| o.status.success());
        if ryzenadj_ok {
            (CapState::On, None)
        } else {
            (
                CapState::Off,
                Some("Requiere el binario ryzenadj instalado. Sin interfaz oficial del fabricante — el control de más riesgo de toda esta sección.".to_string()),
            )
        }
    };

    (intel, intel_reason, amd, amd_reason, temp, temp_reason)
}

fn sondear_rapl() -> bool {
    let ruta = "/sys/class/powercap/intel-rapl:0/constraint_0_power_limit_uw";
    let Some(actual) = leer_sysfs_u64(ruta) else { return false };
    std::fs::write(ruta, actual.to_string()).is_ok()
}
```

- [ ] **Step 5: Route**

Create `crates/lumid/src/routes/hardware_cpu.rs`:

```rust
//! GET/PATCH de la CPU dentro de Hardware. Misma forma que
//! `routes::hardware` para GPU: autentica aquí, la lógica vive en
//! `crate::hardware_cpu`.

use crate::routes::auth::{bearer, require_admin};
use crate::App;
use axum::extract::State;
use axum::{http::HeaderMap, http::StatusCode, Json};
use lumi_proto::api::{CpuDevice, PatchCpuReq};

pub async fn leer(State(app): State<App>, headers: HeaderMap) -> Result<Json<CpuDevice>, StatusCode> {
    require_admin(&app, &bearer(&headers))?;
    Ok(Json(crate::hardware_cpu::dispositivo(&app)))
}

pub async fn aplicar(
    State(app): State<App>,
    headers: HeaderMap,
    Json(req): Json<PatchCpuReq>,
) -> Result<Json<CpuDevice>, (StatusCode, String)> {
    require_admin(&app, &bearer(&headers)).map_err(|c| (c, "hace falta ser administrador".to_string()))?;
    match crate::hardware_cpu::aplicar(&app, &req).await {
        Ok(dev) => Ok(Json(dev)),
        Err(crate::hardware_cpu::AplicarCpuError::FueraDeRango(m)) => Err((StatusCode::CONFLICT, m)),
        Err(crate::hardware_cpu::AplicarCpuError::Escritura(m)) => Err((StatusCode::INTERNAL_SERVER_ERROR, m)),
    }
}
```

- [ ] **Step 6: Wire it all up**

In `crates/lumid/src/routes/mod.rs`, add (alongside the existing `pub mod hardware;`):

```rust
pub mod hardware_cpu;
```

In `crates/lumid/src/main.rs`, add `mod hardware_cpu;` next to `mod hardware;`:

```rust
mod hardware;
mod hardware_cpu;
```

Register the two routes, right after the GPU hardware routes:

```rust
        .route("/v1/admin/hardware/cpu", get(routes::hardware_cpu::leer).patch(routes::hardware_cpu::aplicar))
```

Extend the startup reapply spawn (the one added by the GPU plan, right after `let app = App {
... };`) to also reapply CPU:

```rust
    tokio::spawn({
        let app = app.clone();
        async move {
            hardware::reaplicar_al_arrancar(&app).await;
            hardware_cpu::reaplicar_al_arrancar(&app).await;
        }
    });
```

Finish `hello.rs`'s capability wiring — the call already there
(`&crate::hardware::capacidades().await`) needs to also fold in the CPU probe. Change it to:

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

- [ ] **Step 7: Build and test**

Run: `cargo build -p lumid`
Expected: builds clean.

Run: `cargo test -p lumid hardware_cpu::`
Expected: the 5 tests from Step 2 still pass.

Run: `cargo test -p lumi-proto`
Expected: passes.

- [ ] **Step 8: Commit**

```bash
git add crates/lumid/src/hardware_cpu.rs crates/lumid/src/routes/hardware_cpu.rs \
        crates/lumid/src/routes/mod.rs crates/lumid/src/main.rs crates/lumid/src/routes/hello.rs
git commit -m "feat: lecturas/escrituras de CPU (PL1/PL2 Intel, PPT AMD via ryzenadj), persistencia y reaplicacion"
```

---

### Task 4: Tipos y llamadas de CPU en el cliente

**Files:**
- Modify: `client/src/lib/api.ts`

**Interfaces:**
- Produces: TS types `CpuCoreSample`, `CpuSample`, `CpuRango`, `CpuProfile`, `CpuDevice`,
  `PatchCpuReq`, and `api.cpuLeer` / `api.cpuAplicar`, consumed by Task 5/6.

- [ ] **Step 1: Add the types**

In `client/src/lib/api.ts`, add after the `HardwareDevice`/`PatchHardwareReq` block (from the
GPU plan):

```ts
export interface CpuCoreSample { indice: number; temp_c: number | null; uso_pct: number }
export interface CpuSample { nucleos: CpuCoreSample[]; potencia_w: number | null }
export interface CpuRango { potencia_min_w: number; potencia_max_w: number; aproximado: boolean }
export interface CpuProfile { pl1_w: number; pl2_w: number }
export interface CpuDevice {
  fabricante: "intel" | "amd" | "otro"; sample: CpuSample; rango: CpuRango;
  perfil: CpuProfile | null;
}
export interface PatchCpuReq { pl1_w?: number; pl2_w?: number; confirmado?: boolean }
```

- [ ] **Step 2: Add the API methods**

In the `api` object, add:

```ts
  cpuLeer: (token: string) => api.get<CpuDevice>("/v1/admin/hardware/cpu", token),
  cpuAplicar: (req: PatchCpuReq, token: string) => api.patch<CpuDevice>("/v1/admin/hardware/cpu", req, token),
```

- [ ] **Step 3: Typecheck**

Run: `cd client && npx tsc -b`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add client/src/lib/api.ts
git commit -m "feat: tipos y llamadas de Hardware CPU en el cliente"
```

---

### Task 5: Editor modal de CPU (pestañas Potencia/Sensores)

**Files:**
- Create: `client/src/admin/CpuEditor.tsx`

**Interfaces:**
- Consumes: `ConfirmarPeligro` (existing, from the GPU plan), `api.cpuAplicar` (Task 4).
- Produces: `<CpuEditor device={CpuDevice} token={string} onCerrar={() => void}
  onAplicado={(d: CpuDevice) => void} potenciaHabilitada={boolean} potenciaMotivo={string |
  null} />`, consumed by Task 6.

- [ ] **Step 1: Write the component**

Create `client/src/admin/CpuEditor.tsx` — same modal shell as `HardwareEditor` (header, tabs,
footer), but only two tabs and no curve editor dependency:

```tsx
import { useState } from "react";
import { api, type CpuDevice } from "../lib/api";
import { ConfirmarPeligro } from "./ConfirmarPeligro";
import { Icon } from "../ui/Icon";

type Pestana = "potencia" | "sensores";

export function CpuEditor({
  device, token, onCerrar, onAplicado, potenciaHabilitada, potenciaMotivo,
}: {
  device: CpuDevice; token: string; onCerrar: () => void;
  onAplicado: (d: CpuDevice) => void;
  potenciaHabilitada: boolean; potenciaMotivo: string | null;
}) {
  const [pestana, setPestana] = useState<Pestana>("potencia");
  const perfil = device.perfil ?? { pl1_w: device.rango.potencia_max_w, pl2_w: device.rango.potencia_max_w };
  const [pl1, setPl1] = useState(perfil.pl1_w);
  const [pl2, setPl2] = useState(perfil.pl2_w);
  const [confirmando, setConfirmando] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const AMD_AVISO = "Vas a aplicar un control sin garantía del fabricante (ryzenadj, acceso directo a registros del SMU) — esto se pide siempre en AMD, dentro o fuera de rango, no solo al superar un límite.";

  async function aplicar(confirmado: boolean) {
    setError(null);
    // En AMD el modal de "soy consciente" se exige SIEMPRE al aplicar
    // potencia, incluso dentro de rango — es la única plataforma sin
    // interfaz oficial de kernel detrás, y el diseño lo trata como un riesgo
    // aparte del de "salirse de fábrica". Se decide en el cliente, antes de
    // llamar siquiera al backend, porque el backend solo sabe de rango.
    if (device.fabricante === "amd" && !confirmado) {
      setConfirmando(AMD_AVISO);
      return;
    }
    try {
      const dev = await api.cpuAplicar({ pl1_w: pl1, pl2_w: pl2, confirmado }, token);
      setConfirmando(null);
      onAplicado(dev);
      onCerrar();
    } catch (e) {
      const msg = String(e);
      if (!confirmado) { setConfirmando(msg); return; }
      setError(msg);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div className="w-[620px] max-w-[94vw] overflow-hidden rounded-card border border-border bg-panel"
        style={{ animation: "jg-popup-scale-in .3s cubic-bezier(.16,1,.3,1) both" }}>

        <div className="flex items-center gap-3 border-b border-border px-5 py-4">
          <Icon name="device" size={26} className="text-subtle" />
          <div className="flex-1">
            <div className="text-[14px] text-fg">CPU · {device.fabricante}</div>
            <div className="text-[9.5px] text-subtle">editando perfil avanzado</div>
          </div>
          <button onClick={onCerrar} className="jg-press rounded-lg px-2 py-1 text-subtle">✕</button>
        </div>

        <div className="flex gap-6 border-b border-border px-5">
          {(["potencia", "sensores"] as Pestana[]).map((p) => (
            <button key={p} onClick={() => setPestana(p)}
              className={`border-b-2 py-2.5 text-[11px] capitalize transition-colors
                ${pestana === p ? "border-fg text-fg" : "border-transparent text-subtle hover:text-muted"}`}>
              {p}
            </button>
          ))}
        </div>

        <div className="min-h-[220px] p-5">
          {pestana === "potencia" && (
            potenciaHabilitada ? (
              <div>
                {device.fabricante === "amd" && (
                  <p className="mb-3 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-[10.5px] text-danger-fg">
                    ⚠ Este control usa ryzenadj, sin garantía del fabricante — más riesgo que cualquier
                    otro control de esta sección, dentro o fuera de rango.
                  </p>
                )}
                {device.rango.aproximado && (
                  <p className="mb-3 text-[10px] text-subtle">
                    El rango de esta CPU es una aproximación (50–100% del TDP declarado), no un dato leído del hardware.
                  </p>
                )}
                <div className="mb-3">
                  <div className="mb-1 text-[9px] uppercase tracking-[.08em] text-subtle">
                    {device.fabricante === "amd" ? "slow/stapm limit (PL1)" : "PL1 (sostenido)"}
                  </div>
                  <input type="range" min={device.rango.potencia_min_w} max={device.rango.potencia_max_w * 1.2}
                    value={pl1} onChange={(e) => setPl1(+e.target.value)} className="w-full accent-fg" />
                  <span className="font-mono text-[10px] text-muted">{pl1.toFixed(0)}W</span>
                </div>
                <div>
                  <div className="mb-1 text-[9px] uppercase tracking-[.08em] text-subtle">
                    {device.fabricante === "amd" ? "fast limit (PL2)" : "PL2 (boost)"}
                  </div>
                  <input type="range" min={device.rango.potencia_min_w} max={device.rango.potencia_max_w * 1.2}
                    value={pl2} onChange={(e) => setPl2(+e.target.value)} className="w-full accent-fg" />
                  <span className="font-mono text-[10px] text-muted">{pl2.toFixed(0)}W</span>
                </div>
              </div>
            ) : (
              <p className="text-[11px] text-muted">{potenciaMotivo}</p>
            )
          )}

          {pestana === "sensores" && (
            <table className="w-full text-[11px]">
              <thead>
                <tr className="text-left text-[8.5px] uppercase tracking-[.06em] text-subtle">
                  <th className="pb-1.5">núcleo</th><th className="pb-1.5">temperatura</th><th className="pb-1.5">uso</th>
                </tr>
              </thead>
              <tbody className="font-mono">
                {device.sample.nucleos.map((n) => (
                  <tr key={n.indice}>
                    <td className="py-1 text-fg">{n.indice}</td>
                    <td>{n.temp_c ?? "—"}°C</td>
                    <td>{n.uso_pct.toFixed(0)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {error && <p className="px-5 pb-2 text-[10.5px] text-danger-fg">{error}</p>}
        <div className="flex items-center justify-between border-t border-border bg-bg px-5 py-3.5">
          <span className="text-[9.5px] text-subtle">
            los cambios se aplican al pulsar «Aplicar» · un valor fuera de rango pedirá confirmación
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
git add client/src/admin/CpuEditor.tsx
git commit -m "feat: editor modal de Hardware CPU con pestañas Potencia/Sensores"
```

---

### Task 6: Fila de CPU en la pantalla principal

**Files:**
- Modify: `client/src/admin/HardwareView.tsx`

**Interfaces:**
- Consumes: `CpuEditor` (Task 5), `api.cpuLeer` (Task 4).

- [ ] **Step 1: Add CPU state and loading**

In `client/src/admin/HardwareView.tsx`, add the import and extra state, right after the
existing GPU-related state declarations:

```tsx
import { CpuEditor } from "./CpuEditor";
import { api, type HardwareDevice, type CpuDevice } from "../lib/api";
```

(Replace the existing `import { api, type HardwareDevice } from "../lib/api";` line with the
one above — same import, one more type.)

Add, alongside `dispositivos`/`error`:

```tsx
  const [cpu, setCpu] = useState<CpuDevice | null>(null);
  const [cpuError, setCpuError] = useState<string | null>(null);
  const [editandoCpu, setEditandoCpu] = useState(false);
  // Básico en AMD todavía exige el mismo "soy consciente" que avanzado —
  // ryzenadj no se vuelve más seguro por estar acotado a un rango, así que
  // el slider básico de AMD no aplica directo como el de Intel/GPU: siempre
  // pasa primero por este modal.
  const [confirmandoCpuBasico, setConfirmandoCpuBasico] = useState<{ w: number } | null>(null);
  const capCpuIntel = useServer((s) => s.hello?.capabilities.find((c) => c.id === "cpu_potencia_intel"));
  const capCpuAmd = useServer((s) => s.hello?.capabilities.find((c) => c.id === "cpu_potencia_amd"));
  const capCpuTemp = useServer((s) => s.hello?.capabilities.find((c) => c.id === "cpu_temperatura"));
```

Add a second `useEffect`, next to the existing GPU one:

```tsx
  useEffect(() => {
    api.cpuLeer(token).then(setCpu).catch((e) => setCpuError(String(e)));
  }, [token]);
```

Add the básico-mode apply function, next to `aplicarBasico` (the GPU one):

```tsx
  async function aplicarCpuBasico(w: number, confirmado: boolean) {
    setErrorAplicar(null);
    if (cpu?.fabricante === "amd" && !confirmado) {
      setConfirmandoCpuBasico({ w });
      return;
    }
    try {
      const dev = await api.cpuAplicar({ pl1_w: w, pl2_w: w, confirmado }, token);
      setCpu(dev);
    } catch (e) {
      setErrorAplicar(String(e));
    }
  }
```

- [ ] **Step 2: Render the CPU row**

Add, right after the closing `</div>` of the GPU `dispositivos.map(...)` block (still inside
the `<div className="mt-3 space-y-2.5">` wrapper — so the CPU row sits directly below the GPU
rows, same spacing):

```tsx
        {cpu && (
          <div
            onClick={() => avanzado && (capCpuIntel?.state !== "off" || capCpuAmd?.state !== "off") && setEditandoCpu(true)}
            className={`rounded-[14px] border border-border/70 bg-panel p-[18px_20px]
              transition-colors ${avanzado ? "cursor-pointer hover:border-border" : ""}`}>
            <div className="flex items-center gap-6">
              <Icon name="device" size={44} className="shrink-0 text-subtle" />
              <div className="w-[150px] shrink-0">
                <div className="text-[13.5px] text-fg">CPU</div>
                <div className="mt-0.5 font-mono text-[9.5px] text-subtle">{cpu.fabricante}</div>
              </div>
              <div className="grid flex-1 grid-cols-8 gap-1.5">
                {cpu.sample.nucleos.map((n) => (
                  <div key={n.indice} className="rounded-md bg-elevated px-1.5 py-1 text-center"
                    style={{ background: n.temp_c != null ? `rgba(239,159,39,${Math.min(.28, n.temp_c / 350)})` : undefined }}>
                    <div className="text-[7.5px] text-subtle">{n.indice}</div>
                    <div className="font-mono text-[11px] text-fg">{n.temp_c ?? "—"}°</div>
                  </div>
                ))}
              </div>
              <Stat v={cpu.sample.potencia_w != null ? cpu.sample.potencia_w.toFixed(0) : "—"} u="W" l="potencia" />
            </div>

            {!avanzado && (cpu.fabricante === "intel" ? capCpuIntel?.state !== "off" : capCpuAmd?.state !== "off") && (
              <div className="mt-3 border-t border-border/60 pt-3" onClick={(e) => e.stopPropagation()}>
                <input
                  type="range" min={cpu.rango.potencia_min_w} max={cpu.rango.potencia_max_w}
                  defaultValue={cpu.perfil?.pl1_w ?? cpu.rango.potencia_max_w}
                  onPointerUp={(e) => aplicarCpuBasico(+(e.target as HTMLInputElement).value, false)}
                  className="w-full accent-fg"
                />
                <div className="flex justify-between font-mono text-[9px] text-subtle">
                  <span>{cpu.rango.potencia_min_w.toFixed(0)}W</span>
                  <span>{cpu.rango.potencia_max_w.toFixed(0)}W{cpu.rango.aproximado ? " (aprox.)" : ""}</span>
                </div>
              </div>
            )}
          </div>
        )}
        {cpuError && <p className="text-[10.5px] text-danger-fg">{cpuError}</p>}
```

- [ ] **Step 3: Wire the modal and the capability note**

Right after the existing GPU `HardwareEditor` block's closing `})()}`, add:

```tsx
      {editandoCpu && cpu && (
        <CpuEditor
          device={cpu} token={token} onCerrar={() => setEditandoCpu(false)}
          onAplicado={setCpu}
          potenciaHabilitada={cpu.fabricante === "intel" ? capCpuIntel?.state !== "off" : capCpuAmd?.state !== "off"}
          potenciaMotivo={(cpu.fabricante === "intel" ? capCpuIntel?.reason : capCpuAmd?.reason) ?? null}
        />
      )}

      {confirmandoCpuBasico && (
        <ConfirmarPeligro
          motivo="Vas a aplicar un control sin garantía del fabricante (ryzenadj) — esto se pide siempre en AMD, dentro o fuera de rango."
          onCancelar={() => setConfirmandoCpuBasico(null)}
          onConfirmar={() => {
            const w = confirmandoCpuBasico.w;
            setConfirmandoCpuBasico(null);
            void aplicarCpuBasico(w, true);
          }}
        />
      )}
```

This needs `ConfirmarPeligro` imported into `HardwareView.tsx` too — add it alongside the
`CpuEditor` import from Step 1:

```tsx
import { ConfirmarPeligro } from "./ConfirmarPeligro";
```

Extend the existing capability-note paragraph at the bottom (the one that currently shows
`capPotencia`/`capCurvas` when `off`) to also mention CPU:

```tsx
      {(capPotencia?.state === "off" || capCurvas?.state === "off" || capCpuTemp?.state === "off") && (
        <p className="mt-4 text-[10.5px] leading-relaxed text-subtle">
          {capPotencia?.state === "off" && <>Potencia GPU: {capPotencia.reason} </>}
          {capCurvas?.state === "off" && <>Curvas: {capCurvas.reason} </>}
          {capCpuTemp?.state === "off" && <>Temperatura CPU: {capCpuTemp.reason}</>}
        </p>
      )}
```

- [ ] **Step 4: Typecheck and lint**

Run: `cd client && npx tsc -b`
Expected: no errors.

Run: `cd client && npx oxlint`
Expected: no new warnings on the files touched in this task.

- [ ] **Step 5: Commit**

```bash
git add client/src/admin/HardwareView.tsx
git commit -m "feat: fila de CPU en Hardware, mapa de calor por nucleo y editor de potencia"
```

---

### Task 7: Cerrar FUTURO.md — CPU ya no está pendiente

**Files:**
- Modify: `FUTURO.md`

- [ ] **Step 1: Replace the deferred-CPU note with the fan/PWM-only note**

The GPU plan (Task 10) added a "Hardware: CPU (temperatura por núcleo, PPT/PBO)" entry to
`FUTURO.md` saying CPU needed its own spec — that's now done. Find that entry (`grep -n
"Hardware: CPU" FUTURO.md`) and replace it with:

```markdown
### Hardware: control de ventilador de CPU (PWM de placa base)

Fuera de alcance de la entrega de CPU (que cubrió temperatura por núcleo y PL1/PL2 Intel/PPT
AMD): el control de ventilador de CPU depende de `fancontrol`/`lm-sensors` y es un mecanismo
por placa base, no por CPU — un proyecto aparte con su propia detección de hardware.
```

Leave the other GPU-related entry from Task 10 of the GPU plan (fan firmware detection)
untouched.

- [ ] **Step 2: Commit**

```bash
git add FUTURO.md
git commit -m "docs: cierra CPU como pendiente en FUTURO.md, anota control de ventilador por placa como fuera de alcance"
```
