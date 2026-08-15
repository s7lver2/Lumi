//! Ajustes de Zero Trust: el modo, el autoservicio de IP, y las listas
//! globales de IP. La aplicación de estas reglas vive en `zero_trust.rs`;
//! aquí solo se leen y se escriben.

use crate::routes::access::now;
use crate::routes::auth::{bearer, require_admin};
use crate::App;
use axum::extract::{Query, State};
use axum::{http::HeaderMap, http::StatusCode, Json};
use lumi_proto::api::{IpReq, PatchSecurityReq, SecuritySettings};

pub async fn get_security(State(app): State<App>, headers: HeaderMap) -> Result<Json<SecuritySettings>, StatusCode> {
    require_admin(&app, &bearer(&headers))?;
    Ok(Json(SecuritySettings {
        zero_trust: crate::zero_trust::zero_trust(&app),
        self_service_ip: crate::zero_trust::self_service_ip(&app),
        allowlist: crate::zero_trust::allowlist(&app),
        denylist: crate::zero_trust::denylist(&app),
        maintenance: crate::mantenimiento::activo(&app),
        maintenance_message: crate::mantenimiento::mensaje(&app),
        maintenance_block_login: crate::mantenimiento::bloquea_login(&app),
        maintenance_services: crate::mantenimiento::servicios_habilitados(&app),
    }))
}

pub async fn patch_security(
    State(app): State<App>,
    headers: HeaderMap,
    Json(req): Json<PatchSecurityReq>,
) -> Result<Json<SecuritySettings>, (StatusCode, String)> {
    require_admin(&app, &bearer(&headers)).map_err(|c| (c, "hace falta ser administrador".to_string()))?;
    if let Some(on) = req.zero_trust {
        crate::zero_trust::set_zero_trust(&app, on).map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    }
    if let Some(on) = req.self_service_ip {
        crate::zero_trust::set_self_service_ip(&app, on)
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    }
    if let Some(on) = req.maintenance {
        crate::mantenimiento::set_activo(&app, on).map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    }
    if let Some(msg) = &req.maintenance_message {
        crate::mantenimiento::set_mensaje(&app, msg).map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    }
    if let Some(on) = req.maintenance_block_login {
        crate::mantenimiento::set_bloquea_login(&app, on)
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    }
    if let Some(ids) = &req.maintenance_services {
        crate::mantenimiento::set_servicios(&app, ids).map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    }
    get_security(State(app), headers).await.map_err(|c| (c, "no se pudo releer los ajustes".to_string()))
}

#[derive(serde::Deserialize)]
pub struct IpQuery {
    pub ip: String,
}

pub async fn add_allow(
    State(app): State<App>,
    headers: HeaderMap,
    Json(req): Json<IpReq>,
) -> Result<StatusCode, (StatusCode, String)> {
    require_admin(&app, &bearer(&headers)).map_err(|c| (c, "hace falta ser administrador".to_string()))?;
    app.store
        .conn()
        .execute(
            "INSERT OR IGNORE INTO ip_allowlist (ip, added_at) VALUES (?1, ?2)",
            rusqlite::params![req.ip, now()],
        )
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn remove_allow(State(app): State<App>, headers: HeaderMap, Query(q): Query<IpQuery>) -> Result<StatusCode, StatusCode> {
    require_admin(&app, &bearer(&headers))?;
    app.store
        .conn()
        .execute("DELETE FROM ip_allowlist WHERE ip = ?1", [&q.ip])
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn add_deny(
    State(app): State<App>,
    headers: HeaderMap,
    Json(req): Json<IpReq>,
) -> Result<StatusCode, (StatusCode, String)> {
    require_admin(&app, &bearer(&headers)).map_err(|c| (c, "hace falta ser administrador".to_string()))?;
    app.store
        .conn()
        .execute(
            "INSERT OR IGNORE INTO ip_denylist (ip, added_at) VALUES (?1, ?2)",
            rusqlite::params![req.ip, now()],
        )
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn remove_deny(State(app): State<App>, headers: HeaderMap, Query(q): Query<IpQuery>) -> Result<StatusCode, StatusCode> {
    require_admin(&app, &bearer(&headers))?;
    app.store
        .conn()
        .execute("DELETE FROM ip_denylist WHERE ip = ?1", [&q.ip])
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(StatusCode::NO_CONTENT)
}
