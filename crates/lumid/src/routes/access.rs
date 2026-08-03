//! Solicitud de acceso: la única superficie escribible sin credenciales.
//!
//! Todo lo que hay aquí que parece paranoia (límite por IP, tope global,
//! tamaños máximos, interruptor) es lo que impide que un bucle llene el disco
//! de un servidor que alguien dejó expuesto.

use crate::App;
use axum::extract::ConnectInfo;
use axum::{extract::State, http::HeaderMap, http::StatusCode, Json};
use lumi_proto::api::{AccessReq, AccessRes, AccessStatus, DaemonState};
use lumi_proto::crypto::{hash_password, verify_password};
use rand::RngCore;
use std::net::SocketAddr;

/// Sin responder, la solicitud muere sola.
const REQUEST_TTL_S: i64 = 7 * 24 * 3600;
/// Tras aprobar, ventana para crear la cuenta. Es una credencial sin cifrar en
/// el equipo del usuario: no alargar este plazo sin pensarlo.
pub const APPROVED_TTL_S: i64 = 48 * 3600;
const MAX_NAME: usize = 80;
const MAX_MESSAGE: usize = 500;
const PER_HOUR: i64 = 3;
const PER_DAY: i64 = 10;
const MAX_PENDING: i64 = 100;

pub fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64
}

/// Devuelve el ticket en claro (que solo se ve una vez) y su hash.
fn new_ticket(id: i64) -> (String, String) {
    let mut b = [0u8; 24];
    rand::thread_rng().fill_bytes(&mut b);
    let secret = bs58::encode(b).into_string();
    let phc = hash_password(&secret).expect("argon2 falló");
    (format!("lt_{id}_{secret}"), phc)
}

fn split_ticket(t: &str) -> Option<(i64, String)> {
    let rest = t.trim().strip_prefix("lt_")?;
    let (id, secret) = rest.split_once('_')?;
    if secret.is_empty() {
        return None;
    }
    Some((id.parse().ok()?, secret.to_string()))
}

/// `Authorization: Ticket <t>`. En cabecera, nunca en la ruta: es un secreto y
/// las rutas acaban en logs de acceso, historiales de proxy y trazas de error.
pub fn ticket(h: &HeaderMap) -> String {
    h.get("authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Ticket "))
        .unwrap_or_default()
        .to_string()
}

pub struct Row {
    pub id: i64,
    pub status: String,
    pub display_name: String,
    pub granted_models: Option<String>,
    pub expires_at: i64,
}

/// Valida el ticket y devuelve su solicitud. Es la puerta de las dos únicas
/// acciones que un ticket autoriza: consultar el estado y crear la cuenta.
pub fn authorize(app: &App, t: &str) -> Result<Row, (StatusCode, String)> {
    let bad = |c: StatusCode, m: &str| (c, m.to_string());
    let (id, secret) = split_ticket(t).ok_or_else(|| bad(StatusCode::UNAUTHORIZED, "ticket inválido"))?;
    let r: (String, String, String, Option<String>, i64) = app
        .store
        .conn()
        .query_row(
            "SELECT ticket_phc, status, display_name, granted_models, expires_at
             FROM access_requests WHERE id = ?1",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
        )
        .map_err(|_| bad(StatusCode::UNAUTHORIZED, "ticket inválido"))?;
    if !verify_password(&secret, &r.0) {
        return Err(bad(StatusCode::UNAUTHORIZED, "ticket inválido"));
    }
    if r.1 == "consumed" {
        return Err(bad(StatusCode::CONFLICT, "esta solicitud ya creó su cuenta; inicia sesión"));
    }
    if now() > r.4 {
        return Err(bad(StatusCode::GONE, "la solicitud caducó; vuelve a solicitar acceso"));
    }
    Ok(Row { id, status: r.1, display_name: r.2, granted_models: r.3, expires_at: r.4 })
}

