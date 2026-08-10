//! Detección de entorno y hardware. Corre antes de emitir la clave: si el
//! host no puede ejecutar nada, el instalador falla aquí y no se llega a
//! instalar el cliente para descubrirlo.
//!
//! No necesita torch ni Python: NVML y /proc bastan.

use lumi_proto::api::GpuInfo;
use std::net::TcpListener;
use std::process::Command;

pub struct Env {
    pub os: String,
    pub kernel: String,
    pub systemd: Option<String>,
    pub driver: Option<String>,
    // ponytail: se detecta y se guarda, pero nada lo lee todavía — la versión
    // de CUDA no es una de las condiciones que hoy hacen fallar el instalador.
    // Queda aquí para cuando haga falta sin repetir la detección.
    #[allow(dead_code)]
    pub cuda: Option<String>,
    pub disk_free_mb: u64,
    pub port_free: bool,
    pub ufw_active: bool,
}

fn first_line(cmd: &str, args: &[&str]) -> Option<String> {
    let out = Command::new(cmd).args(args).output().ok()?;
    if !out.status.success() {
        return None;
    }
    String::from_utf8_lossy(&out.stdout)
        .lines()
        .next()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

pub fn env() -> Env {
    let os = std::fs::read_to_string("/etc/os-release")
        .ok()
        .and_then(|s| {
            s.lines()
                .find_map(|l| l.strip_prefix("PRETTY_NAME=").map(|v| v.trim_matches('"').to_string()))
        })
        .unwrap_or_else(|| "desconocido".into());

    let mut sys = sysinfo::Disks::new_with_refreshed_list();
    sys.refresh();
    // ponytail: el disco de /var/lib basta; si el despliegue usa otro punto de
    // montaje para los modelos, se añade un segundo chequeo cuando exista.
    let disk_free_mb = sys
        .list()
        .iter()
        .filter(|d| "/var/lib/lumi".starts_with(&*d.mount_point().to_string_lossy()))
        .map(|d| d.available_space() / 1024 / 1024)
        .max()
        .unwrap_or(0);

    Env {
        os,
        kernel: first_line("uname", &["-r"]).unwrap_or_else(|| "desconocido".into()),
        systemd: first_line("systemctl", &["--version"])
            .and_then(|l| l.split_whitespace().nth(1).map(str::to_string)),
        driver: first_line(
            "nvidia-smi",
            &["--query-gpu=driver_version", "--format=csv,noheader"],
        ),
        cuda: first_line("nvidia-smi", &["--query-gpu=name", "--format=csv,noheader"])
            .and(first_line("nvcc", &["--version"]))
            .or_else(|| {
                first_line("nvidia-smi", &[]).and_then(|_| {
                    Command::new("nvidia-smi")
                        .output()
                        .ok()
                        .and_then(|o| {
                            String::from_utf8_lossy(&o.stdout)
                                .split("CUDA Version:")
                                .nth(1)
                                .and_then(|s| s.split_whitespace().next())
                                .map(str::to_string)
                        })
                })
            }),
        disk_free_mb,
        port_free: TcpListener::bind(("0.0.0.0", lumi_proto::PORT)).is_ok(),
        ufw_active: first_line("ufw", &["status"])
            .map(|l| l.contains("active"))
            .unwrap_or(false),
    }
}

pub fn gpus() -> Vec<GpuInfo> {
    let Ok(nvml) = nvml_wrapper::Nvml::init() else {
        return vec![];
    };
    let count = nvml.device_count().unwrap_or(0);
    (0..count)
        .filter_map(|i| {
            let d = nvml.device_by_index(i).ok()?;
            Some(GpuInfo {
                index: i,
                name: d.name().unwrap_or_else(|_| "GPU".into()),
                vram_total_mb: d.memory_info().ok()?.total / 1024 / 1024,
                pcie: d.pci_info().ok()?.bus_id,
            })
        })
        .collect()
}

/// El kernel de WSL2 se anuncia como `...-microsoft-standard-WSL2`. En WSL2
/// el driver NVIDIA vive en Windows, no dentro de la distro: instalar un
/// paquete `nvidia-driver-*` aquí no engancharía ninguna GPU real.
pub fn is_wsl(kernel: &str) -> bool {
    kernel.to_lowercase().contains("microsoft")
}

pub fn has_cmd(cmd: &str) -> bool {
    Command::new("which").arg(cmd).output().is_ok_and(|o| o.status.success())
}

pub fn cpu_summary() -> String {
    let mut s = sysinfo::System::new();
    s.refresh_cpu_all();
    s.refresh_memory();
    let brand = s
        .cpus()
        .first()
        .map(|c| c.brand().trim().to_string())
        .unwrap_or_else(|| "CPU".into());
    format!(
        "{brand} · {}t · {} GB RAM",
        s.cpus().len(),
        s.total_memory() / 1024 / 1024 / 1024
    )
}
