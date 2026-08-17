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

/// Que NVML inicialice solo dice que se puede LEER — WSL2 es la prueba: la
/// GPU se pasa con lectura completa pero rechaza cualquier escritura
/// (`NVML_ERROR_NO_PERMISSION`), incluso corriendo como root. La única forma
/// honesta de saber si esta GPU acepta escritura es probarlo de verdad: se
/// lee el límite de potencia actual y se vuelve a fijar exactamente ese
/// mismo valor. Si el driver lo rechaza, el motivo real va tal cual al
/// mensaje — no se adivina por el nombre del kernel, se comprueba contra la
/// tarjeta.
fn sondear_potencia() -> (CapState, Option<String>) {
    let Ok(nvml) = Nvml::init() else {
        return (CapState::Off, Some("NVML no está disponible en este host.".to_string()));
    };
    let Ok(mut d) = nvml.device_by_index(0) else {
        return (CapState::Off, Some("No se detectó ninguna GPU.".to_string()));
    };
    let Ok(actual) = d.power_management_limit() else {
        return (CapState::Off, Some("No se pudo leer el límite de potencia actual.".to_string()));
    };
    match d.set_power_management_limit(actual) {
        Ok(()) => (CapState::On, None),
        Err(e) => (
            CapState::Off,
            Some(format!(
                "El driver rechaza la escritura ({e}). En WSL2 esto ocurre siempre: la GPU se pasa en modo de solo lectura aunque NVML pueda leerla."
            )),
        ),
    }
}

/// Se comprueba una vez por conexión (`GET /v1/hello`), no en cada muestra:
/// lanzar `nvidia-settings` tiene coste real y el resultado no cambia salvo
/// que alguien arranque o pare un servidor X entre medias.
pub async fn capacidades() -> HardwareCaps {
    let (potencia, potencia_reason) = sondear_potencia();

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
