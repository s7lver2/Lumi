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
    /// Opcional: el CLI y las pruebas por curl no lo mandan.
    #[serde(default)]
    pub device: Option<DeviceInfo>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct LoginRes {
    pub token: String,
    pub username: String,
    pub is_admin: bool,
    /// Si es `true`, el token solo sirve para `POST /v1/auth/change-password`.
    pub must_change_password: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ChangePasswordReq {
    pub current: String,
    pub new: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SessionInfo {
    pub public_id: String,
    pub device_name: Option<String>,
    pub os: Option<String>,
    pub created_at: i64,
    pub last_seen: i64,
    pub current: bool,
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

/// Las seis palancas de la spec. Se serializa entera hacia el cliente; se
/// almacena descompuesta en filas clave/valor para poder anular una sola.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Limits {
    pub models: Vec<String>,
    pub max_concurrent: i64,
    pub max_daily: i64,
    pub max_storage_gb: i64,
    pub queue_priority: i64,
    pub can_create_projects: bool,
    /// Si su trabajo pendiente sigue avanzando cuando se desconecta. Con esto
    /// apagado, lo pendiente de quien se va se queda quieto hasta que vuelve;
    /// con ello encendido avanza, pero siempre por detrás de quien sí está
    /// delante de la pantalla. Lo que YA está corriendo termina en los dos
    /// casos: el cómputo gastado no se tira.
    pub background_jobs: bool,
}

impl Default for Limits {
    fn default() -> Self {
        Self {
            models: vec!["mini".into()],
            max_concurrent: 2,
            max_daily: 50,
            max_storage_gb: 20,
            queue_priority: 0,
            can_create_projects: true,
            // Apagado por defecto: que el administrador lo *pueda* habilitar,
            // no que esté habilitado sin que nadie lo decida.
            background_jobs: false,
        }
    }
}

/// Identidad del equipo desde el que se inicia sesión. Registro PASIVO: audita
/// y permite revocar, NO autentica. Copiar el fichero del cliente copia la
/// identidad, y eso es a propósito.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceInfo {
    pub client_id: String,
    pub name: String,
    pub os: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AccessReq {
    pub display_name: String,
    pub message: String,
}

/// El ticket se devuelve UNA sola vez. El servidor guarda su hash.
#[derive(Debug, Serialize, Deserialize)]
pub struct AccessRes {
    pub ticket: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AccessStatus {
    /// pending | approved | rejected
    pub status: String,
    pub display_name: String,
    /// Motivo del rechazo, escrito por el admin. Se muestra tal cual.
    pub reason: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AccountReq {
    pub username: String,
    pub password: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AdminRequest {
    pub id: i64,
    pub display_name: String,
    pub message: String,
    pub source_ip: String,
    /// La solicitud viene de fuera del rango privado. Lo calcula el servidor
    /// para que la interfaz no tenga que saber de rangos de red.
    pub external: bool,
    pub status: String,
    pub reason: Option<String>,
    pub created_at: i64,
    pub expires_at: i64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ResolveReq {
    pub approve: bool,
    #[serde(default)]
    pub reason: Option<String>,
    /// Solo al aprobar. Vacío o ausente: hereda los modelos del global.
    #[serde(default)]
    pub granted_models: Option<Vec<String>>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AdminUser {
    pub id: i64,
    pub username: String,
    pub display_name: Option<String>,
    pub is_admin: bool,
    pub blocked: bool,
    pub must_change_password: bool,
    pub created_at: i64,
    /// Lo que rige de verdad para este usuario.
    pub limits: Limits,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DeviceRow {
    pub name: String,
    pub os: Option<String>,
    pub first_seen: i64,
    pub last_seen: i64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct UserDetail {
    pub user: AdminUser,
    /// Los valores del servidor, para poder decir "anulado · global 50".
    pub global: Limits,
    /// Solo las palancas anuladas para este usuario.
    pub overrides: std::collections::HashMap<String, serde_json::Value>,
    pub devices: Vec<DeviceRow>,
    pub sessions: Vec<SessionInfo>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PatchUserReq {
    #[serde(default)]
    pub blocked: Option<bool>,
    #[serde(default)]
    pub must_change_password: Option<bool>,
    /// Palanca → valor. `null` como valor QUITA la anulación: el usuario
    /// vuelve a heredar del global. Es la única forma de volver atrás.
    #[serde(default)]
    pub limits: std::collections::HashMap<String, serde_json::Value>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PatchLimitsReq {
    pub limits: std::collections::HashMap<String, serde_json::Value>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Project {
    pub id: i64,
    pub name: String,
    pub role: String,
    pub cases: i64,
    pub images: i64,
    pub bytes: i64,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ProjectMember {
    pub user_id: i64,
    pub username: String,
    pub role: String,
    /// `pending` hasta que la invitada la acepta desde `/v1/me/invites`.
    /// El dueño nace `accepted`: invitarse a sí mismo no tendría sentido.
    pub status: String,
    pub added_at: i64,
}

/// Crear y renombrar comparten cuerpo: solo llevan nombre.
#[derive(Serialize, Deserialize)]
pub struct NameReq {
    pub name: String,
}

#[derive(Serialize, Deserialize)]
pub struct MemberReq {
    pub username: String,
}

/// Lo que `GET /v1/users/search` sugiere mientras se escribe un nombre para
/// invitar. Solo el id y el nombre: nada que un investigador no debiera ver
/// de otra cuenta.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct UserSummary {
    pub id: i64,
    pub username: String,
}

/// Lo que `/v1/me/invites` contesta: una invitación por proyecto, pendiente
/// de aceptar. Entrar a un proyecto sin haber aceptado no es un descuido que
/// arreglar en silencio, es un permiso que alguien más no ha dado todavía.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Invite {
    pub project_id: i64,
    pub project_name: String,
    pub invited_by: String,
    pub added_at: i64,
}

#[derive(Serialize, Deserialize)]
pub struct ReuseReq {
    pub image_id: i64,
}

/// Una imagen de OTRO caso del mismo proyecto, para el mosaico de "ya subidas
/// al proyecto" del destino de arrastre.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ProjectImage {
    #[serde(flatten)]
    pub image: Image,
    pub case_name: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Case {
    pub id: i64,
    pub project_id: i64,
    pub name: String,
    pub images: i64,
    pub analyses: i64,
    /// Análisis con resultado. La vista de proyecto pinta un marcador por caso
    /// resuelto, y necesita saber si hay alguno sin traerse la lista entera.
    pub resolved: i64,
    /// Del análisis resuelto más reciente, para el marcador. `None` mientras
    /// no haya motor.
    pub lat: Option<f64>,
    pub lng: Option<f64>,
    pub created_at: i64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Image {
    pub id: i64,
    pub case_id: i64,
    pub filename: String,
    pub bytes: i64,
    pub width: Option<i64>,
    pub height: Option<i64>,
    pub mime: String,
    /// GPS DECLARADO por la cámara. Nunca se mezcla con el inferido.
    pub exif_lat: Option<f64>,
    pub exif_lng: Option<f64>,
    pub exif: Option<serde_json::Value>,
    pub created_at: i64,
}

/// Cuánto ocupa este usuario y cuánto le dejan.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Usage {
    pub used_bytes: i64,
    pub limit_gb: i64,
    /// `true` si el tope viene de una anulación propia, `false` si se hereda
    /// del global. Un límite sin origen visible es indepurable cuando alguien
    /// pregunta por qué no le caben más imágenes.
    pub overridden: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Analysis {
    pub id: i64,
    pub case_id: i64,
    pub model: String,
    /// `pendiente` | `en_curso` | `hecho` | `error`. Este subsistema solo
    /// escribe `pendiente`: mover de ahí es trabajo de la cola (subsistema 4).
    pub state: String,
    pub error: Option<String>,
    pub result_lat: Option<f64>,
    pub result_lng: Option<f64>,
    pub result_radius_m: Option<f64>,
    pub result_confidence: Option<f64>,
    /// Siempre una imagen hoy. La lista existe desde el primer día para que la
    /// cola no haya que rehacerla cuando un análisis agrupe varias tomas.
    pub image_ids: Vec<i64>,
    /// Las hipótesis que no ganaron, en orden. La principal NO está aquí:
    /// sigue en `result_*`. Vacía y no `null` cuando no hay ninguna, para que
    /// el cliente no tenga dos casos donde hay uno.
    #[serde(default)]
    pub hypotheses: Vec<crate::worker::Hipotesis>,
    /// El nivel que realmente corrió si hubo descenso por capas que faltaban.
    /// `None` significa «el que se pidió».
    #[serde(default)]
    pub nivel_efectivo: Option<String>,
    /// Lo que los agentes dijeron de la imagen. Vacía y no `null` cuando no
    /// corrió ninguno, para que el cliente no tenga dos casos donde hay uno.
    #[serde(default)]
    pub agentes: Vec<DichoDeAgente>,
    pub created_at: i64,
    pub finished_at: Option<i64>,
}

/// Un veredicto tal como se guardó. `etiqueta` vale `abstiene` cuando el
/// agente no llegó a su umbral: corrió, y no vio suficiente.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DichoDeAgente {
    pub agente: String,
    pub nombre: String,
    pub etiqueta: String,
    pub confianza: f64,
    /// `filtra` o `describe`.
    pub tipo: String,
    #[serde(default)]
    pub detalle: String,
}

#[derive(Serialize, Deserialize)]
pub struct AnalysisReq {
    pub image_ids: Vec<i64>,
    pub model: String,
}

/// Lo que el cliente puede saber del mapa. **Nunca incluye la clave.**
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct MapConfig {
    /// `mapbox` | `osm` | `none`
    pub provider: String,
    /// El tema elegido del catálogo (`GET /v1/map/themes`), o `None` si nadie
    /// ha elegido ninguno todavía.
    pub theme: Option<String>,
    /// `true` si hay clave guardada. Con el motor `maplibre` el valor no sale
    /// de aquí jamás; con `mapbox` sí, y va en `key` — ver abajo.
    pub has_key: bool,
    /// Por qué el mapa no está disponible, si no lo está. Nada de lienzo en
    /// blanco ni de spinner eterno.
    pub reason: Option<String>,
    /// Quién dibuja: `maplibre` (por defecto) o `mapbox`.
    ///
    /// No es una preferencia estética, es un compromiso de seguridad que elige
    /// el administrador. Con `maplibre` el daemon hace de proxy de teselas,
    /// tipografías e iconos, y la clave no sale del servidor. Con `mapbox` el
    /// SDK oficial habla directamente con la API de Mapbox y la firma **en el
    /// cliente**, así que la clave tiene que viajar a cada equipo: quien la
    /// extraiga del tráfico gasta la cuota del owner.
    pub engine: String,
    /// La clave, SOLO con `engine = "mapbox"`. Con `maplibre` es siempre
    /// `None`: no hay ningún motivo para que el cliente la vea.
    pub key: Option<String>,
    /// El estilo tal cual lo publica el proveedor, SOLO con `engine =
    /// "mapbox"`. Su SDK entiende el esquema `mapbox://` y no pasa por
    /// nuestro proxy, así que no hay nada que reescribir.
    pub style: Option<String>,
}

/// Un tema del catálogo cerrado que ofrece `GET /v1/map/themes`. Ya no se
/// pega una URL de estilo a mano: se elige de esta lista, así que un enlace
/// mal copiado de Mapbox Studio deja de ser una forma de romper el mapa.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct MapTheme {
    pub id: String,
    pub label: String,
    pub needs_key: bool,
}

#[derive(Serialize, Deserialize)]
pub struct MapConfigReq {
    /// El `id` de uno de los temas de `GET /v1/map/themes`.
    pub theme: String,
    /// `None` deja la clave como estaba; `Some("")` la borra.
    pub key: Option<String>,
    /// `maplibre` | `mapbox`. `None` deja el motor como estaba.
    pub engine: Option<String>,
}

/// Lo que se retransmite por el SSE de la cola. El progreso va por aquí y NO se
/// escribe en ninguna parte: persistirlo es lo único que rompería el mutex
/// único de SQLite, así que se emite y se olvida.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "tipo", rename_all = "lowercase")]
pub enum Cambio {
    Estado {
        /// A quién pertenece. Se filtra en el servidor y no se envía: el
        /// cliente no necesita su propio id para nada.
        #[serde(skip)]
        user_id: i64,
        analysis_id: i64,
        case_id: i64,
        estado: String,
    },
    Progreso {
        #[serde(skip)]
        user_id: i64,
        analysis_id: i64,
        fase: String,
        pct: u8,
    },
}

impl Cambio {
    pub fn user_id(&self) -> i64 {
        match self {
            Cambio::Estado { user_id, .. } | Cambio::Progreso { user_id, .. } => *user_id,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkerView {
    pub dispositivo: String,
    /// El modelo cargado ahora mismo. `null` mientras arranca o entre cambios.
    pub modelo: Option<String>,
    /// El análisis que tiene en la mano, si tiene alguno.
    pub trabajo: Option<i64>,
    /// Si ya dijo `listo`. Uno que no lo ha dicho está cargando, no colgado.
    pub listo: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueueView {
    pub pendientes: u32,
    pub en_curso: u32,
    pub trabajadores: Vec<WorkerView>,
}
