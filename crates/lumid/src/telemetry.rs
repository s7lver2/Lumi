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

    // Un `System` nuevo en cada muestra siempre daría 0%: sysinfo calcula el
    // uso de CPU por diferencia entre esta lectura y la anterior, así que
    // necesita seguir vivo entre muestras (viene de `App`, no se crea aquí).
    let (cpu_pct, ram_used_mb) = {
        let mut s = app.sysinfo.lock().expect("mutex de sysinfo envenenado");
        s.refresh_cpu_all();
        s.refresh_memory();
        let cpu = if s.cpus().is_empty() {
            0.0
        } else {
            s.cpus().iter().map(|c| c.cpu_usage()).sum::<f32>() / s.cpus().len() as f32
        };
        (cpu, s.used_memory() / 1024 / 1024)
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
        ram_used_mb,
        disk_free_mb,
        queue_depth: app.queue.profundidad(),
        // «Pausada» quiere decir que no está repartiendo, y la única razón por
        // la que puede no repartir es no tener ni un trabajador listo. Antes
        // esto miraba la clave maestra, sobre la premisa de que las imágenes
        // estaban cifradas en reposo — y todavía no lo están.
        queue_paused: !app.queue.hay_trabajadores(),
    }
}
