//! Rendimiento LOCAL: la GPU, si hay una NVIDIA, y nada más.
//!
//! No hay servidor que preguntar —el Indexer es de un solo operador en su
//! propia máquina—, así que esto lee `nvidia-smi` directamente. `None`/lista
//! vacía no es un error: no tener `nvidia-smi` en el `PATH` (sin GPU NVIDIA,
//! o un equipo solo de CPU) es el caso normal, no uno raro.

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct Gpu {
    pub nombre: String,
    pub util_pct: u32,
    pub vram_usada_mb: u32,
    pub vram_total_mb: u32,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct Rendimiento {
    pub gpus: Vec<Gpu>,
}

/// Bloqueante a propósito (lanza un proceso y espera): se llama desde
/// `spawn_blocking`, nunca directamente desde un comando async.
pub fn leer() -> Rendimiento {
    let salida = crate::proceso::cmd("nvidia-smi")
        .args([
            "--query-gpu=name,utilization.gpu,memory.used,memory.total",
            "--format=csv,noheader,nounits",
        ])
        .output();
    let Ok(salida) = salida else { return Rendimiento::default() };
    if !salida.status.success() {
        return Rendimiento::default();
    }
    let texto = String::from_utf8_lossy(&salida.stdout);
    let gpus = texto
        .lines()
        .filter_map(|linea| {
            let campos: Vec<&str> = linea.split(',').map(str::trim).collect();
            if campos.len() < 4 {
                return None;
            }
            Some(Gpu {
                nombre: campos[0].to_string(),
                util_pct: campos[1].parse().ok()?,
                vram_usada_mb: campos[2].parse().ok()?,
                vram_total_mb: campos[3].parse().ok()?,
            })
        })
        .collect();
    Rendimiento { gpus }
}
