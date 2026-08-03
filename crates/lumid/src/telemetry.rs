//! Muestreo de hardware. Deliberadamente independiente de la clave maestra:
//! sigue funcionando con el servidor sellado, y que siga viva demuestra que la
//! máquina está sana y solo falta desbloquear.

use crate::App;
use lumi_proto::api::{GpuSample, Sample};

pub fn sample(app: &App) -> Sample {
    let gpus = match nvml_wrapper::Nvml::init() {
        Ok(nvml) => (0..nvml.device_count().unwrap_or(0))
            .filter_map(|i| {
                let d = nvml.device_by_index(i).ok()?;
                let m = d.memory_info().ok()?;
                Some(GpuSample {
                    index: i,
                    util_pct: d.utilization_rates().map(|u| u.gpu).unwrap_or(0),
                    vram_used_mb: m.used / 1024 / 1024,
                    vram_total_mb: m.total / 1024 / 1024,
                    // En Docker sin --privileged esto falla, y por eso la
                    // capacidad `nvml` se anuncia como parcial.
                    temp_c: d
                        .temperature(nvml_wrapper::enum_wrappers::device::TemperatureSensor::Gpu)
                        .ok(),
                })
            })
            .collect(),
        Err(_) => vec![],
    };

    let mut s = sysinfo::System::new();
    s.refresh_cpu_all();
    s.refresh_memory();
    let cpu_pct = if s.cpus().is_empty() {
        0.0
    } else {
        s.cpus().iter().map(|c| c.cpu_usage()).sum::<f32>() / s.cpus().len() as f32
    };
    let disks = sysinfo::Disks::new_with_refreshed_list();
    let disk_free_mb = disks
        .list()
        .iter()
        .map(|d| d.available_space() / 1024 / 1024)
        .max()
        .unwrap_or(0);

    Sample {
        gpus,
        cpu_pct,
        ram_used_mb: s.used_memory() / 1024 / 1024,
        disk_free_mb,
        // La cola llega en el subsistema 4. Hasta entonces, cero y no pausada:
        // la franja ya tiene su celda y no habrá que rediseñarla.
        queue_depth: 0,
        queue_paused: app.master.try_read().map(|m| m.is_none()).unwrap_or(false),
    }
}
