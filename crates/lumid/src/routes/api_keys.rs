//! Gestión de claves de API. Una clave es una fila más en `sessions`
//! (`kind = 'api_key'`): el mismo camino de autenticación que un login, sin
//! sistema propio que mantener aparte.

use crate::routes::access::now;
use crate::routes::auth::{bearer, require_admin, require_session};
use crate::App;
use axum::extract::{Path, State};
use axum::{http::HeaderMap, http::StatusCode, Json};
use lumi_proto::api::{ApiKeyInfo, IssueApiKeyReq, IssuedApiKey, PatchApiKeyReq};

fn map_row(r: &rusqlite::Row) -> rusqlite::Result<ApiKeyInfo> {
    let token: String = r.get(2)?;
    let label: Option<String> = r.get(1)?;
    let expires_at: i64 = r.get(5)?;
    let ips: Option<String> = r.get(6)?;
    let devices: Option<String> = r.get(7)?;
    let parse = |s: Option<String>| -> Vec<String> {
        s.and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
    };
    Ok(ApiKeyInfo {
        public_id: r.get(0)?,
        label: label.unwrap_or_default(),
        prefix: if token.len() > 20 {
            format!("{}…{}", &token[..16], &token[token.len() - 4..])
        } else {
            token.clone()
        },
        owner_username: r.get(8)?,
        owner_is_service: r.get::<_, i64>(9)? == 1,
        created_at: r.get(3)?,
        last_seen: r.get(4)?,
        expires_at: if expires_at == i64::MAX { None } else { Some(expires_at) },
        ips: parse(ips),
        devices: parse(devices),
    })
}

const SELECT_CLAVE: &str = "SELECT s.public_id, s.label, s.token, s.created_at, s.last_seen, s.expires_at,
                                    s.ips, s.devices, u.username, u.is_service
                             FROM sessions s JOIN users u ON u.id = s.user_id
                             WHERE s.kind = 'api_key'";

fn listar(app: &App, solo_uid: Option<i64>) -> Vec<ApiKeyInfo> {
    let c = app.store.conn();
    let sql = match solo_uid {
        Some(_) => format!("{SELECT_CLAVE} AND s.user_id = ?1 ORDER BY s.created_at DESC"),
        None => format!("{SELECT_CLAVE} ORDER BY s.created_at DESC"),
    };
    let Ok(mut q) = c.prepare(&sql) else { return Vec::new() };
    let filas = match solo_uid {
        Some(uid) => q.query_map([uid], map_row),
        None => q.query_map([], map_row),
    };
    filas.map(|f| f.flatten().collect()).unwrap_or_default()
}

fn key_row(app: &App, public_id: &str) -> Option<ApiKeyInfo> {
    app.store
        .conn()
        .query_row(&format!("{SELECT_CLAVE} AND s.public_id = ?1"), [public_id], |r| map_row(r))
        .ok()
}

pub async fn list_mine(State(app): State<App>, headers: HeaderMap) -> Result<Json<Vec<ApiKeyInfo>>, StatusCode> {
    let (uid, _) = require_session(&app, &bearer(&headers))?;
    Ok(Json(listar(&app, Some(uid))))
}

pub async fn list_all(State(app): State<App>, headers: HeaderMap) -> Result<Json<Vec<ApiKeyInfo>>, StatusCode> {
    require_admin(&app, &bearer(&headers))?;
    Ok(Json(listar(&app, None)))
}

fn crear_usuario_de_sistema(app: &App, name: &str) -> anyhow::Result<i64> {
    // Sin contraseña utilizable: un hash de un secreto aleatorio que nadie
    // conoce, así que ningún intento de login por formulario puede acertarlo.
    let phc = lumi_proto::crypto::hash_password(&crate::routes::claim::new_token())?;
    app.store.conn().execute(
        "INSERT INTO users (username, password_phc, is_admin, is_service, created_at) VALUES (?1, ?2, 0, 1, ?3)",
        rusqlite::params![name, phc, now()],
    )?;
    Ok(app.store.conn().last_insert_rowid())
}

