use crate::routes::access::now;
use crate::routes::claim::new_token;
use crate::store::Store;
use crate::{master, App};
use axum::extract::ConnectInfo;
use axum::{extract::State, http::StatusCode, Json};
use lumi_proto::api::{ChangePasswordReq, DeviceInfo, LoginReq, LoginRes, SessionInfo, UnsealReq};
use lumi_proto::crypto::{hash_password, hash_token, verify_password};
use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::{Mutex, OnceLock};

const SESSION_TTL_S: i64 = 12 * 3600;

/// Intentos de login fallidos por IP en la ventana actual. Sin esto, nada
/// impedía probar contraseñas a la máxima velocidad de la red contra
/// cualquier usuario conocido — el mensaje de error ya no distingue usuario
/// inexistente de contraseña mala (para no filtrar cuentas), pero eso no
/// sirve de nada si se pueden probar miles por segundo.
const INTENTOS_MAX: u32 = 10;
const VENTANA_S: i64 = 5 * 60;

fn limitador_login() -> &'static Mutex<HashMap<SocketAddr, (i64, u32)>> {
    static L: OnceLock<Mutex<HashMap<SocketAddr, (i64, u32)>>> = OnceLock::new();
    L.get_or_init(|| Mutex::new(HashMap::new()))
}

/// `true` si esta IP ya gastó su cupo — se llama ANTES de tocar la base de
/// datos o Argon2, para que agotar el cupo sea barato de comprobar también
/// para quien lo está agotando a propósito.
fn login_bloqueado(peer: SocketAddr) -> bool {
    let t = now();
    let mut mapa = limitador_login().lock().unwrap();
    let entrada = mapa.entry(peer).or_insert((t, 0));
    if t - entrada.0 >= VENTANA_S {
        *entrada = (t, 0);
    }
    entrada.1 >= INTENTOS_MAX
}

fn registrar_intento_fallido(peer: SocketAddr) {
    let t = now();
    let mut mapa = limitador_login().lock().unwrap();
    let entrada = mapa.entry(peer).or_insert((t, 0));
    if t - entrada.0 >= VENTANA_S {
        *entrada = (t, 0);
    }
    entrada.1 += 1;
}

fn limpiar_intentos(peer: SocketAddr) {
    limitador_login().lock().unwrap().remove(&peer);
}

/// Desbloquea la maestra y reanuda la cola. En este subsistema la cola aún no
/// existe; el subsistema 4 engancha aquí su reanudación.
pub async fn unseal(
    State(app): State<App>,
    Json(req): Json<UnsealReq>,
) -> Result<StatusCode, (StatusCode, String)> {
    if app.master.read().await.is_some() {
        return Ok(StatusCode::NO_CONTENT);
    }
    let mk = master::unseal(&app.dir, &req.passphrase)
        .map_err(|e| (StatusCode::UNAUTHORIZED, e.to_string()))?;
    *app.master.write().await = Some(mk);
    tracing::info!("clave maestra desbloqueada");
    Ok(StatusCode::NO_CONTENT)
}

/// Registro PASIVO de equipos: audita y permite revocar, no autentica. Copiar
/// el fichero del cliente copia la identidad, y eso es a propósito: exigir
/// dispositivos aprobados costaría un par de claves por equipo, y el coste
/// real de eso no es el código, es el soporte de cada portátil nuevo.
fn upsert_device(c: &rusqlite::Connection, uid: i64, d: &DeviceInfo) -> Option<i64> {
    let t = now();
    c.execute(
        "INSERT INTO devices (user_id, client_id, name, os, first_seen, last_seen)
         VALUES (?1, ?2, ?3, ?4, ?5, ?5)
         ON CONFLICT(user_id, client_id) DO UPDATE SET name = ?3, os = ?4, last_seen = ?5",
        rusqlite::params![uid, d.client_id, d.name, d.os, t],
    )
    .ok()?;
    c.query_row(
        "SELECT id FROM devices WHERE user_id = ?1 AND client_id = ?2",
        rusqlite::params![uid, d.client_id],
        |r| r.get(0),
    )
    .ok()
}

