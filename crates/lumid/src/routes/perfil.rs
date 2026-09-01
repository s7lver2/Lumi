//! Subir y servir fotos de perfil (usuario y servidor). Mismo criterio que
//! `routes/images.rs`: decodificar ANTES de escribir nada, así una subida
//! que no es una imagen de verdad no deja basura en disco.

use crate::routes::access::now;
use crate::routes::auth::{bearer, require_admin, require_session};
use crate::routes::projects::{err, Fail};
use crate::{perfil, App};
use axum::extract::{Multipart, Path, State};
use axum::{http::HeaderMap, http::StatusCode, Json};

const CTYPE: axum::http::HeaderName = axum::http::header::CONTENT_TYPE;

async fn primer_campo(mp: &mut Multipart) -> Result<Vec<u8>, Fail> {
    let campo = mp
        .next_field()
        .await
        .map_err(|e| err(StatusCode::BAD_REQUEST, &e.to_string()))?
        .ok_or_else(|| err(StatusCode::BAD_REQUEST, "sin archivo"))?;
    let data = campo
        .bytes()
        .await
        .map_err(|e| err(StatusCode::BAD_REQUEST, &e.to_string()))?;
    if data.len() > perfil::MAX_BYTES {
        return Err(err(StatusCode::PAYLOAD_TOO_LARGE, "esa imagen pasa de 8 MB"));
    }
    Ok(data.to_vec())
}

fn leer_archivo(ruta: &std::path::Path) -> Result<([(axum::http::HeaderName, String); 1], Vec<u8>), StatusCode> {
    let bytes = std::fs::read(ruta).map_err(|_| StatusCode::NOT_FOUND)?;
    Ok(([(CTYPE, "image/jpeg".to_string())], bytes))
}

// --- Avatar propio ---

