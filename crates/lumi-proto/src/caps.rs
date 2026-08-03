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

pub fn matrix(mode: Mode, gpu_count: usize) -> Vec<Capability> {
    let multi = gpu_count > 1;
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
                for c in matrix(mode, gpus) {
                    if c.state != CapState::On {
                        assert!(
                            c.reason.as_ref().is_some_and(|r| !r.trim().is_empty()),
                            "{:?}/{gpus} GPU: '{}' recortada sin motivo",
                            mode,
                            c.id
                        );
                    }
                }
            }
        }
    }
}
