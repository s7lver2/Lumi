//! Tipos del protocolo. Compilados por daemon, CLI y el lado Rust de Tauri:
//! si cambias uno y no el otro, no compila.

use crate::caps::{Capability, Mode};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DaemonState {
    Unclaimed,
    Claimed,
    Provisioning,
    Ready,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GpuInfo {
    pub index: u32,
    pub name: String,
    pub vram_total_mb: u64,
    pub pcie: String,
}

/// `GET /v1/hello`. Sin autenticación: es lo que el cliente lee antes de
/// confiar en nada. Disponible también en estado bloqueado.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Hello {
    pub version: String,
    pub state: DaemonState,
    pub mode: Mode,
    pub locked: bool,
    pub fingerprint: String,
    pub capabilities: Vec<Capability>,
    pub gpus: Vec<GpuInfo>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ClaimReq {
    pub secret: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ClaimRes {
    /// Sesión de vida corta que solo autoriza crear el primer administrador.
    pub bootstrap_token: String,
    pub expires_in_s: u32,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AdminReq {
    pub bootstrap_token: String,
    pub username: String,
    pub password: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct LoginReq {
    pub username: String,
    pub password: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct LoginRes {
    pub token: String,
    pub is_admin: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct UnsealReq {
    pub passphrase: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TaskKind {
    /// venv + torch + CUDA. El paso pesado que justifica el runner.
    InferenceRuntime,
    Database,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TaskSpec {
    pub kind: TaskKind,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskStatus {
    pub id: String,
    pub kind: TaskKind,
    pub running: bool,
    pub exit_code: Option<i32>,
    /// Bytes escritos al log. El cliente se reengancha pidiendo `?from=`.
    pub log_len: u64,
}

/// Una muestra de telemetría. Se emite por SSE cada segundo, también en
/// estado bloqueado: no depende de la clave maestra, y que siga viva
/// demuestra que la máquina está sana y solo falta desbloquear.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Sample {
    pub gpus: Vec<GpuSample>,
    pub cpu_pct: f32,
    pub ram_used_mb: u64,
    pub disk_free_mb: u64,
    pub queue_depth: u32,
    pub queue_paused: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GpuSample {
    pub index: u32,
    pub util_pct: u32,
    pub vram_used_mb: u64,
    pub vram_total_mb: u64,
    pub temp_c: Option<u32>,
}
