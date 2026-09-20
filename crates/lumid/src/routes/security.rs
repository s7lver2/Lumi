//! Ajustes de Zero Trust: el modo, el autoservicio de IP, y las listas
//! globales de IP. La aplicación de estas reglas vive en `zero_trust.rs`;
//! aquí solo se leen y se escriben.

use crate::routes::access::now;
use crate::routes::auth::{bearer, require_admin};
use crate::App;
use axum::extract::{Query, State};
use axum::{http::HeaderMap, http::StatusCode, Json};
use lumi_proto::api::{IpReq, PatchSecurityReq, SecuritySettings};

const CLAVE_INACTIVIDAD_TIMEOUT_S: &str = "inactivity_timeout_s";

/// `0` (desactivado) por defecto -- expulsar por inactividad es una política
/// que un administrador tiene que activar a propósito, no algo que aparezca
/// solo. Se lee también desde `/v1/hello` (sin auth): el cliente necesita
/// este valor para aplicarlo él mismo, no solo el panel de admin.
pub fn inactivity_timeout_s(store: &crate::store::Store) -> u64 {
    store.get_meta(CLAVE_INACTIVIDAD_TIMEOUT_S).and_then(|v| v.parse().ok()).unwrap_or(0)
}

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
        inactivity_timeout_s: inactivity_timeout_s(&app.store),
    }))
}

pub async fn patch_security(
    State(app): State<App>,
    headers: HeaderMap,
    Json(req): Json<PatchSecurityReq>,
) -> Result<Json<SecuritySettings>, (StatusCode, String)> {
    let admin = require_admin(&app, &bearer(&headers)).map_err(|c| (c, "hace falta ser administrador".to_string()))?;
    if let Some(on) = req.zero_trust {
        crate::zero_trust::set_zero_trust(&app, on).map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        tracing::info!("Zero Trust {} por el administrador {admin}", if on { "activado" } else { "desactivado" });
    }
    if let Some(on) = req.self_service_ip {
        crate::zero_trust::set_self_service_ip(&app, on)
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        tracing::info!("autoservicio de IP {} por el administrador {admin}", if on { "activado" } else { "desactivado" });
    }
    if let Some(on) = req.maintenance {
        crate::mantenimiento::set_activo(&app, on).map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        tracing::info!("modo mantenimiento {} por el administrador {admin}", if on { "activado" } else { "desactivado" });
    }
    if let Some(msg) = &req.maintenance_message {
        crate::mantenimiento::set_mensaje(&app, msg).map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        tracing::info!("mensaje de mantenimiento cambiado por el administrador {admin}");
    }
    if let Some(on) = req.maintenance_block_login {
        crate::mantenimiento::set_bloquea_login(&app, on)
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        tracing::info!(
            "bloqueo de login en mantenimiento {} por el administrador {admin}",
            if on { "activado" } else { "desactivado" }
        );
    }
    if let Some(ids) = &req.maintenance_services {
        crate::mantenimiento::set_servicios(&app, ids).map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        tracing::info!("servicios habilitados en mantenimiento cambiados por el administrador {admin}: {ids:?}");
    }
    if let Some(v) = req.inactivity_timeout_s {
        // `0` desactiva -- cualquier otro valor se acota a 1-120 minutos: por
        // debajo de un minuto expulsaría en mitad de mirar una foto, y no
        // hay razón para dejar guardar horas bajo el nombre de "inactividad".
        if v != 0 && !(60..=7200).contains(&v) {
            return Err((StatusCode::BAD_REQUEST, "debe ser 0 (desactivado) o estar entre 60 y 7200 segundos".to_string()));
        }
        app.store
            .set_meta(CLAVE_INACTIVIDAD_TIMEOUT_S, &v.to_string())
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        tracing::info!("timeout de inactividad fijado a {v}s por el administrador {admin}");
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
    let admin = require_admin(&app, &bearer(&headers)).map_err(|c| (c, "hace falta ser administrador".to_string()))?;
    app.store
        .conn()
        .execute(
            "INSERT OR IGNORE INTO ip_allowlist (ip, added_at) VALUES (?1, ?2)",
            rusqlite::params![req.ip, now()],
        )
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    tracing::info!("IP {} añadida a la lista blanca por el administrador {admin}", req.ip);
    Ok(StatusCode::NO_CONTENT)
}

pub async fn remove_allow(State(app): State<App>, headers: HeaderMap, Query(q): Query<IpQuery>) -> Result<StatusCode, StatusCode> {
    let admin = require_admin(&app, &bearer(&headers))?;
    app.store
        .conn()
        .execute("DELETE FROM ip_allowlist WHERE ip = ?1", [&q.ip])
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    tracing::info!("IP {} quitada de la lista blanca por el administrador {admin}", q.ip);
    Ok(StatusCode::NO_CONTENT)
}

pub async fn add_deny(
    State(app): State<App>,
    headers: HeaderMap,
    Json(req): Json<IpReq>,
) -> Result<StatusCode, (StatusCode, String)> {
    let admin = require_admin(&app, &bearer(&headers)).map_err(|c| (c, "hace falta ser administrador".to_string()))?;
    app.store
        .conn()
        .execute(
            "INSERT OR IGNORE INTO ip_denylist (ip, added_at) VALUES (?1, ?2)",
            rusqlite::params![req.ip, now()],
        )
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    crate::zero_trust::invalidar_denylist();
    tracing::info!("IP {} añadida a la lista negra por el administrador {admin}", req.ip);
    Ok(StatusCode::NO_CONTENT)
}

pub async fn remove_deny(State(app): State<App>, headers: HeaderMap, Query(q): Query<IpQuery>) -> Result<StatusCode, StatusCode> {
    let admin = require_admin(&app, &bearer(&headers))?;
    app.store
        .conn()
        .execute("DELETE FROM ip_denylist WHERE ip = ?1", [&q.ip])
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    crate::zero_trust::invalidar_denylist();
    tracing::info!("IP {} quitada de la lista negra por el administrador {admin}", q.ip);
    Ok(StatusCode::NO_CONTENT)
}
