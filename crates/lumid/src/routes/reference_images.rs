//! La foto de referencia que sostiene una hipótesis (ver
//! `lumi_index::agrupar::Grupo::imagen_id`). Solo miniatura: el investigador
//! compara contra su propia foto, no necesita el original a resolución
//! completa del corpus.
//!
//! A diferencia de `routes/images.rs`, aquí no hay miniatura precalculada al
//! subir -- las fotos de referencia llegan ya selladas dentro de un
//! `.lumidx` instalado, sin ese paso. Se genera la primera vez que alguien la
//! pide y se cachea al lado, mismo criterio que las teselas del mapa
//! (`routes/map.rs`): sin caducidad, porque una foto de referencia instalada
//! nunca cambia de contenido bajo el mismo id.

use crate::routes::auth::{bearer, require_session};
use crate::routes::projects::{err, Fail};
use crate::App;
use axum::extract::{Path, State};
use axum::{http::HeaderMap, http::StatusCode};

/// Mismo lado que `routes/images.rs::THUMB`: 320 px basta para comparar al
/// lado de tu propia foto, no hace falta más.
const THUMB: u32 = 320;

fn cache_path(app: &App, id: i64) -> std::path::PathBuf {
    app.dir.join("ref_thumbs").join(format!("{id}.jpg"))
}

pub async fn serve_thumb(
    State(app): State<App>,
    Path(id): Path<i64>,
    headers: HeaderMap,
) -> Result<([(axum::http::HeaderName, String); 2], Vec<u8>), Fail> {
    require_session(&app, &bearer(&headers)).map_err(|c| (c, "sesión inválida".to_string()))?;

    let cache = cache_path(&app, id);
    if let Ok(bytes) = std::fs::read(&cache) {
        return Ok((
            [
                (axum::http::header::CONTENT_TYPE, "image/jpeg".to_string()),
                (axum::http::header::CACHE_CONTROL, "private, max-age=31536000, immutable".into()),
            ],
            bytes,
        ));
    }

    let ruta: String = app
        .store
        .conn()
        .query_row("SELECT ruta FROM reference_images WHERE id = ?1", [id], |r| r.get(0))
        .map_err(|_| err(StatusCode::NOT_FOUND, "no existe esa imagen de referencia"))?;

    // `spawn_blocking`: decodificar y redimensionar es trabajo de CPU, no
    // async de verdad -- mismo motivo que `procesar_imagen` en `images.rs`.
    let bytes = tokio::task::spawn_blocking(move || -> Result<Vec<u8>, String> {
        let datos = std::fs::read(&ruta).map_err(|e| e.to_string())?;
        let decoded = image::load_from_memory(&datos).map_err(|e| e.to_string())?;
        let mini = decoded.thumbnail(THUMB, THUMB);
        let mut buf = std::io::Cursor::new(Vec::new());
        mini.to_rgb8()
            .write_to(&mut buf, image::ImageFormat::Jpeg)
            .map_err(|e| e.to_string())?;
        Ok(buf.into_inner())
    })
    .await
    .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?
    .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &format!("no se pudo generar la miniatura: {e}")))?;

    if let Some(parent) = cache.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let _ = std::fs::write(&cache, &bytes);

    Ok((
        [
            (axum::http::header::CONTENT_TYPE, "image/jpeg".to_string()),
            (axum::http::header::CACHE_CONTROL, "private, max-age=31536000, immutable".into()),
        ],
        bytes,
    ))
}