pub async fn subir_mi_avatar(
    State(app): State<App>,
    headers: HeaderMap,
    mut mp: Multipart,
) -> Result<StatusCode, Fail> {
    let (uid, _) = require_session(&app, &bearer(&headers)).map_err(|c| err(c, "sesión inválida"))?;
    let data = primer_campo(&mut mp).await?;
    // Decodificar y recortar (Lanczos3, el filtro más caro) es CPU pura —
    // se manda al pool de `spawn_blocking`, mismo motivo que la subida de
    // imágenes de caso.
    let ruta = perfil::ruta_avatar_usuario(&app.dir, uid);
    tokio::task::spawn_blocking(move || perfil::guardar_recortada(&data, perfil::AVATAR_SIDE, perfil::AVATAR_SIDE, &ruta))
        .await
        .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?
        .map_err(|e| err(StatusCode::UNSUPPORTED_MEDIA_TYPE, &format!("no es una imagen válida: {e}")))?;
    app.store
        .conn()
        .execute("UPDATE users SET avatar_updated_at = ?1 WHERE id = ?2", rusqlite::params![now(), uid])
        .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn borrar_mi_avatar(State(app): State<App>, headers: HeaderMap) -> Result<StatusCode, Fail> {
    let (uid, _) = require_session(&app, &bearer(&headers)).map_err(|c| err(c, "sesión inválida"))?;
    let _ = std::fs::remove_file(perfil::ruta_avatar_usuario(&app.dir, uid));
    app.store
        .conn()
        .execute("UPDATE users SET avatar_updated_at = NULL WHERE id = ?1", [uid])
        .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;
    Ok(StatusCode::NO_CONTENT)
}

/// Cualquier sesión, no solo admin: se ve en `UserTile`/`Avatar` en toda la
/// app, incluida gente sin permisos de administración.
pub async fn ver_avatar_usuario(
    State(app): State<App>,
    Path(id): Path<i64>,
    headers: HeaderMap,
) -> Result<([(axum::http::HeaderName, String); 1], Vec<u8>), StatusCode> {
    require_session(&app, &bearer(&headers))?;
    leer_archivo(&perfil::ruta_avatar_usuario(&app.dir, id))
}

// --- Perfil de servidor (admin) ---

pub async fn subir_avatar_servidor(State(app): State<App>, headers: HeaderMap, mut mp: Multipart) -> Result<StatusCode, Fail> {
    let admin = require_admin(&app, &bearer(&headers)).map_err(|c| err(c, "hace falta ser administrador"))?;
    let data = primer_campo(&mut mp).await?;
    let ruta = perfil::ruta_avatar_servidor(&app.dir);
    tokio::task::spawn_blocking(move || perfil::guardar_recortada(&data, perfil::AVATAR_SIDE, perfil::AVATAR_SIDE, &ruta))
        .await
        .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?
        .map_err(|e| err(StatusCode::UNSUPPORTED_MEDIA_TYPE, &format!("no es una imagen válida: {e}")))?;
    tracing::info!("avatar del servidor cambiado por el administrador {admin}");
    Ok(StatusCode::NO_CONTENT)
}

pub async fn borrar_avatar_servidor(State(app): State<App>, headers: HeaderMap) -> Result<StatusCode, Fail> {
    let admin = require_admin(&app, &bearer(&headers)).map_err(|c| err(c, "hace falta ser administrador"))?;
    let _ = std::fs::remove_file(perfil::ruta_avatar_servidor(&app.dir));
    tracing::info!("avatar del servidor borrado por el administrador {admin}");
    Ok(StatusCode::NO_CONTENT)
}

pub async fn subir_banner_servidor(State(app): State<App>, headers: HeaderMap, mut mp: Multipart) -> Result<StatusCode, Fail> {
    let admin = require_admin(&app, &bearer(&headers)).map_err(|c| err(c, "hace falta ser administrador"))?;
    let data = primer_campo(&mut mp).await?;
    let ruta = perfil::ruta_banner_servidor(&app.dir);
    tokio::task::spawn_blocking(move || perfil::guardar_recortada(&data, perfil::BANNER_W, perfil::BANNER_H, &ruta))
        .await
        .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?
        .map_err(|e| err(StatusCode::UNSUPPORTED_MEDIA_TYPE, &format!("no es una imagen válida: {e}")))?;
    tracing::info!("banner del servidor cambiado por el administrador {admin}");
    Ok(StatusCode::NO_CONTENT)
}

pub async fn borrar_banner_servidor(State(app): State<App>, headers: HeaderMap) -> Result<StatusCode, Fail> {
    let admin = require_admin(&app, &bearer(&headers)).map_err(|c| err(c, "hace falta ser administrador"))?;
    let _ = std::fs::remove_file(perfil::ruta_banner_servidor(&app.dir));
    tracing::info!("banner del servidor borrado por el administrador {admin}");
    Ok(StatusCode::NO_CONTENT)
}

pub async fn ver_avatar_servidor(State(app): State<App>) -> Result<([(axum::http::HeaderName, String); 1], Vec<u8>), StatusCode> {
    leer_archivo(&perfil::ruta_avatar_servidor(&app.dir))
}
pub async fn ver_banner_servidor(State(app): State<App>) -> Result<([(axum::http::HeaderName, String); 1], Vec<u8>), StatusCode> {
    leer_archivo(&perfil::ruta_banner_servidor(&app.dir))
}

pub async fn get_public(State(app): State<App>) -> Json<perfil::ServerProfile> {
    Json(perfil::leer_servidor(&app.store, &app.dir))
}

pub async fn get_admin(State(app): State<App>, headers: HeaderMap) -> Result<Json<perfil::ServerProfile>, StatusCode> {
    require_admin(&app, &bearer(&headers))?;
    Ok(Json(perfil::leer_servidor(&app.store, &app.dir)))
}

pub async fn patch(
    State(app): State<App>,
    headers: HeaderMap,
    Json(req): Json<lumi_proto::api::PatchServerProfileReq>,
) -> Result<Json<perfil::ServerProfile>, (StatusCode, String)> {
    let admin = require_admin(&app, &bearer(&headers)).map_err(|c| (c, "hace falta ser administrador".to_string()))?;
    if let Some(on) = req.active {
        perfil::set_activo(&app.store, on).map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        tracing::info!("perfil del servidor {} por el administrador {admin}", if on { "activado" } else { "desactivado" });
    }
    if let Some(title) = &req.title {
        perfil::set_titulo(&app.store, title).map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        tracing::info!("título del servidor cambiado por el administrador {admin}: {title}");
    }
    if let Some(desc) = &req.description {
        perfil::set_descripcion(&app.store, desc).map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        tracing::info!("descripción del servidor cambiada por el administrador {admin}");
    }
    Ok(Json(perfil::leer_servidor(&app.store, &app.dir)))
}
