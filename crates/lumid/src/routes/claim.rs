//! Canje de la clave de vinculación.
//!
//! El secreto se marca consumido en la misma transacción en que se valida, así
//! que dos clientes que canjeen a la vez no pueden crear dos administradores.

use crate::App;
use axum::{extract::State, http::StatusCode, Json};
use lumi_proto::api::{AdminReq, ClaimReq, ClaimRes};
use lumi_proto::crypto::{hash_password, verify_password};
use rand::RngCore;

const BOOTSTRAP_TTL_S: u32 = 600;

pub fn new_token() -> String {
    let mut b = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut b);
    bs58::encode(b).into_string()
}

fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64
}

pub async fn claim(
    State(app): State<App>,
    Json(req): Json<ClaimReq>,
) -> Result<Json<ClaimRes>, (StatusCode, String)> {
    let bad = |m: &str| (StatusCode::UNAUTHORIZED, m.to_string());
    let token = {
        let c = app.store.conn();
        let (phc, expires, consumed): (String, Option<i64>, i64) = c
            .query_row(
                "SELECT secret_phc, expires_at, consumed FROM pair_key WHERE id = 1",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .map_err(|_| bad("este servidor no tiene clave de vinculación emitida"))?;
        if consumed == 1 {
            return Err(bad("la clave ya se canjeó; entra con tus credenciales"));
        }
        if expires.is_some_and(|e| now() > e) {
            return Err(bad("la clave caducó; ejecuta lumi key reissue en el host"));
        }
        if !verify_password(&req.secret, &phc) {
            return Err(bad("clave incorrecta"));
        }
        let token = new_token();
        c.execute("UPDATE pair_key SET consumed = 1 WHERE id = 1", [])
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        c.execute(
            "INSERT INTO sessions (token, user_id, expires_at) VALUES (?1, 0, ?2)",
            rusqlite::params![lumi_proto::crypto::hash_token(&token), now() + BOOTSTRAP_TTL_S as i64],
        )
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        token
    };
    Ok(Json(ClaimRes {
        bootstrap_token: token,
        expires_in_s: BOOTSTRAP_TTL_S,
    }))
}

/// La sesión de bootstrap solo autoriza esto. Se consume al usarse.
pub async fn create_admin(
    State(app): State<App>,
    Json(req): Json<AdminReq>,
) -> Result<StatusCode, (StatusCode, String)> {
    if req.username.trim().is_empty() || req.password.len() < 12 {
        return Err((
            StatusCode::BAD_REQUEST,
            "usuario vacío o contraseña de menos de 12 caracteres".into(),
        ));
    }
    let c = app.store.conn();
    let valid: i64 = c
        .query_row(
            "SELECT COUNT(*) FROM sessions WHERE token = ?1 AND user_id = 0 AND expires_at > ?2",
            rusqlite::params![lumi_proto::crypto::hash_token(&req.bootstrap_token), now()],
            |r| r.get(0),
        )
        .unwrap_or(0);
    if valid == 0 {
        return Err((StatusCode::UNAUTHORIZED, "sesión de bootstrap inválida o caducada".into()));
    }
    let phc = hash_password(&req.password)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    c.execute(
        "INSERT INTO users (username, password_phc, is_admin, created_at) VALUES (?1, ?2, 1, ?3)",
        rusqlite::params![req.username.trim(), phc, now()],
    )
    .map_err(|e| (StatusCode::CONFLICT, e.to_string()))?;
    c.execute("DELETE FROM sessions WHERE token = ?1", [lumi_proto::crypto::hash_token(&req.bootstrap_token)])
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(StatusCode::CREATED)
}
