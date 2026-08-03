mod master;
mod routes;
mod store;
mod tls;

use axum::{routing::get, Router};
use lumi_proto::api::GpuInfo;
use lumi_proto::caps::Mode;
use lumi_proto::crypto::MasterKey;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::RwLock;

#[derive(Clone)]
pub struct App {
    pub store: Arc<store::Store>,
    pub fingerprint: String,
    pub mode: Mode,
    pub gpus: Vec<GpuInfo>,
    /// `None` significa bloqueado. La telemetría sigue funcionando igual:
    /// no depende de la maestra, y que siga viva demuestra que la máquina
    /// está sana y solo falta desbloquear.
    pub master: Arc<RwLock<Option<MasterKey>>>,
    pub dir: PathBuf,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt::init();
    let dir = PathBuf::from(std::env::var("LUMI_DATA").unwrap_or_else(|_| "/var/lib/lumi".into()));
    std::fs::create_dir_all(&dir)?;

    let (tls_cfg, fingerprint) = tls::load(&dir).await?;
    let app = App {
        store: Arc::new(store::Store::open(&dir)?),
        fingerprint,
        mode: if std::path::Path::new("/.dockerenv").exists() { Mode::Docker } else { Mode::Native },
        gpus: gpus(),
        master: Arc::new(RwLock::new(master::load_at_boot(&dir))),
        dir: dir.clone(),
    };

    let router = Router::new()
        .route("/v1/hello", get(routes::hello::get))
        .route("/v1/unseal", axum::routing::post(routes::auth::unseal))
        .with_state(app);

    let port: u16 = std::env::var("LUMI_PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(lumi_proto::PORT);
    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    tracing::info!("lumid escuchando en https://{addr}");
    axum_server::bind_rustls(addr, tls_cfg)
        .serve(router.into_make_service())
        .await?;
    Ok(())
}

fn gpus() -> Vec<GpuInfo> {
    let Ok(nvml) = nvml_wrapper::Nvml::init() else { return vec![] };
    (0..nvml.device_count().unwrap_or(0))
        .filter_map(|i| {
            let d = nvml.device_by_index(i).ok()?;
            Some(GpuInfo {
                index: i,
                name: d.name().ok()?,
                vram_total_mb: d.memory_info().ok()?.total / 1024 / 1024,
                pcie: d.pci_info().ok()?.bus_id,
            })
        })
        .collect()
}
