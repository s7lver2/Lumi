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
    /// Necesario para poder pedir la propia foto de perfil
    /// (`GET /v1/users/:id/avatar`) sin depender de una consulta aparte.
    pub id: i64,
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

#[derive(Debug, Serialize, Clone)]
pub struct ApiKeyInfo {
    pub public_id: String,
    pub label: String,
    /// Derivado del token al leer, nunca guardado aparte: `lumi_ak_9f83…c1e2`.
    pub prefix: String,
    pub owner_username: String,
    pub owner_is_service: bool,
    pub created_at: i64,
    pub last_seen: i64,
    /// `i64::MAX` en la base de datos significa "nunca"; aquí ya sale como
    /// `None` para que el cliente no tenga que conocer el centinela.
    pub expires_at: Option<i64>,
    pub ips: Vec<String>,
    pub devices: Vec<String>,
}

#[derive(Debug, Deserialize)]
pub struct IssueApiKeyReq {
    pub label: String,
    /// A quién se emite. Ambos `None` significa "para mí mismo". Cualquiera
    /// de los dos presentes exige ser administrador.
    pub user_id: Option<i64>,
    pub service_name: Option<String>,
    /// `None` = nunca caduca.
    pub expires_in_days: Option<i64>,
    pub devices: Vec<String>,
    pub ips: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct IssuedApiKey {
    /// La clave completa. Se manda UNA VEZ; no se puede volver a pedir.
    pub key: String,
    pub info: ApiKeyInfo,
}

#[derive(Debug, Deserialize)]
pub struct PatchApiKeyReq {
    pub ips: Option<Vec<String>>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AvisoInfo {
    pub id: i64,
    /// Documento JSON de Tiptap — un `serde_json::Value` estructurado, no un
    /// `String` con HTML: así el propio esquema de Tiptap es lo único que
    /// puede llegar a pintarse, nunca markup arbitrario.
    pub contenido: serde_json::Value,
    pub icono: String,
    /// `"normal"` | `"urgente"`.
    pub prioridad: String,
    /// `"todos"` | `"admins"` | `"personas"`.
    pub destino: String,
    pub creado_por: String,
    pub created_at: i64,
}

#[derive(Debug, Deserialize)]
pub struct CrearAvisoReq {
    pub contenido: serde_json::Value,
    pub icono: String,
    pub prioridad: String,
    pub destino: String,
    /// Solo se usa si `destino == "personas"`: usernames a resolver.
    pub usuarios: Vec<String>,
}

#[derive(Debug, Serialize, Clone)]
pub struct SecuritySettings {
    pub zero_trust: bool,
    pub self_service_ip: bool,
    pub allowlist: Vec<String>,
    pub denylist: Vec<String>,
    pub maintenance: bool,
    pub maintenance_message: String,
    pub maintenance_block_login: bool,
    /// Ids de servicio que se mantienen ALCANZABLES mientras dura el
    /// mantenimiento (p.ej. "mapa", "modelos"). Vacío = todo bloqueado salvo
    /// el núcleo fijo y los administradores.
    pub maintenance_services: Vec<String>,
}

#[derive(Debug, Deserialize)]
pub struct PatchSecurityReq {
    pub zero_trust: Option<bool>,
    pub self_service_ip: Option<bool>,
    pub maintenance: Option<bool>,
    pub maintenance_message: Option<String>,
    pub maintenance_block_login: Option<bool>,
    pub maintenance_services: Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
pub struct PatchPoliciesReq {
    pub active: Option<bool>,
    pub title: Option<String>,
    pub content: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
pub struct PatchServerProfileReq {
    pub title: Option<String>,
    pub description: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
pub struct IpReq {
    pub ip: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct UnsealReq {
    pub passphrase: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TaskKind {
    InferenceRuntime,
    Database,
    ModelDownload,
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
    /// Va también aquí, no solo en `SecuritySettings`: esta muestra ya llega
    /// a toda la app (cliente entero, no solo el panel de administración)
    /// una vez por segundo, así que es el transporte natural para que la
    /// tira de aviso se vea desde cualquier pantalla, no solo Seguridad.
    pub maintenance: bool,
    pub maintenance_message: String,
    /// Ya filtrados por `routes::telemetry::sse` según quién abrió esta
    /// conexión — lo que llega aquí es exactamente lo que le toca ver a esa
    /// sesión, ordenado con los urgentes primero.
    pub avisos: Vec<AvisoInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GpuSample {
    pub index: u32,
    pub util_pct: u32,
    pub vram_used_mb: u64,
    pub vram_total_mb: u64,
    pub temp_c: Option<u32>,
    /// Reloj de núcleo actual, en MHz. `None` si NVML no lo da (p. ej. WSL2).
    pub clock_mhz: Option<u32>,
    /// Velocidad de ventilador en %, no rpm — es lo único que expone NVML.
    pub fan_pct: Option<u32>,
    /// Consumo real en este instante, no el límite configurado — se lee
    /// aunque no haya ningún perfil aplicado (o no se pueda aplicar, como en
    /// WSL2), porque es una lectura, no depende de la escritura funcionando.
    pub power_draw_mw: Option<u32>,
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
    /// Igual que `max_daily` pero sobre los últimos 7 días, y apagable: el
    /// administrador puede no querer un segundo tope en absoluto, no solo
    /// uno muy alto.
    pub weekly_enabled: bool,
    pub max_weekly: i64,
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
            weekly_enabled: false,
            max_weekly: 300,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TareaModelo {
    pub id: String,
    pub item_actual: Option<String>,
    pub pct: Option<u32>,
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
    /// Sistema y versión del cliente. Es un dato declarado por quien pide, no
    /// una huella: sirve para decidir, no para identificar.
    #[serde(default)]
    pub device: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AcceptLicensesReq {
    /// Una entrada por licencia distinta: `{"MIT": ["anyloc","cliquemining"], ...}`.
    /// Agrupado por texto porque una licencia que cubre dos pesos se acepta
    /// una vez, no dos.
    pub licencias: std::collections::HashMap<String, Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreditRequestInfo {
    pub id: i64,
    pub user_id: i64,
    pub username: String,
    pub tipo: String,
    pub valor_actual: i64,
    pub valor_propuesto: i64,
    pub mensaje: Option<String>,
    pub status: String,
    pub reason: Option<String>,
    pub created_at: i64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CreateCreditReq {
    pub tipo: String,
    pub valor_propuesto: i64,
    pub mensaje: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ResolveCreditReq {
    pub approve: bool,
    /// El admin puede aprobar con un valor distinto al propuesto. `None`
    /// con `approve: true` usa el propuesto tal cual.
    pub valor_final: Option<i64>,
    pub reason: Option<String>,
}

/// Lo que llega por `/v1/admin/events`. Nace pensado para crecer, igual que
/// `Cambio` en la cola.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum EventoAdmin {
    SolicitudCredito {
        user_id: i64,
        username: String,
        tipo: String,
        valor_actual: i64,
        valor_propuesto: i64,
    },
    SolicitudAcceso {
        id: i64,
        display_name: String,
        message: String,
    },
    /// Sin payload: es una señal ("algo cambió en la cola"), no un
    /// snapshot — quien la recibe reacciona pidiendo `GET /v1/queue` de
    /// nuevo, igual que ya haría un sondeo.
    ColaCambio,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ProviderTokenState {
    pub has_token: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ProviderTokenReq {
    /// `None` no toca el token guardado — igual que `MapConfigReq.key`, para
    /// poder guardar sin tener que volver a teclear uno que ya estaba.
    /// `Some("")` sí lo borra: es la forma de quitarlo del todo.
    pub token: Option<String>,
}



#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ItemDescarga {
    pub id: String,
    pub fichero_url: String,
    pub destino: String,
    pub licencia_texto: String,
    pub sha256: String,
    pub gestion_propia: bool,
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
    /// Solo importa si las políticas de aceptación están activas (ver
    /// `politicas::activo`). `#[serde(default)]` para que un cliente viejo
    /// que todavía no manda este campo no rompa la deserialización — el
    /// servidor lo trata igual que si viniera `false`.
    #[serde(default)]
    pub accepted_policies: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AdminRequest {
    pub id: i64,
    pub display_name: String,
    pub message: String,
    pub source_ip: String,
    /// Lo que declaró el cliente al pedir acceso. `None` en las solicitudes
    /// anteriores a que esto existiera, y se enseña como «no consta».
    #[serde(default)]
    pub device: Option<String>,
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
    pub uso: LimitsUsage,
}

/// Cuánto ha gastado ya del tope diario y del semanal. Mismo criterio exacto
/// que la comprobación real de `analyses::create` (`created_at > ahora -
/// ventana`) — mostrar un número que no coincida con el que de verdad corta
/// sería peor que no mostrar nada.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LimitsUsage {
    pub hoy: i64,
    pub semana: i64,
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

/// Lo que el panel enseña nada más entrar. Va en una sola respuesta y no en
/// cuatro peticiones: pintar la pantalla a trozos daría cuatro estados de
/// carga y cuatro de error para una sola pregunta.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Resumen {
    pub solicitudes_pendientes: i64,
    /// Epoch de la más antigua sin resolver. `None` si no hay ninguna.
    pub solicitud_mas_antigua: Option<i64>,
    pub usuarios: i64,
    /// Con el mismo criterio que ya usa la cola: estar suscrito a
    /// `/v1/queue/events` cuenta como estar conectado. Una segunda definición
    /// de «conectado» sería una segunda verdad sobre el mismo hecho.
    pub usuarios_conectados: i64,
    pub analisis_hoy: i64,
    pub analisis_en_cola: i64,
    /// Siete días, el más reciente al final. Alimenta la chispa de la ficha.
    pub analisis_serie: Vec<i64>,
    pub indices: i64,
    pub indices_bytes: i64,
    pub teselas: i64,
    pub arrancado_en: i64,
    /// Para el chequeo de "primeros pasos" del Resumen: mismo criterio que
    /// `routes::models::estado` (licencia junto al peso), factorizado en
    /// `routes::models::hay_alguno_instalado`.
    pub modelos_instalados: bool,
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
    /// Quién tiene el candado de trabajo (`project_locks`) ahora mismo, si lo
    /// tiene alguien. `None` no solo significa "nadie lo pidió nunca": la
    /// consulta ya descarta candados de sesión caducada o de más de
    /// `STALE_AFTER`, así que esto es "de verdad, alguien está dentro ahora".
    pub locked_by: Option<String>,
    /// El id de quien tiene el candado — junto a `locked_by`, no en su lugar:
    /// el nombre ya se usaba para el texto, el id hace falta aparte para
    /// pedir su foto de perfil.
    pub locked_by_id: Option<i64>,
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
    /// Invitación nueva a un proyecto, por el mismo canal que ya tiene abierto
    /// cualquier sesión conectada (`/v1/queue/events`) — sin esto, enterarse
    /// de una invitación dependía de un sondeo cada 60s en `NotificationsPopover`.
    Invitacion {
        #[serde(skip)]
        user_id: i64,
        project_id: i64,
        project_name: String,
        invited_by: String,
    },
    /// Aviso de que el servidor va a cambiar de dirección (puerto/host
    /// público), emitido justo ANTES de reiniciar el proceso — mientras el
    /// daemon todavía es alcanzable en la dirección vieja — para que quien
    /// esté conectado en ese momento actualice su dirección guardada sin
    /// tener que pedir una tarjeta nueva. Quien esté desconectado en ese
    /// instante no recibe esto: para ese caso la recuperación es pedir una
    /// tarjeta de servidor nueva, ver `AddServerForm`.
    Red {
        #[serde(skip)]
        user_id: i64,
        nuevo_addr: String,
    },
}

impl Cambio {
    pub fn user_id(&self) -> i64 {
        match self {
            Cambio::Estado { user_id, .. }
            | Cambio::Progreso { user_id, .. }
            | Cambio::Invitacion { user_id, .. }
            | Cambio::Red { user_id, .. } => *user_id,
        }
    }
}

/// Un evento del feed de "actividad reciente" del Resumen. Fusiona cuatro
/// fuentes que ya existen (cuentas, análisis, avisos, solicitudes) — no hay
/// tabla ni escritura nueva, solo lectura y orden por fecha.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "tipo", rename_all = "snake_case")]
pub enum ActividadItem {
    CuentaCreada { username: String, at: i64 },
    AnalisisResuelto { id: i64, estado: String, at: i64 },
    AvisoPublicado { extracto: String, at: i64 },
    SolicitudResuelta { display_name: String, aprobada: bool, at: i64 },
}

impl ActividadItem {
    pub fn at(&self) -> i64 {
        match self {
            ActividadItem::CuentaCreada { at, .. }
            | ActividadItem::AnalisisResuelto { at, .. }
            | ActividadItem::AvisoPublicado { at, .. }
            | ActividadItem::SolicitudResuelta { at, .. } => *at,
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
    /// Dueño y caso del trabajo que tiene en la mano ahora mismo, si tiene
    /// alguno — para pintar la Cinta de la Cola sin una segunda petición.
    pub dueno_actual_id: Option<i64>,
    pub dueno_actual: Option<String>,
    pub caso_actual: Option<String>,
}

/// Por qué un pendiente no se reparte, cuando hay una razón real que
/// explicarlo — no confundir con "todavía no le ha tocado turno", que es
/// `None` en `PendienteView.razon`, no una variante de este enum.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RazonBloqueo {
    Bloqueado,
    Desconectado,
    LimiteAlcanzado,
}

/// Un pendiente, para pintarlo en la página de Cola uno por uno en vez de
/// solo contarlo.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PendienteView {
    pub id: i64,
    pub user_id: i64,
    pub username: String,
    pub case_id: i64,
    pub case_nombre: String,
    pub nivel: String,
    pub creado_en: i64,
    pub razon: Option<RazonBloqueo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueueView {
    pub pendientes: u32,
    pub en_curso: u32,
    pub trabajadores: Vec<WorkerView>,
    pub pendientes_detalle: Vec<PendienteView>,
}

/// Un punto de una curva editable — de ventilador (temperatura→%) o de offset
/// de reloj (potencia→MHz), según en qué pestaña vive. El mismo tipo sirve
/// para las dos: la interfaz decide qué eje es cuál.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct PuntoCurva {
    pub temp_c: i32,
    pub valor: i32,
}

/// Rango de fábrica de una GPU, tal como lo reporta NVML. Nunca inventado por
/// el servidor — si NVML no lo da, no hay rango y el control avanzado para
/// esa tarjeta se deshabilita (ver `HardwareCaps`).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RangoFabrica {
    pub potencia_min_w: u32,
    pub potencia_max_w: u32,
    pub temp_throttle_c: Option<u32>,
}

/// Lo que devuelve `GET /v1/admin/hardware`: lectura actual + rango de
/// fábrica + el perfil ya persistido para esa tarjeta, si hay uno.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HardwareDevice {
    pub index: u32,
    pub name: String,
    pub sample: GpuSample,
    pub rango: RangoFabrica,
    pub perfil: Option<HardwareProfile>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HardwareProfile {
    pub potencia_w: u32,
    pub offset_nucleo_mhz: i32,
    pub offset_memoria_mhz: i32,
    pub curva_ventilador: Vec<PuntoCurva>,
}

/// Cuerpo de `PATCH /v1/admin/hardware/{index}`. Cualquier campo ausente deja
/// ese valor como estaba — igual que `PatchSecurityReq`.
#[derive(Debug, Deserialize)]
pub struct PatchHardwareReq {
    pub potencia_w: Option<u32>,
    pub offset_nucleo_mhz: Option<i32>,
    pub offset_memoria_mhz: Option<i32>,
    pub curva_ventilador: Option<Vec<PuntoCurva>>,
    /// `false` (o ausente) y algún valor sale del rango de fábrica → `409`
    /// con el motivo. El modal de "soy consciente" es quien reintenta con
    /// `true`, nunca el primer intento.
    #[serde(default)]
    pub confirmado: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CpuCoreSample {
    pub indice: u32,
    /// `None` si no hay sensor `hwmon` para este host (WSL2, siempre).
    pub temp_c: Option<i32>,
    pub uso_pct: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CpuSample {
    pub nucleos: Vec<CpuCoreSample>,
    /// Consumo real actual. `None` si no hay RAPL (WSL2) ni `ryzenadj` legible.
    pub potencia_w: Option<f32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CpuRango {
    pub potencia_min_w: f32,
    pub potencia_max_w: f32,
    /// `true` en AMD: no hay rango de fábrica leído del hardware, es una
    /// aproximación (50–100% del TDP declarado) — la interfaz lo anuncia
    /// como tal, no lo hace pasar por un dato real como en Intel.
    pub aproximado: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CpuProfile {
    /// PL1 en Intel (sostenido); STAPM/slow-limit en AMD. Mismo campo, otra
    /// semántica según fabricante — no hay dos CPUs a la vez, no hace falta
    /// distinguir en el esquema.
    pub pl1_w: f32,
    /// PL2 en Intel (boost); fast-limit en AMD.
    pub pl2_w: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CpuDevice {
    /// `"intel"` | `"amd"` | `"otro"`.
    pub fabricante: String,
    pub sample: CpuSample,
    pub rango: CpuRango,
    pub perfil: Option<CpuProfile>,
}

#[derive(Debug, Deserialize)]
pub struct PatchCpuReq {
    pub pl1_w: Option<f32>,
    pub pl2_w: Option<f32>,
    #[serde(default)]
    pub confirmado: bool,
}
