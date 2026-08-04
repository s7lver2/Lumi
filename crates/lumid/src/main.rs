mod limits;
mod master;
mod projects;
mod routes;
mod store;
mod tasks;
mod telemetry;
mod tls;

use axum::{routing::get, Router};
use lumi_proto::api::GpuInfo;
use lumi_proto::caps::Mode;
use lumi_proto::crypto::MasterKey;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
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
    /// `sysinfo` calcula el % de CPU por diferencia entre dos lecturas: un
    /// `System` nuevo en cada muestra siempre daría 0%, en cualquier
    /// plataforma. Se mantiene vivo entre muestras para que la diferencia
    /// exista.
    pub sysinfo: Arc<Mutex<sysinfo::System>>,
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
        sysinfo: Arc::new(Mutex::new(sysinfo::System::new_all())),
    };

    use axum::routing::post;
    let router = Router::new()
        .route("/v1/hello", get(routes::hello::get))
        .route("/v1/claim", post(routes::claim::claim))
        .route("/v1/admin", post(routes::claim::create_admin))
        .route("/v1/auth/login", post(routes::auth::login))
        .route("/v1/auth/me", get(routes::auth::me))
        .route("/v1/unseal", post(routes::auth::unseal))
        .route("/v1/tasks", post(routes::tasks::create))
        .route("/v1/tasks/:id", get(routes::tasks::get))
        .route("/v1/tasks/:id/log", get(routes::tasks::log_sse))
        .route("/v1/telemetry", get(routes::telemetry::sse))
        .route("/v1/access-requests", post(routes::access::create))
        .route("/v1/access-requests/status", get(routes::access::status))
        .route("/v1/accounts", post(routes::access::create_account))
        .route("/v1/auth/change-password", post(routes::auth::change_password))
        .route("/v1/me/sessions", get(routes::auth::my_sessions))
        .route("/v1/sessions/:public_id", axum::routing::delete(routes::auth::revoke_session))
        .route("/v1/admin/access-requests", get(routes::admin::list_requests))
        .route("/v1/admin/access-requests/:id/resolve", post(routes::admin::resolve_request))
        .route("/v1/admin/users", get(routes::admin::list_users))
        .route("/v1/admin/users/:id", get(routes::admin::get_user).patch(routes::admin::patch_user))
        .route("/v1/admin/limits", get(routes::admin::get_limits).patch(routes::admin::patch_limits))
        .with_state(app);

    let port: u16 = std::env::var("LUMI_PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(lumi_proto::PORT);
    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    tracing::info!("lumid escuchando en https://{addr}");
    axum_server::bind_rustls(addr, tls_cfg)
        .serve(router.into_make_service_with_connect_info::<SocketAddr>())
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