pub async fn login(
    State(app): State<App>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    Json(req): Json<LoginReq>,
) -> Result<Json<LoginRes>, (StatusCode, String)> {
    if login_bloqueado(peer) {
        return Err((
            StatusCode::TOO_MANY_REQUESTS,
            "demasiados intentos; espera unos minutos".to_string(),
        ));
    }
    // Escopado a propósito: `app.store.conn()` es LA ÚNICA conexión de todo
    // el daemon, bajo un solo mutex — mantenerla agarrada mientras se hace el
    // Argon2id de abajo (deliberadamente lento) bloqueaba a CUALQUIER otra
    // petición que tocara la base de datos durante ese rato, y con tráfico
    // concurrente contra este endpoint eso podía dejar sin hilos libres a
    // todo el runtime de tokio — un cuelgue total del servidor, no solo de
    // este endpoint. El guard se suelta aquí, antes de gastar ni un ciclo en
    // criptografía.
    let row: Result<(i64, String, i64, i64, i64), _> = app.store.conn().query_row(
        "SELECT id, password_phc, is_admin, blocked, must_change_password
         FROM users WHERE username = ?1",
        [&req.username],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
    );
    // Mismo mensaje para usuario inexistente y contraseña mala: no filtramos
    // qué nombres existen en el servidor.
    let denied = (StatusCode::UNAUTHORIZED, "usuario o contraseña incorrectos".to_string());
    let Ok((id, phc, is_admin, blocked, must_change)) = row else {
        // Se gasta el mismo Argon2id que si el usuario existiera de verdad:
        // ver el "Fix" sobre `phc_ficticio` — la diferencia de tiempo entre
        // esta rama y la de contraseña incorrecta es un canal de enumeración
        // aunque el mensaje de error sea idéntico.
        let _ = verify_password(&req.password, lumi_proto::crypto::phc_ficticio());
        registrar_intento_fallido(peer);
        return Err(denied);
    };
    if !verify_password(&req.password, &phc) {
        registrar_intento_fallido(peer);
        return Err(denied);
    }
    // Bloqueado es DISTINTO de credenciales malas, y se dice: quien está
    // bloqueado necesita saber que su contraseña está bien y que hable con
    // el administrador, no seguir probando contraseñas.
    if blocked == 1 {
        return Err((
            StatusCode::FORBIDDEN,
            "esta cuenta está bloqueada; habla con el administrador".into(),
        ));
    }
    // Un admin siempre puede entrar, active o no este interruptor — si se
    // quedara fuera también él, nadie podría revertir el modo salvo tocando
    // la base de datos a mano.
    if is_admin != 1 && crate::mantenimiento::activo(&app) && crate::mantenimiento::bloquea_login(&app) {
        return Err((
            StatusCode::SERVICE_UNAVAILABLE,
            "el servidor está en mantenimiento; el login está temporalmente bloqueado".into(),
        ));
    }

    // Se reabre aquí: todo lo de arriba (Argon2id incluido) ya pasó sin tener
    // la conexión agarrada.
    let c = app.store.conn();
    let device_id = req.device.as_ref().and_then(|d| upsert_device(&c, id, d));
    let token = new_token();
    let public_id = new_token();
    let t = now();
    c.execute(
        "INSERT INTO sessions (token, user_id, expires_at, device_id, created_at, last_seen, public_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?5, ?6)",
        rusqlite::params![hash_token(&token), id, t + SESSION_TTL_S, device_id, t, public_id],
    )
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    limpiar_intentos(peer);
    Ok(Json(LoginRes {
        token,
        username: req.username,
        is_admin: is_admin == 1,
        must_change_password: must_change == 1,
    }))
}