pub async fn create(
    State(app): State<App>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    Json(req): Json<AccessReq>,
) -> Result<Json<AccessRes>, (StatusCode, String)> {
    let err = |c: StatusCode, m: &str| (c, m.to_string());
    let name = req.display_name.trim();
    let message = req.message.trim();
    if name.is_empty() || name.chars().count() > MAX_NAME || message.chars().count() > MAX_MESSAGE {
        return Err(err(StatusCode::BAD_REQUEST, "nombre vacío o texto demasiado largo"));
    }
    if app.store.state() == DaemonState::Unclaimed {
        return Err(err(
            StatusCode::CONFLICT,
            "este servidor todavía no tiene administrador; hace falta la clave de vinculación",
        ));
    }
    if app.store.get_meta("accept_requests").as_deref() == Some("0") {
        return Err(err(StatusCode::SERVICE_UNAVAILABLE, "el servidor no acepta solicitudes ahora mismo"));
    }

    let ip = peer.ip().to_string();
    let t = now();
    let c = app.store.conn();
    let count = |since: i64| -> i64 {
        c.query_row(
            "SELECT COUNT(*) FROM access_requests WHERE source_ip = ?1 AND created_at > ?2",
            rusqlite::params![ip, since],
            |r| r.get(0),
        )
        .unwrap_or(0)
    };
    if count(t - 3600) >= PER_HOUR {
        return Err(err(StatusCode::TOO_MANY_REQUESTS, "demasiadas solicitudes; espera una hora"));
    }
    if count(t - 86400) >= PER_DAY {
        return Err(err(StatusCode::TOO_MANY_REQUESTS, "demasiadas solicitudes; espera 24 horas"));
    }
    let pending: i64 = c
        .query_row("SELECT COUNT(*) FROM access_requests WHERE status = 'pending'", [], |r| r.get(0))
        .unwrap_or(0);
    if pending >= MAX_PENDING {
        return Err(err(
            StatusCode::SERVICE_UNAVAILABLE,
            "hay demasiadas solicitudes sin resolver; inténtalo más tarde",
        ));
    }

    // Se inserta primero para obtener el id, y el ticket se calcula con él.
    c.execute(
        "INSERT INTO access_requests
         (display_name, message, ticket_phc, source_ip, status, created_at, expires_at)
         VALUES (?1, ?2, '', ?3, 'pending', ?4, ?5)",
        rusqlite::params![name, message, ip, t, t + REQUEST_TTL_S],
    )
    .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;
    let id = c.last_insert_rowid();
    let (tk, phc) = new_ticket(id);
    c.execute("UPDATE access_requests SET ticket_phc = ?1 WHERE id = ?2", rusqlite::params![phc, id])
        .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;
    tracing::info!("solicitud de acceso #{id} desde {ip}");
    Ok(Json(AccessRes { ticket: tk }))
}

pub async fn status(
    State(app): State<App>,
    headers: HeaderMap,
) -> Result<Json<AccessStatus>, (StatusCode, String)> {
    let row = authorize(&app, &ticket(&headers))?;
    let reason: Option<String> = app
        .store
        .conn()
        .query_row("SELECT reason FROM access_requests WHERE id = ?1", [row.id], |r| r.get(0))
        .unwrap_or(None);
    Ok(Json(AccessStatus { status: row.status, display_name: row.display_name, reason }))
}

/// Crea la cuenta y consume el ticket. El mismo ticket que identificaba la
/// solicitud es el que autoriza esto: sin él, aprobar exigiría al admin
/// acordarse de enviar algo por fuera, y si no lo hace el usuario espera sin
/// saber por qué.
pub async fn create_account(
    State(app): State<App>,
    headers: HeaderMap,
    Json(req): Json<lumi_proto::api::AccountReq>,
) -> Result<StatusCode, (StatusCode, String)> {
    let err = |c: StatusCode, m: &str| (c, m.to_string());
    let row = authorize(&app, &ticket(&headers))?;
    if row.status != "approved" {
        return Err(err(StatusCode::CONFLICT, "esta solicitud aún no está aprobada"));
    }
    let username = req.username.trim();
    if username.is_empty() || req.password.len() < 12 {
        return Err(err(
            StatusCode::BAD_REQUEST,
            "usuario vacío o contraseña de menos de 12 caracteres",
        ));
    }
    let phc = hash_password(&req.password)
        .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;

    let uid = {
        let c = app.store.conn();
        // El nombre ocupado NO consume el ticket: es una colisión, no un abuso.
        c.execute(
            "INSERT INTO users (username, display_name, password_phc, is_admin, created_at)
             VALUES (?1, ?2, ?3, 0, ?4)",
            rusqlite::params![username, row.display_name, phc, now()],
        )
        .map_err(|_| err(StatusCode::CONFLICT, "ese nombre de usuario ya existe"))?;
        let uid = c.last_insert_rowid();
        c.execute(
            "UPDATE access_requests SET status = 'consumed' WHERE id = ?1",
            [row.id],
        )
        .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;
        uid
    };

    if let Some(models) = row.granted_models {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&models) {
            let _ = crate::limits::set(&app.store, Some(uid), "models", &v);
        }
    }
    tracing::info!("cuenta creada: {username} (solicitud #{})", row.id);
    Ok(StatusCode::CREATED)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn el_ticket_se_verifica_por_id_y_no_por_barrido() {
        let (t, phc) = new_ticket(42);
        assert!(t.starts_with("lt_42_"));
        let (id, secret) = split_ticket(&t).unwrap();
        assert_eq!(id, 42);
        assert!(lumi_proto::crypto::verify_password(&secret, &phc));
        // Un ticket con el id correcto pero el secreto de otro no vale.
        let (otro, _) = new_ticket(42);
        let (_, secret_otro) = split_ticket(&otro).unwrap();
        assert!(!lumi_proto::crypto::verify_password(&secret_otro, &phc));
        // Y la basura no revienta el parseo.
        assert!(split_ticket("lt_no_es_un_numero").is_none());
        assert!(split_ticket("Bearer abc").is_none());
        assert!(split_ticket("").is_none());
    }
}
