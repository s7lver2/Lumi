//! Muestreo de hardware. Deliberadamente independiente de la clave maestra:
//! sigue funcionando con el servidor sellado, y que siga viva demuestra que la
//! máquina está sana y solo falta desbloquear.

use crate::App;
use lumi_proto::api::{AvisoInfo, GpuSample, Sample};

pub fn sample(app: &App, visto_por: Option<(i64, bool)>) -> Sample {
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
                    clock_mhz: d
                        .clock(
                            nvml_wrapper::enum_wrappers::device::Clock::Graphics,
                            nvml_wrapper::enum_wrappers::device::ClockId::Current,
                        )
                        .ok(),
                    fan_pct: d.fan_speed(0).ok(),
                    power_draw_mw: d.power_usage().ok(),
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
        maintenance: crate::mantenimiento::activo(app),
        maintenance_message: crate::mantenimiento::mensaje(app),
        avisos: avisos_para(app, visto_por),
    }
}

/// `None` (sesión inválida o sin token) significa "sin avisos" — el resto de
/// la muestra sigue llegando igual, esto es lo único que depende de quién
/// pregunta. Se resuelve una vez al abrir la conexión SSE
/// (`routes::telemetry::sse`), no en cada muestra: la identidad de una
/// sesión no cambia mientras el stream sigue abierto.
fn avisos_para(app: &App, visto_por: Option<(i64, bool)>) -> Vec<AvisoInfo> {
    let Some((user_id, is_admin)) = visto_por else { return Vec::new() };
    // `c` se suelta al final de este bloque, antes del filtro de abajo: ese
    // filtro llama a `incluye_a`, que vuelve a pedir `app.store.conn()` — si
    // siguiéramos sujetando el guard aquí sería un doble lock sobre el mismo
    // Mutex no reentrante, en el mismo hilo, y un interbloqueo permanente que
    // se lleva por delante cualquier otra petición (una sola conexión global).
    let filas: Vec<AvisoInfo> = {
        let c = app.store.conn();
        let Ok(mut q) = c.prepare(
            "SELECT id, contenido, icono, prioridad, destino, creado_por, created_at
             FROM avisos ORDER BY created_at DESC",
        ) else {
            return Vec::new();
        };
        let Ok(filas) = q.query_map([], |r| {
            let contenido_texto: String = r.get(1)?;
            Ok(AvisoInfo {
                id: r.get(0)?,
                contenido: serde_json::from_str(&contenido_texto).unwrap_or(serde_json::Value::Null),
                icono: r.get(2)?,
                prioridad: r.get(3)?,
                destino: r.get(4)?,
                creado_por: r.get(5)?,
                created_at: r.get(6)?,
            })
        }) else {
            return Vec::new();
        };
        filas.flatten().collect()
    };
    let mut avisos: Vec<AvisoInfo> = filas
        .into_iter()
        .filter(|a| {
            a.destino == "todos"
                || (a.destino == "admins" && is_admin)
                || (a.destino == "personas" && incluye_a(app, a.id, user_id))
        })
        .collect();
    // Los urgentes van primero, pero conservando el orden por fecha DENTRO
    // de cada grupo — `sort_by_key` es estable, y la consulta ya vino
    // ordenada por `created_at DESC`.
    avisos.sort_by_key(|a| a.prioridad != "urgente");
    avisos
}

fn incluye_a(app: &App, aviso_id: i64, user_id: i64) -> bool {
    app.store
        .conn()
        .query_row(
            "SELECT 1 FROM avisos_usuarios WHERE aviso_id = ?1 AND user_id = ?2",
            rusqlite::params![aviso_id, user_id],
            |_| Ok(()),
        )
        .is_ok()
}

fn ahora() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// Arrancada una vez en `main.rs`, no por cliente conectado — a diferencia
/// del SSE de telemetría en vivo, esta tarea existe pase lo que pase, aunque
/// no haya nadie mirando el panel.
pub async fn muestrear_historial(app: App) {
    loop {
        let app2 = app.clone();
        if let Ok(s) = tokio::task::spawn_blocking(move || sample(&app2, None)).await {
            persistir(&app, &s);
        }
        tokio::time::sleep(std::time::Duration::from_secs(60)).await;
    }
}

fn persistir(app: &App, s: &Sample) {
    let gpus_json = serde_json::to_string(&s.gpus).unwrap_or_default();
    let c = app.store.conn();
    let _ = c.execute(
        "INSERT INTO telemetry_historial (created_at, cpu_pct, ram_used_mb, disk_free_mb, queue_depth, gpus_json)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        rusqlite::params![ahora(), s.cpu_pct, s.ram_used_mb, s.disk_free_mb, s.queue_depth, gpus_json],
    );
    // Poda en el mismo tick: una tabla que crece sin límite es peor que
    // gastar un DELETE barato una vez por minuto.
    let hace_7_dias = ahora() - 7 * 24 * 3600;
    let _ = c.execute("DELETE FROM telemetry_historial WHERE created_at < ?1", [hace_7_dias]);
}

/// `rango` es `"1h"`, `"24h"` o `"7d"` — cualquier otro valor cae a 24h.
pub fn historial(app: &App, rango: &str) -> Vec<lumi_proto::api::MuestraHistorial> {
    let segundos = match rango {
        "1h" => 3600,
        "7d" => 7 * 24 * 3600,
        _ => 24 * 3600,
    };
    let desde = ahora() - segundos;
    let c = app.store.conn();
    let Ok(mut q) = c.prepare(
        "SELECT created_at, cpu_pct, ram_used_mb, disk_free_mb, queue_depth, gpus_json
         FROM telemetry_historial WHERE created_at >= ?1 ORDER BY created_at",
    ) else {
        return vec![];
    };
    q.query_map([desde], |r| {
        let gpus_json: String = r.get(5)?;
        Ok(lumi_proto::api::MuestraHistorial {
            created_at: r.get(0)?,
            cpu_pct: r.get(1)?,
            ram_used_mb: r.get(2)?,
            disk_free_mb: r.get(3)?,
            queue_depth: r.get(4)?,
            gpus: serde_json::from_str(&gpus_json).unwrap_or_default(),
        })
    })
    .map(|it| it.flatten().collect())
    .unwrap_or_default()
}