pub async fn create(
    State(app): State<App>,
    headers: HeaderMap,
    Json(req): Json<IssueApiKeyReq>,
) -> Result<Json<IssuedApiKey>, (StatusCode, String)> {
    let (caller_id, caller_admin) =
        require_session(&app, &bearer(&headers)).map_err(|c| (c, "sesión inválida".to_string()))?;

    let target_user_id = if req.user_id.is_some() || req.service_name.is_some() {
        if !caller_admin {
            return Err((StatusCode::FORBIDDEN, "hace falta ser administrador para emitir en nombre de otro".into()));
        }
        match req.user_id {
            Some(uid) => uid,
            None => {
                let name = req
                    .service_name
                    .as_deref()
                    .map(str::trim)
                    .filter(|s| !s.is_empty())
                    .ok_or((StatusCode::BAD_REQUEST, "falta el nombre de la identidad de sistema".to_string()))?;
                crear_usuario_de_sistema(&app, name)
                    .map_err(|e| (StatusCode::BAD_REQUEST, format!("no se pudo crear la identidad: {e}")))?
            }
        }
    } else {
        caller_id
    };

    let es_para_uno_mismo = target_user_id == caller_id && !caller_admin;
    if !req.ips.is_empty() {
        if !crate::zero_trust::zero_trust(&app) {
            return Err((StatusCode::BAD_REQUEST, "activa Zero Trust antes de fijar IPs por clave".into()));
        }
        if es_para_uno_mismo && !crate::zero_trust::self_service_ip(&app) {
            return Err((StatusCode::FORBIDDEN, "el autoservicio de IP está desactivado".into()));
        }
    }

    let secret = format!("lumi_ak_{}", crate::routes::claim::new_token());
    let public_id = crate::routes::claim::new_token();
    let t = now();
    let expires_at = req.expires_in_days.map(|d| t + d * 86_400).unwrap_or(i64::MAX);
    let ips_json = serde_json::to_string(&req.ips).unwrap();
    let devices_json = serde_json::to_string(&req.devices).unwrap();

    app.store
        .conn()
        .execute(
            "INSERT INTO sessions (token, user_id, expires_at, created_at, last_seen, public_id, label, kind, ips, devices)
             VALUES (?1, ?2, ?3, ?4, ?4, ?5, ?6, 'api_key', ?7, ?8)",
            rusqlite::params![secret, target_user_id, expires_at, t, public_id, req.label, ips_json, devices_json],
        )
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let info = key_row(&app, &public_id)
        .ok_or((StatusCode::INTERNAL_SERVER_ERROR, "no se pudo releer la clave recién creada".to_string()))?;
    Ok(Json(IssuedApiKey { key: secret, info }))
}

/// Revoca por identificador público, nunca por token — mismo criterio que
/// `routes::auth::revoke_session`.
pub async fn revoke(
    State(app): State<App>,
    Path(public_id): Path<String>,
    headers: HeaderMap,
) -> Result<StatusCode, StatusCode> {
    let (uid, is_admin) = require_session(&app, &bearer(&headers))?;
    let c = app.store.conn();
    let n = if is_admin {
        c.execute("DELETE FROM sessions WHERE public_id = ?1 AND kind = 'api_key'", [&public_id])
    } else {
        c.execute(
            "DELETE FROM sessions WHERE public_id = ?1 AND kind = 'api_key' AND user_id = ?2",
            rusqlite::params![public_id, uid],
        )
    }
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    if n == 0 {
        return Err(StatusCode::NOT_FOUND);
    }
    Ok(StatusCode::NO_CONTENT)
}

pub async fn patch_ips(
    State(app): State<App>,
    Path(public_id): Path<String>,
    headers: HeaderMap,
    Json(req): Json<PatchApiKeyReq>,
) -> Result<Json<ApiKeyInfo>, (StatusCode, String)> {
    let (uid, is_admin) =
        require_session(&app, &bearer(&headers)).map_err(|c| (c, "sesión inválida".to_string()))?;
    let owner: i64 = app
        .store
        .conn()
        .query_row(
            "SELECT user_id FROM sessions WHERE public_id = ?1 AND kind = 'api_key'",
            [&public_id],
            |r| r.get(0),
        )
        .map_err(|_| (StatusCode::NOT_FOUND, "no existe esa clave".to_string()))?;
    if owner != uid && !is_admin {
        return Err((StatusCode::FORBIDDEN, "no es tu clave".to_string()));
    }
    if owner == uid && !is_admin
        && (!crate::zero_trust::zero_trust(&app) || !crate::zero_trust::self_service_ip(&app))
    {
        return Err((StatusCode::FORBIDDEN, "el autoservicio de IP está desactivado".to_string()));
    }
    if let Some(ips) = &req.ips {
        let ips_json = serde_json::to_string(ips).unwrap();
        app.store
            .conn()
            .execute("UPDATE sessions SET ips = ?1 WHERE public_id = ?2", rusqlite::params![ips_json, public_id])
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    }
    key_row(&app, &public_id)
        .map(Json)
        .ok_or((StatusCode::INTERNAL_SERVER_ERROR, "no se pudo releer la clave".to_string()))
}
