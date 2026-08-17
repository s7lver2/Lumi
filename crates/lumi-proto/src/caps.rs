//! Matriz de capacidades. Cada recorte lleva su motivo legible, y la interfaz
//! lo muestra allí donde la opción aparece deshabilitada. Nada desaparece en
//! silencio: un solo origen de verdad y la columna del motivo nunca vacía.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Mode {
    Native,
    Docker,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CapState {
    On,
    Partial,
    Off,
}

impl Default for CapState {
    fn default() -> Self {
        CapState::Off
    }
}

/// Lo que decide si los controles de escritura de Hardware aparecen
/// habilitados. Se calcula UNA VEZ por petición a `/v1/hello`, no en cada
/// muestra de telemetría — comprobar `nvidia-settings` de verdad tiene un
/// coste (lanza un subproceso) que no hace falta pagar cada segundo.
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

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Capability {
    pub id: String,
    pub label: String,
    pub state: CapState,
    /// Obligatorio cuando el estado no es `On`. La interfaz lo muestra tal cual.
    pub reason: Option<String>,
}

fn cap(id: &str, label: &str, state: CapState, reason: Option<&str>) -> Capability {
    Capability {
        id: id.into(),
        label: label.into(),
        state,
        reason: reason.map(str::to_string),
    }
}

pub fn matrix(mode: Mode, gpu_count: usize, qdrant_vivo: bool, hw: &HardwareCaps) -> Vec<Capability> {
    let multi = gpu_count > 1;
    let indices = cap(
        "indices",
        "Instalar índices del catálogo",
        if qdrant_vivo { CapState::On } else { CapState::Off },
        if qdrant_vivo {
            None
        } else {
            Some("Qdrant no responde en 127.0.0.1:6333. Sin él no hay dónde meter los vectores.")
        },
    );
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
    match mode {
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
        Mode::Docker => vec![
            cap(
                "shard",
                "Sharding multi-GPU",
                CapState::Off,
                Some("El contenedor solo recibe gpu0. Requiere --gpus all y acceso directo a /dev/nvidia*."),
            ),
            cap(
                "offload",
                "Offload GPU + CPU",
                CapState::Off,
                Some("Sin cpuset del host no se puede fijar afinidad de núcleos; el offload degradaría en vez de acelerar."),
            ),
            cap(
                "nvml",
                "Telemetría NVML",
                CapState::Partial,
                Some("Uso y VRAM sí; temperatura y potencia requieren --privileged."),
            ),
            cap("sealed", "Modo sellado", CapState::On, None),
            indices,
            hw_potencia,
            hw_curvas,
        ],
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn todo_recorte_lleva_motivo() {
        for mode in [Mode::Native, Mode::Docker] {
            for gpus in [1, 4] {
                for qdrant_vivo in [true, false] {
                    for c in matrix(mode, gpus, qdrant_vivo, &HardwareCaps::default()) {
                        if c.state != CapState::On {
                            assert!(
                                c.reason.as_ref().is_some_and(|r| !r.trim().is_empty()),
                                "{:?}/{gpus} GPU/qdrant={qdrant_vivo}: '{}' recortada sin motivo",
                                mode,
                                c.id
                            );
                        }
                    }
                }
            }
        }
    }
}
