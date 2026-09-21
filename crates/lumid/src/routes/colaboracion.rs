//! GET/PATCH de la sección «Colaboración» del panel de administración: la
//! exclusividad del candado de caso, su plazo de liberación por inactividad,
//! quién puede expulsar a quien lo tiene, y el tope de personas simultáneas
//! por proyecto. Mismo patrón que `routes::rendimiento`: meta clave-valor en
//! `Store`, sin tabla propia (Darkroom Fase 1 spec, Parte 4).

use crate::routes::auth::{bearer, require_admin};
use crate::App;
use axum::extract::State;
use axum::{http::HeaderMap, http::StatusCode, Json};
use lumi_proto::api::{ColaboracionSettings, PatchColaboracionReq};

const CLAVE_EXCLUSIVO: &str = "caso_exclusivo";
const CLAVE_LIBERAR_S: &str = "caso_liberar_s";
const CLAVE_EXPULSAR_ROL: &str = "caso_expulsar_rol";
const CLAVE_MAX_PERSONAS: &str = "proyecto_max_personas";

const DEFECTO_LIBERAR_S: i64 = 1800;
const DEFECTO_EXPULSAR_ROL: &str = "admin_o_dueno";

/// El candado se sigue tomando y mostrando con este ajuste apagado -- lo
/// único que cambia es que `guard_case` deja de hacerlo cumplir (spec Parte
/// 4, "Qué pasa con la exclusividad apagada"). Nace activado.
pub fn caso_exclusivo(app: &App) -> bool {
    app.store.get_meta(CLAVE_EXCLUSIVO).as_deref() != Some("0")
}

pub fn caso_liberar_s(app: &App) -> i64 {
    app.store.get_meta(CLAVE_LIBERAR_S).and_then(|v| v.parse().ok()).unwrap_or(DEFECTO_LIBERAR_S)
}

pub fn caso_expulsar_rol(app: &App) -> String {
    app.store.get_meta(CLAVE_EXPULSAR_ROL).unwrap_or_else(|| DEFECTO_EXPULSAR_ROL.to_string())
}

pub fn proyecto_max_personas(app: &App) -> i64 {
    app.store.get_meta(CLAVE_MAX_PERSONAS).and_then(|v| v.parse().ok()).unwrap_or(0)
}

fn settings(app: &App) -> ColaboracionSettings {
    ColaboracionSettings {
        caso_exclusivo: caso_exclusivo(app),
        caso_liberar_s: caso_liberar_s(app),
        caso_expulsar_rol: caso_expulsar_rol(app),
        proyecto_max_personas: proyecto_max_personas(app),
    }
}

pub async fn get(State(app): State<App>, headers: HeaderMap) -> Result<Json<ColaboracionSettings>, StatusCode> {
    require_admin(&app, &bearer(&headers))?;
    Ok(Json(settings(&app)))
}

pub async fn patch(
    State(app): State<App>,
    headers: HeaderMap,
    Json(req): Json<PatchColaboracionReq>,
) -> Result<Json<ColaboracionSettings>, (StatusCode, String)> {
    let admin = require_admin(&app, &bearer(&headers)).map_err(|c| (c, "hace falta ser administrador".to_string()))?;
    if let Some(v) = req.caso_exclusivo {
        app.store
            .set_meta(CLAVE_EXCLUSIVO, if v { "1" } else { "0" })
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        tracing::info!("exclusividad de caso {} por el administrador {admin}", if v { "activada" } else { "desactivada" });
    }
    if let Some(v) = req.caso_liberar_s {
        if !(60..=86400).contains(&v) {
            return Err((StatusCode::BAD_REQUEST, "debe estar entre 60 y 86400 segundos".to_string()));
        }
        app.store
            .set_meta(CLAVE_LIBERAR_S, &v.to_string())
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        tracing::info!("plazo de liberación de caso fijado a {v}s por el administrador {admin}");
    }
    if let Some(v) = req.caso_expulsar_rol {
        if !["admin", "admin_o_dueno", "cualquier_miembro"].contains(&v.as_str()) {
            return Err((StatusCode::BAD_REQUEST, "debe ser \"admin\", \"admin_o_dueno\" o \"cualquier_miembro\"".to_string()));
        }
        app.store
            .set_meta(CLAVE_EXPULSAR_ROL, &v)
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        tracing::info!("rol de expulsión de caso fijado a \"{v}\" por el administrador {admin}");
    }
    if let Some(v) = req.proyecto_max_personas {
        if v < 0 {
            return Err((StatusCode::BAD_REQUEST, "no puede ser negativo".to_string()));
        }
        app.store
            .set_meta(CLAVE_MAX_PERSONAS, &v.to_string())
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        tracing::info!("tope de personas por proyecto fijado a {v} por el administrador {admin}");
    }
    Ok(Json(settings(&app)))
}
