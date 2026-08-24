//! Documento de aceptación al crear cuenta. `GET /v1/policies` es público a
//! propósito, igual que `/v1/hello`: quien todavía no tiene cuenta necesita
//! poder leerlo antes de poder crear una.

use crate::routes::auth::{bearer, require_admin};
use crate::{politicas, App};
use axum::{extract::State, http::HeaderMap, http::StatusCode, Json};
use lumi_proto::api::PatchPoliciesReq;

pub async fn get_public(State(app): State<App>) -> Json<politicas::Settings> {
    Json(politicas::leer(&app.store))
}

pub async fn get_admin(
    State(app): State<App>,
    headers: HeaderMap,
) -> Result<Json<politicas::Settings>, StatusCode> {
    require_admin(&app, &bearer(&headers))?;
    Ok(Json(politicas::leer(&app.store)))
}

pub async fn patch(
    State(app): State<App>,
    headers: HeaderMap,
    Json(req): Json<PatchPoliciesReq>,
) -> Result<Json<politicas::Settings>, (StatusCode, String)> {
    let admin = require_admin(&app, &bearer(&headers)).map_err(|c| (c, "hace falta ser administrador".to_string()))?;
    if let Some(on) = req.active {
        politicas::set_active(&app.store, on).map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        tracing::info!("políticas de aceptación {} por el administrador {admin}", if on { "activadas" } else { "desactivadas" });
    }
    if let Some(title) = &req.title {
        politicas::set_title(&app.store, title).map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        tracing::info!("título de las políticas cambiado por el administrador {admin}: {title}");
    }
    if let Some(content) = &req.content {
        politicas::set_content(&app.store, content).map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        tracing::info!("contenido de las políticas cambiado por el administrador {admin}");
    }
    Ok(Json(politicas::leer(&app.store)))
}
