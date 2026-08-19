//! Lecturas y escrituras de hardware (CPU). Dos mecanismos de control
//! completamente distintos según fabricante: RAPL por sysfs en Intel
//! (interfaz oficial de kernel), `ryzenadj` en AMD (sin interfaz oficial,
//! escribe en registros del SMU vía acceso crudo — el control de más riesgo
//! de toda la sección Hardware, y la interfaz lo dice explícitamente).

use crate::App;
use lumi_proto::api::{CpuCoreSample, CpuDevice, CpuProfile, CpuRango, CpuSample, PatchCpuReq};
use lumi_proto::caps::CapState;

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
        "intel" => {
            // Escritura síncrona a sysfs — mismo motivo que el resto de
            // este barrido: va a spawn_blocking en vez de correr inline.
            let nuevo_c = nuevo.clone();
            tokio::task::spawn_blocking(move || escribir_rapl(&nuevo_c))
                .await
                .map_err(|e| AplicarCpuError::Escritura(e.to_string()))?
                .map_err(AplicarCpuError::Escritura)?;
        }
        "amd" => escribir_ryzenadj(&nuevo).await.map_err(AplicarCpuError::Escritura)?,
        _ => return Err(AplicarCpuError::Escritura("fabricante de CPU no reconocido".into())),
    }

    guardar_perfil(app, &nuevo).map_err(|e| AplicarCpuError::Escritura(e.to_string()))?;

    // `dispositivo` también bloquea (sysinfo, sysfs, intento de ejecutar
    // `ryzenadj`) — mismo motivo que ya se aplicó a su GET hoy.
    let app_c = app.clone();
    tokio::task::spawn_blocking(move || dispositivo(&app_c))
        .await
        .map_err(|e| AplicarCpuError::Escritura(e.to_string()))
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
    // `fabricante`, `temperaturas_por_nucleo` y `sondear_rapl` leen sysfs de
    // forma síncrona; igual que en `hardware::capacidades`, esto se llama en
    // cada `/v1/hello` y no puede correr inline en un hilo del runtime.
    let (fab, hay_hwmon, rapl_ok) = tokio::task::spawn_blocking(|| {
        let fab = fabricante();
        let hay_hwmon = !temperaturas_por_nucleo().is_empty();
        let rapl_ok = fab == "intel" && sondear_rapl();
        (fab, hay_hwmon, rapl_ok)
    })
    .await
    .unwrap_or_else(|_| (String::new(), false, false));
    let (temp, temp_reason) = if hay_hwmon {
        (CapState::On, None)
    } else {
        (CapState::Off, Some("Sin sensor coretemp/k10temp en /sys/class/hwmon. En WSL2 esto ocurre siempre: no hay acceso a los sensores del host.".to_string()))
    };

    let (intel, intel_reason) = if fab != "intel" {
        (CapState::Off, Some("Esta CPU es de otro fabricante.".to_string()))
    } else if rapl_ok {
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
