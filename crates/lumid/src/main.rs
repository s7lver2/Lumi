mod limits;
mod assets;
mod exif;
mod hardware;
mod hardware_cpu;
mod actualizacion;
mod agentar;
mod indices;
mod logging;
mod mantenimiento;
mod master;
mod perfil;
mod politicas;
mod projects;
mod qdrant;
mod queue;
mod quic;
mod recuperar;
mod red;
mod routes;
mod store;
mod tasks;
mod telemetry;
mod tls;
mod verificar;
mod zero_trust;

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
    /// Epoch de arranque. El panel lo resta para decir «en marcha desde hace
    /// 6 d 04 h»; calcularlo en el cliente obligaría a confiar en su reloj.
    pub arrancado_en: i64,
    /// `sysinfo` calcula el % de CPU por diferencia entre dos lecturas: un
    /// `System` nuevo en cada muestra siempre daría 0%, en cualquier
    /// plataforma. Se mantiene vivo entre muestras para que la diferencia
    /// exista.
    pub sysinfo: Arc<Mutex<sysinfo::System>>,
    /// La cola vive tanto como el daemon. Sus trabajadores son procesos hijo
    /// con `kill_on_drop`, así que mueren con él y no dejan VRAM ocupada.
    pub queue: Arc<queue::Queue>,
    /// Un solo hueco de instalación de índice a la vez. `None` es "nunca se
    /// ha instalado nada en esta sesión del daemon", no "hay un error".
    pub indices_en_curso: indices::EnCurso,
    /// Un solo tipo de evento hoy (`EventoAdmin::SolicitudCredito`). Igual
    /// que `queue::Queue.difusion`, pero sin actor propio: no hace falta
    /// nada más que un canal de difusión, así que no se crea una estructura
    /// para envolverlo.
    pub admin_eventos: tokio::sync::broadcast::Sender<lumi_proto::api::EventoAdmin>,
    /// Cambia qué se escribe al log en caliente, sin reiniciar el daemon —
    /// ver `logging.rs`. `Handle` ya es barato de clonar (es un `Arc` por
    /// dentro), así que no hace falta envolverlo aparte.
    pub log_filter: tracing_subscriber::reload::Handle<tracing_subscriber::EnvFilter, tracing_subscriber::Registry>,
}

