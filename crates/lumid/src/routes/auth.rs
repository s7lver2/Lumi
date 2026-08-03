use crate::{master, App};
use axum::{extract::State, http::StatusCode, Json};
use lumi_proto::api::UnsealReq;
use crate::routes::claim::new_token;
use lumi_proto::api::{LoginReq, LoginRes};
use lumi_proto::crypto::verify_password;

const SESSION_TTL_S: i64 = 12 * 3600;

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

pub async fn login(
    State(app): State<App>,
    Json(req): Json<LoginReq>,
) -> Result<Json<LoginRes>, (StatusCode, String)> {
    let c = app.store.conn();
    let row: Result<(i64, String, i64), _> = c.query_row(
        "SELECT id, password_phc, is_admin FROM users WHERE username = ?1",
        [&req.username],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
    );
    // Mismo mensaje para usuario inexistente y contraseña mala: no filtramos
    // qué nombres existen en el servidor.
    let denied = (StatusCode::UNAUTHORIZED, "usuario o contraseña incorrectos".to_string());
    let Ok((id, phc, is_admin)) = row else { return Err(denied) };
    if !verify_password(&req.password, &phc) {
        return Err(denied);
    }
    let token = new_token();
    let exp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64
        + SESSION_TTL_S;
    c.execute(
        "INSERT INTO sessions (token, user_id, expires_at) VALUES (?1, ?2, ?3)",
        rusqlite::params![token, id, exp],
    )
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(LoginRes { token, is_admin: is_admin == 1 }))
}

/// Devuelve el id del usuario si el token es de un administrador vivo.
pub fn require_admin(app: &App, token: &str) -> Result<i64, StatusCode> {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64;
    app.store
        .conn()
        .query_row(
            "SELECT u.id FROM sessions s JOIN users u ON u.id = s.user_id
             WHERE s.token = ?1 AND s.expires_at > ?2 AND u.is_admin = 1",
            rusqlite::params![token, now],
            |r| r.get(0),
        )
        .map_err(|_| StatusCode::UNAUTHORIZED)
}

pub fn bearer(h: &axum::http::HeaderMap) -> String {
    h.get("authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .unwrap_or_default()
        .to_string()
}

/// Comprueba una sesión persistida sin volver a pedir usuario/contraseña.
/// El cliente lo usa al reabrir la app: si el token guardado ya no vale
/// (caducó a las 12h, o se borraron las sesiones), aquí se sabe antes de
/// intentar retomar un paso que necesita admin.
pub async fn me(
    State(app): State<App>,
    headers: axum::http::HeaderMap,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let uid = require_admin(&app, &bearer(&headers))?;
    let username: String = app
        .store
        .conn()
        .query_row("SELECT username FROM users WHERE id = ?1", [uid], |r| r.get(0))
        .map_err(|_| StatusCode::UNAUTHORIZED)?;
    Ok(Json(serde_json::json!({ "username": username, "is_admin": true })))
}