/// `operable = false` responde "quién eres"; `true` responde "quién eres y
/// puedes operar". Separado en una función libre para poder comprobarlo sin
/// levantar un servidor.
fn lookup(store: &Store, token: &str, operable: bool) -> Result<(i64, bool), StatusCode> {
    let (id, is_admin, must_change): (i64, i64, i64) = store
        .conn()
        .query_row(
            "SELECT u.id, u.is_admin, u.must_change_password
             FROM sessions s JOIN users u ON u.id = s.user_id
             WHERE s.token = ?1 AND s.expires_at > ?2 AND u.blocked = 0",
            rusqlite::params![hash_token(token), now()],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .map_err(|_| StatusCode::UNAUTHORIZED)?;
    if operable && must_change == 1 {
        return Err(StatusCode::FORBIDDEN);
    }
    Ok((id, is_admin == 1))
}

/// Sesión válida y en condiciones de operar. Es la puerta por defecto.
///
/// ponytail: no actualiza `last_seen` en cada petición. Sería una escritura en
/// el mutex del store por llamada, para un dato que solo se mira en una vista
/// de auditoría. Se sella al iniciar sesión; el techo es el día en que haga
/// falta "activo hace 2 min" de verdad.
pub fn require_session(app: &App, token: &str) -> Result<(i64, bool), StatusCode> {
    lookup(&app.store, token, true)
}

/// Identifica sin exigir estar en condiciones de operar. SOLO para el cambio
/// de contraseña: es la acción que desbloquea al usuario.
pub fn session_user(app: &App, token: &str) -> Result<(i64, bool), StatusCode> {
    lookup(&app.store, token, false)
}

/// Sustituye por completo a la `require_admin` anterior, que consultaba la base
/// por su cuenta y por tanto no vería ni el bloqueo ni el cambio pendiente.
pub fn require_admin(app: &App, token: &str) -> Result<i64, StatusCode> {
    let (uid, is_admin) = require_session(app, token)?;
    if !is_admin {
        return Err(StatusCode::FORBIDDEN);
    }
    Ok(uid)
}

pub fn bearer(h: &axum::http::HeaderMap) -> String {
    h.get("authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .unwrap_or_default()
        .to_string()
}

pub async fn change_password(
    State(app): State<App>,
    headers: axum::http::HeaderMap,
    Json(req): Json<ChangePasswordReq>,
) -> Result<StatusCode, (StatusCode, String)> {
    let token = bearer(&headers);
    let (uid, _) = session_user(&app, &token).map_err(|c| (c, "sesión inválida".to_string()))?;
    if req.new.len() < 12 {
        return Err((StatusCode::BAD_REQUEST, "la contraseña necesita 12 caracteres o más".into()));
    }
    // Escopado a propósito, mismo motivo que en `login`: la conexión única
    // del daemon no debe quedar agarrada durante el Argon2id de abajo (aquí
    // van DOS: verificar la actual y hashear la nueva).
    let phc: String = app
        .store
        .conn()
        .query_row("SELECT password_phc FROM users WHERE id = ?1", [uid], |r| r.get(0))
        .map_err(|_| (StatusCode::UNAUTHORIZED, "sesión inválida".to_string()))?;
    // Nadie puede leer ni fijar la contraseña de otro: el admin solo exige que
    // se cambie. Por eso aquí SIEMPRE se pide la actual, incluso cuando el
    // cambio viene forzado.
    if !verify_password(&req.current, &phc) {
        return Err((StatusCode::UNAUTHORIZED, "la contraseña actual no es correcta".into()));
    }
    let new_phc = hash_password(&req.new)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let c = app.store.conn();
    c.execute(
        "UPDATE users SET password_phc = ?1, must_change_password = 0 WHERE id = ?2",
        rusqlite::params![new_phc, uid],
    )
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    // Las demás sesiones caen: si cambias la contraseña es porque puede estar
    // comprometida. La actual sobrevive para no echar al usuario de la app.
    c.execute(
        "DELETE FROM sessions WHERE user_id = ?1 AND token != ?2",
        rusqlite::params![uid, hash_token(&token)],
    )
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn my_sessions(
    State(app): State<App>,
    headers: axum::http::HeaderMap,
) -> Result<Json<Vec<SessionInfo>>, StatusCode> {
    let token = bearer(&headers);
    let (uid, _) = require_session(&app, &token)?;
    let c = app.store.conn();
    let mut q = c
        .prepare(
            "SELECT s.public_id, d.name, d.os, s.created_at, s.last_seen, s.token = ?2
             FROM sessions s LEFT JOIN devices d ON d.id = s.device_id
             WHERE s.user_id = ?1 AND s.public_id IS NOT NULL AND s.expires_at > ?3
             ORDER BY s.created_at DESC",
        )
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let rows = q
        .query_map(rusqlite::params![uid, hash_token(&token), now()], |r| {
            Ok(SessionInfo {
                public_id: r.get(0)?,
                device_name: r.get(1)?,
                os: r.get(2)?,
                created_at: r.get(3)?,
                last_seen: r.get(4)?,
                current: r.get::<_, i64>(5)? == 1,
            })
        })
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .flatten()
        .collect();
    Ok(Json(rows))
}

/// Revoca por identificador público, nunca por token: el token es un secreto y
/// las rutas acaban en logs de acceso.
pub async fn revoke_session(
    State(app): State<App>,
    axum::extract::Path(public_id): axum::extract::Path<String>,
    headers: axum::http::HeaderMap,
) -> Result<StatusCode, StatusCode> {
    let (uid, is_admin) = require_session(&app, &bearer(&headers))?;
    let c = app.store.conn();
    let n = if is_admin {
        c.execute("DELETE FROM sessions WHERE public_id = ?1", [&public_id])
    } else {
        c.execute(
            "DELETE FROM sessions WHERE public_id = ?1 AND user_id = ?2",
            rusqlite::params![public_id, uid],
        )
    }
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    // Mismo 404 para "no existe" y "no es tuya": no confirmamos la existencia
    // de sesiones ajenas a quien va probando identificadores.
    if n == 0 {
        return Err(StatusCode::NOT_FOUND);
    }
    Ok(StatusCode::NO_CONTENT)
}

/// Comprueba una sesión persistida sin volver a pedir usuario/contraseña.
/// El cliente lo usa al reabrir la app: si el token guardado ya no vale
/// (caducó, se bloqueó la cuenta, o pide cambio de contraseña), aquí se sabe
/// antes de intentar retomar un paso que necesita operar.
pub async fn me(
    State(app): State<App>,
    headers: axum::http::HeaderMap,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let (uid, is_admin) = require_session(&app, &bearer(&headers))?;
    let username: String = app
        .store
        .conn()
        .query_row("SELECT username FROM users WHERE id = ?1", [uid], |r| r.get(0))
        .map_err(|_| StatusCode::UNAUTHORIZED)?;
    // Los límites viajan aquí y no en una ruta aparte porque el cliente los
    // necesita en el mismo momento que el nombre: qué modelos puede pedir y si
    // puede crear proyectos decide qué se dibuja habilitado nada más entrar.
    // Sin esto, la interfaz ofrecía crear un proyecto y el servidor contestaba
    // 403 después: el motivo se sabía demasiado tarde.
    let limits = crate::limits::effective(&app.store, uid);
    Ok(Json(serde_json::json!({
        "username": username,
        "is_admin": is_admin,
        "limits": limits,
    })))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// La bandera de cambio pendiente tiene que cortar TODO menos el cambio en
    /// sí. Si no, un token emitido para "cambia la contraseña" valdría para
    /// operar sin cambiarla nunca.
    #[test]
    fn el_cambio_pendiente_deja_identificarse_pero_no_operar() {
        let dir = std::env::temp_dir().join(format!("lumi-auth-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let s = crate::store::Store::open(&dir).unwrap();
        {
            let c = s.conn();
            c.execute(
                "INSERT INTO users (id, username, password_phc, is_admin, created_at,
                                    must_change_password) VALUES (1, 'ana', 'x', 0, 0, 1)",
                [],
            )
            .unwrap();
            c.execute(
                "INSERT INTO sessions (token, user_id, expires_at, created_at, last_seen, public_id)
                 VALUES (?1, 1, 99999999999, 0, 0, 'pub')",
                [hash_token("tk")],
            )
            .unwrap();
        }
        assert_eq!(lookup(&s, "tk", false).unwrap().0, 1);
        assert!(lookup(&s, "tk", true).is_err());
        s.conn()
            .execute("UPDATE users SET must_change_password = 0 WHERE id = 1", [])
            .unwrap();
        assert!(lookup(&s, "tk", true).is_ok());
        drop(s);
        std::fs::remove_dir_all(&dir).ok();
    }
}