// Explícito y no el valor por defecto de la macro: en la VM de producción
// hay 2 CPUs, así que tokio ya arrancaría con 2 hilos de trabajo por su
// cuenta — se deja escrito como decisión, no como casualidad, y es el
// único sitio a tocar si el host algún día tiene más núcleos. El trabajo
// que de verdad bloquea (NVML, sysinfo, decodificar imágenes, sysfs) no
// compite por estos hilos: corre en el pool de `spawn_blocking`, aparte.
#[tokio::main(flavor = "multi_thread", worker_threads = 2)]
async fn main() -> anyhow::Result<()> {
    // rustls 0.23 enlaza tanto `ring` como `aws-lc-rs` en cuanto dos
    // dependencias del árbol (aquí, axum-server y reqwest) piden rustls sin
    // desactivar sus features por defecto: con los dos presentes, rustls ya
    // no puede elegir uno solo por su cuenta y el arranque del TLS entra en
    // panic. Se fija aquí, una vez, antes de tocar nada de red.
    rustls::crypto::ring::default_provider().install_default().ok();
    let dir = PathBuf::from(std::env::var("LUMI_DATA").unwrap_or_else(|_| "/var/lib/lumi".into()));
    std::fs::create_dir_all(&dir)?;
    // Antes de nada más: el filtro inicial se construye a partir de lo que
    // haya guardado en `meta` (Doctor > Logs > Ajustes), y para eso hace
    // falta la base de datos ya abierta.
    let store = Arc::new(store::Store::open(&dir)?);

    // Sin `with_ansi(false)` en la capa de formato, `tracing_subscriber`
    // decide colorear según crea que su salida es una terminal — y bajo
    // systemd, journald, o un pipe hacia `journalctl -f`, esa detección
    // puede salir que sí, dejando códigos de escape ANSI escritos tal cual
    // en el journal para siempre. La pestaña Doctor (`routes::logs::stream`)
    // reenvía esas líneas crudas y las colorea ella misma por nivel — los
    // códigos de escape del propio proceso solo estorban ahí.
    //
    // El filtro va detrás de una `reload::Layer`: es lo que permite que
    // Doctor > Logs > Ajustes cambie qué se escribe sin reiniciar el
    // daemon — `app.log_filter.reload(...)` sustituye el filtro entero en
    // caliente.
    use tracing_subscriber::layer::SubscriberExt;
    use tracing_subscriber::util::SubscriberInitExt;
    let filtro_inicial = logging::construir_filtro(&store);
    let (filtro_capa, log_filter) =
        tracing_subscriber::reload::Layer::new(tracing_subscriber::EnvFilter::new(&filtro_inicial));
    tracing_subscriber::registry()
        .with(filtro_capa)
        .with(tracing_subscriber::fmt::layer().with_ansi(false))
        .init();
    tracing::info!("nivel de log inicial: {filtro_inicial}");

    let (tls_cfg, fingerprint) = tls::load(&dir).await?;
    let gpus = gpus();
    // Antes se creaba después de `Queue::arrancar` — la cola necesita este
    // remitente para avisar a la página de Cola cuando algo cambia
    // (`EventoAdmin::ColaCambio`), así que tiene que existir primero.
    let (admin_eventos, _) = tokio::sync::broadcast::channel(64);
    let queue = queue::Queue::arrancar(store.clone(), dir.clone(), &gpus, admin_eventos.clone());
    let app = App {
        store,
        fingerprint,
        mode: if std::path::Path::new("/.dockerenv").exists() { Mode::Docker } else { Mode::Native },
        gpus,
        master: Arc::new(RwLock::new(master::load_at_boot(&dir))),
        dir: dir.clone(),
        arrancado_en: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0),
        sysinfo: Arc::new(Mutex::new(sysinfo::System::new_all())),
        queue,
        indices_en_curso: Arc::new(Mutex::new(None)),
        admin_eventos,
        log_filter,
    };

    // LUMI_PORT (env) es la escotilla de emergencia: gana siempre sobre lo
    // guardado en `meta`, igual que ya ganaba sobre la constante fija antes
    // de que existiera un ajuste editable desde el panel.
    let port: u16 = std::env::var("LUMI_PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or_else(|| red::leer(&app.store).bind_port);

    tokio::spawn({
        let app = app.clone();
        async move {
            hardware::reaplicar_al_arrancar(&app).await;
            hardware_cpu::reaplicar_al_arrancar(&app).await;
        }
    });

    tokio::spawn(telemetry::muestrear_historial(app.clone()));
    tokio::spawn(actualizacion::tick(app.clone()));

    tokio::spawn({
        let app = app.clone();
        async move {
            if let Err(e) = quic::arrancar_si_procede(app).await {
                tracing::warn!("no se pudo levantar el listener QUIC: {e}");
            }
        }
    });

    use axum::routing::post;
    let router = Router::new()
        .route("/v1/hello", get(routes::hello::get))
        .route("/v1/policies", get(routes::policies::get_public))
        .route("/v1/server-profile", get(routes::perfil::get_public))
        .route("/v1/server-profile/avatar", get(routes::perfil::ver_avatar_servidor))
        .route("/v1/server-profile/banner", get(routes::perfil::ver_banner_servidor))
        .route("/v1/catalogo/grafo", get(routes::catalogo::resolver_grafo))
        .route("/v1/indices", get(routes::indices::listar).post(routes::indices::instalar))
        .route("/v1/indices/eventos", get(routes::indices::eventos))
        .route("/v1/indices/:paquete", axum::routing::delete(routes::indices::desinstalar))
        .route("/v1/claim", post(routes::claim::claim))
        .route("/v1/admin", post(routes::claim::create_admin))
        .route("/v1/auth/login", post(routes::auth::login))
        .route("/v1/auth/me", get(routes::auth::me))
        .route("/v1/unseal", post(routes::auth::unseal))
        .route("/v1/tasks", post(routes::tasks::create))
        .route("/v1/tasks/:id", get(routes::tasks::get))
        .route("/v1/tasks/:id/log", get(routes::tasks::log_sse))
        .route("/v1/telemetry", get(routes::telemetry::sse))
        .route("/v1/queue/events", get(routes::queue::events))
        .route("/v1/queue", get(routes::queue::view))
        .route("/v1/access-requests", post(routes::access::create))
        .route("/v1/access-requests/status", get(routes::access::status))
        .route("/v1/accounts", post(routes::access::create_account))
        .route("/v1/auth/change-password", post(routes::auth::change_password))
        .route("/v1/me/sessions", get(routes::auth::my_sessions))
        .route(
            "/v1/me/avatar",
            post(routes::perfil::subir_mi_avatar).delete(routes::perfil::borrar_mi_avatar),
        )
        .route("/v1/users/:id/avatar", get(routes::perfil::ver_avatar_usuario))
        .route("/v1/sessions/:public_id", axum::routing::delete(routes::auth::revoke_session))
        .route("/v1/admin/access-requests", get(routes::admin::list_requests))
        .route("/v1/admin/access-requests/:id/resolve", post(routes::admin::resolve_request))
        .route("/v1/me/credit-requests", post(routes::credit_requests::create))
        .route("/v1/admin/credit-requests", get(routes::credit_requests::list_all))
        .route("/v1/admin/credit-requests/:id/resolve", post(routes::credit_requests::resolve))
        .route("/v1/admin/events", get(routes::admin::events))
        .route("/v1/admin/users", get(routes::admin::list_users))
        .route("/v1/admin/users/:id", get(routes::admin::get_user).patch(routes::admin::patch_user))
        .route("/v1/admin/limits", get(routes::admin::get_limits).patch(routes::admin::patch_limits))
        .route("/v1/admin/resumen", get(routes::admin::resumen))
        .route("/v1/admin/actividad", get(routes::actividad::get))
        .route(
            "/v1/admin/network",
            get(routes::network::get).patch(routes::network::patch),
        )
        .route("/v1/admin/network/restart", post(routes::network::restart))
        .route(
            "/v1/admin/policies",
            get(routes::policies::get_admin).patch(routes::policies::patch),
        )
        .route(
            "/v1/admin/server-profile",
            get(routes::perfil::get_admin).patch(routes::perfil::patch),
        )
        .route(
            "/v1/admin/server-profile/avatar",
            post(routes::perfil::subir_avatar_servidor).delete(routes::perfil::borrar_avatar_servidor),
        )
        .route(
            "/v1/admin/server-profile/banner",
            post(routes::perfil::subir_banner_servidor).delete(routes::perfil::borrar_banner_servidor),
        )
        .route("/v1/admin/hardware", get(routes::hardware::listar))
        .route("/v1/admin/hardware/:index", axum::routing::patch(routes::hardware::aplicar))
        .route("/v1/admin/hardware/cpu", get(routes::hardware_cpu::leer).patch(routes::hardware_cpu::aplicar))
        .route("/v1/admin/telemetry/salud", get(routes::doctor::salud))
        .route("/v1/admin/telemetry/historial", get(routes::doctor::historial))
        .route("/v1/admin/doctor/arreglar/trabajador/:dispositivo", post(routes::doctor::arreglar_trabajador))
        .route("/v1/admin/doctor/arreglar/qdrant", post(routes::doctor::arreglar_qdrant))
        .route("/v1/admin/logs/stream", get(routes::logs::stream))
        .route("/v1/admin/logging", get(routes::logs::ajustes_get).patch(routes::logs::ajustes_patch))
        .route("/v1/admin/provisioning/complete", post(routes::admin::provisionar))
        .route("/v1/admin/models/accept-licenses", post(routes::models::accept_licenses))
        .route("/v1/admin/models/download", post(routes::models::download))
        .route("/v1/admin/model-task", get(routes::models::model_task))
        .route("/v1/admin/models", get(routes::models::estado))
        .route("/v1/admin/models/provider-token", get(routes::models::get_provider_token).patch(routes::models::set_provider_token))
        .route("/v1/admin/models/metadata", get(routes::models::metadatos))
        .route("/v1/me/api-keys", get(routes::api_keys::list_mine))
        .route("/v1/admin/api-keys", get(routes::api_keys::list_all))
        .route("/v1/api-keys", post(routes::api_keys::create))
        .route(
            "/v1/api-keys/:public_id",
            axum::routing::delete(routes::api_keys::revoke).patch(routes::api_keys::patch_ips),
        )
        .route("/v1/admin/security", get(routes::security::get_security).patch(routes::security::patch_security))
        .route(
            "/v1/admin/security/allowlist",
            post(routes::security::add_allow).delete(routes::security::remove_allow),
        )
        .route(
            "/v1/admin/security/denylist",
            post(routes::security::add_deny).delete(routes::security::remove_deny),
        )
        .route("/v1/admin/avisos", get(routes::avisos::list_all).post(routes::avisos::create))
        .route("/v1/avisos/:id", axum::routing::delete(routes::avisos::remove))
        .route("/v1/projects", get(routes::projects::list).post(routes::projects::create))
        .route(
            "/v1/projects/:id",
            axum::routing::patch(routes::projects::rename).delete(routes::projects::remove),
        )
        .route(
            "/v1/projects/:id/members",
            get(routes::projects::members).post(routes::projects::add_member),
        )
        .route(
            "/v1/projects/:id/members/:user_id",
            axum::routing::delete(routes::projects::remove_member),
        )
        .route("/v1/me/invites", get(routes::projects::my_invites))
        .route("/v1/invites/:id/accept", post(routes::projects::accept_invite))
        .route("/v1/invites/:id/decline", post(routes::projects::decline_invite))
        .route("/v1/projects/:id/enter", post(routes::projects::enter))
        .route("/v1/projects/:id/leave", post(routes::projects::leave))
        .route("/v1/projects/:id/images", get(routes::images::project_gallery))
        .route(
            "/v1/projects/:id/cases",
            get(routes::cases::list).post(routes::cases::create),
        )
        .route(
            "/v1/cases/:id",
            axum::routing::patch(routes::cases::rename).delete(routes::cases::remove),
        )
        .route(
            "/v1/cases/:id/images",
            get(routes::images::list).post(routes::images::upload),
        )
        .route(
            "/v1/images/:id",
            get(routes::images::serve_full).delete(routes::images::remove),
        )
        .route("/v1/images/:id/thumb", get(routes::images::serve_thumb))
        .route("/v1/cases/:id/images/reuse", post(routes::images::reuse))
        .route("/v1/me/usage", get(routes::images::my_usage))
        .route(
            "/v1/cases/:id/analyses",
            get(routes::analyses::list).post(routes::analyses::create),
        )
        .route(
            "/v1/analyses/:id",
            get(routes::analyses::get_one).delete(routes::analyses::remove),
        )
        .route("/v1/map/themes", get(routes::map::themes))
        .route("/v1/map/config", get(routes::map::config))
        .route("/v1/map/style", get(routes::map::style))
        .route("/v1/map/tiles/:z/:x/:y", get(routes::map::tile))
        .route("/v1/map/glyphs/:fontstack/:range", get(routes::map::glyphs))
        .route("/v1/map/sprite/:theme/:file", get(routes::map::sprite))
        .route("/v1/admin/map", axum::routing::patch(routes::map::patch_admin))
        .route("/v1/users/search", get(routes::projects::search_users));

    let capa_zero_trust = axum::middleware::from_fn_with_state(app.clone(), zero_trust::zero_trust_gate);
    let capa_mantenimiento = axum::middleware::from_fn_with_state(app.clone(), mantenimiento::mantenimiento_gate);
    let router = router.layer(capa_zero_trust).layer(capa_mantenimiento).with_state(app);

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

