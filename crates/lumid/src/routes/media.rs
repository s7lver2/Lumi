//! Panel "Media" en el drawer derecho (spec 2026-09-10 §3): carpetas
//! virtuales sobre las imágenes que ya existen, "Sobrescribir"/"Guardar como
//! copia" desde el editor, y el aviso de sha256 desincronizado. No toca el
//! pipeline de análisis ni el hash de integridad que ya usa `export.rs` —
//! reutiliza el mismo cálculo (`sha256_de_fichero`, aquí duplicado como
//! función libre porque `export.rs` la tiene privada al módulo) en vez de
//! reescribirlo.
//!
//! El listado de imágenes NO vive aquí: modo caso es `GET
//! /v1/cases/:id/images` (ya existía) y modo proyecto es `GET
//! /v1/projects/:id/images` (ya existía, gateada en el cliente por
//! `media_por_proyecto_activo`) -- este módulo es solo lo que de verdad es
//! nuevo: carpetas, mover, sobrescribir/copiar, y el aviso de desincronía.

use crate::routes::auth::{bearer, require_session};
use crate::routes::cases::guard_case;
use crate::routes::images::{dir_for, row_to_image, sobrescribir_bytes, COLS};
use crate::routes::projects::{err, Fail};
use crate::App;
use axum::extract::{Multipart, Path, Query, State};
use axum::{http::HeaderMap, http::StatusCode, Json};
use lumi_proto::api::{
    AnalisisDesincronizado, CrearCarpetaReq, Image, MediaFolder, MoverImagenReq,
};

fn media_por_proyecto_activo(app: &App) -> bool {
    app.store.get_meta(crate::routes::features::CLAVE_MEDIA_PROYECTO).as_deref() == Some("1")
}

#[derive(serde::Deserialize)]
pub struct ModoQuery {
    #[serde(default)]
    pub modo: Option<String>,
}

/// `true` si `modo=proyecto` -- y en ese caso, exige que el interruptor esté
/// activo. Con `modo` ausente o `"caso"`, siempre es modo caso, sin
/// depender de ningún interruptor: es el que existe siempre.
fn modo_proyecto(app: &App, q: &ModoQuery) -> Result<bool, Fail> {
    let quiere_proyecto = q.modo.as_deref() == Some("proyecto");
    if quiere_proyecto && !media_por_proyecto_activo(app) {
        return Err(err(StatusCode::FORBIDDEN, "el modo proyecto de Media no está activado en este servidor"));
    }
    Ok(quiere_proyecto)
}

fn row_to_folder(r: &rusqlite::Row) -> rusqlite::Result<MediaFolder> {
    Ok(MediaFolder { id: r.get(0)?, nombre: r.get(1)?, created_at: r.get(2)? })
}

/// Las carpetas visibles para este caso en el modo pedido: las suyas propias
/// en modo caso, las de su proyecto en modo proyecto -- nunca las dos mezcladas
/// (una carpeta de caso de OTRO caso del mismo proyecto no debe aparecer aquí).
pub async fn listar_carpetas(
    State(app): State<App>,
    Path(case_id): Path<i64>,
    headers: HeaderMap,
    Query(q): Query<ModoQuery>,
) -> Result<Json<Vec<MediaFolder>>, Fail> {
    let (_, pid, _) = guard_case(&app, &headers, case_id)?;
    let proyecto = modo_proyecto(&app, &q)?;
    let c = app.store.conn();
    let (sql, param) = if proyecto {
        ("SELECT id, nombre, created_at FROM media_folders WHERE project_id = ?1 ORDER BY nombre", pid)
    } else {
        ("SELECT id, nombre, created_at FROM media_folders WHERE case_id = ?1 ORDER BY nombre", case_id)
    };
    let mut stmt = c.prepare(sql).map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;
    let filas = stmt
        .query_map([param], row_to_folder)
        .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?
        .flatten()
        .collect();
    Ok(Json(filas))
}

pub async fn crear_carpeta(
    State(app): State<App>,
    Path(case_id): Path<i64>,
    headers: HeaderMap,
    Query(q): Query<ModoQuery>,
    Json(req): Json<CrearCarpetaReq>,
) -> Result<Json<MediaFolder>, Fail> {
    let (_, pid, _) = guard_case(&app, &headers, case_id)?;
    let proyecto = modo_proyecto(&app, &q)?;
    let nombre = req.nombre.trim();
    if nombre.is_empty() {
        return Err(err(StatusCode::BAD_REQUEST, "hace falta un nombre"));
    }
    let t = crate::routes::access::now();
    let c = app.store.conn();
    if proyecto {
        c.execute(
            "INSERT INTO media_folders (project_id, nombre, created_at) VALUES (?1, ?2, ?3)",
            rusqlite::params![pid, nombre, t],
        )
    } else {
        c.execute(
            "INSERT INTO media_folders (case_id, nombre, created_at) VALUES (?1, ?2, ?3)",
            rusqlite::params![case_id, nombre, t],
        )
    }
    .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;
    let id = c.last_insert_rowid();
    Ok(Json(MediaFolder { id, nombre: nombre.to_string(), created_at: t }))
}

/// Borrar una carpeta es organización, nunca un contenedor de vida o muerte
/// de una imagen: `ON DELETE SET NULL` en `images.folder_id` ya deja sus
/// imágenes en "Sin carpeta" solo con este `DELETE`.
pub async fn borrar_carpeta(
    State(app): State<App>,
    Path(id): Path<i64>,
    headers: HeaderMap,
) -> Result<StatusCode, Fail> {
    let (uid, _) = require_session(&app, &bearer(&headers)).map_err(|c| (c, "sesión inválida".into()))?;
    let (case_id, project_id): (Option<i64>, Option<i64>) = app
        .store
        .conn()
        .query_row("SELECT case_id, project_id FROM media_folders WHERE id = ?1", [id], |r| {
            Ok((r.get(0)?, r.get(1)?))
        })
        .map_err(|_| err(StatusCode::NOT_FOUND, "no existe esa carpeta"))?;
    let pid = match (case_id, project_id) {
        (Some(cid), _) => crate::projects::project_of_case(&app.store, cid),
        (_, Some(pid)) => Some(pid),
        _ => None,
    };
    let Some(pid) = pid else { return Err(err(StatusCode::NOT_FOUND, "no existe esa carpeta")) };
    crate::projects::access(&app.store, uid, pid).ok_or_else(|| err(StatusCode::FORBIDDEN, "sin acceso"))?;
    app.store
        .conn()
        .execute("DELETE FROM media_folders WHERE id = ?1", [id])
        .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;
    Ok(StatusCode::NO_CONTENT)
}

/// Mover una imagen de carpeta: un `UPDATE` de una columna, tal y como dice
/// el spec. `folder_id: None` la vuelve a "Sin carpeta".
pub async fn mover_imagen(
    State(app): State<App>,
    Path(id): Path<i64>,
    headers: HeaderMap,
    Json(req): Json<MoverImagenReq>,
) -> Result<Json<Image>, Fail> {
    let (uid, _) = require_session(&app, &bearer(&headers)).map_err(|c| (c, "sesión inválida".into()))?;
    let case_id: i64 = app
        .store
        .conn()
        .query_row("SELECT case_id FROM images WHERE id = ?1", [id], |r| r.get(0))
        .map_err(|_| err(StatusCode::NOT_FOUND, "no existe esa imagen"))?;
    let (_, pid, _) = guard_case(&app, &headers, case_id)?;
    let _ = uid;
    // Si se manda una carpeta, tiene que ser una visible desde este caso
    // (de este caso, o de su proyecto) -- sin esto, un id de carpeta ajena
    // colaría una imagen a la organización de otro caso/proyecto.
    if let Some(folder_id) = req.folder_id {
        let visible: i64 = app
            .store
            .conn()
            .query_row(
                "SELECT COUNT(*) FROM media_folders WHERE id = ?1 AND (case_id = ?2 OR project_id = ?3)",
                rusqlite::params![folder_id, case_id, pid],
                |r| r.get(0),
            )
            .unwrap_or(0);
        if visible == 0 {
            return Err(err(StatusCode::BAD_REQUEST, "esa carpeta no es visible desde este caso"));
        }
    }
    app.store
        .conn()
        .execute("UPDATE images SET folder_id = ?2 WHERE id = ?1", rusqlite::params![id, req.folder_id])
        .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;
    let img = app
        .store
        .conn()
        .query_row(&format!("SELECT {COLS} FROM images WHERE id = ?1"), [id], row_to_image)
        .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;
    Ok(Json(img))
}

/// Qué análisis de esta imagen quedaron mirando una versión anterior --
/// comparando `analyses.imagen_sha256` (el que tenía la imagen cuando ESE
/// análisis se lanzó, columna rellenada en `analyses::create`/
/// `images::upscale`) contra el `sha256` actual de la fila `images`. Vacío
/// en la inmensa mayoría de imágenes, que nunca se sobrescriben.
pub async fn analisis_desincronizados(
    State(app): State<App>,
    Path(id): Path<i64>,
    headers: HeaderMap,
) -> Result<Json<Vec<AnalisisDesincronizado>>, Fail> {
    let case_id: i64 = app
        .store
        .conn()
        .query_row("SELECT case_id FROM images WHERE id = ?1", [id], |r| r.get(0))
        .map_err(|_| err(StatusCode::NOT_FOUND, "no existe esa imagen"))?;
    guard_case(&app, &headers, case_id)?;
    let c = app.store.conn();
    let mut q = c
        .prepare(
            "SELECT a.id, a.model, a.agente, a.created_at
               FROM analyses a
               JOIN analysis_images ai ON ai.analysis_id = a.id
               JOIN images i ON i.id = ai.image_id
              WHERE ai.image_id = ?1
                AND a.imagen_sha256 IS NOT NULL
                AND a.imagen_sha256 != i.sha256",
        )
        .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;
    let filas = q
        .query_map([id], |r| {
            Ok(AnalisisDesincronizado {
                analysis_id: r.get(0)?,
                model: r.get(1)?,
                agente: r.get(2)?,
                created_at: r.get(3)?,
            })
        })
        .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?
        .flatten()
        .collect();
    Ok(Json(filas))
}

async fn leer_campo_unico(mp: &mut Multipart) -> Result<Vec<u8>, Fail> {
    let Some(field) = mp.next_field().await.map_err(|e| err(StatusCode::BAD_REQUEST, &e.to_string()))? else {
        return Err(err(StatusCode::BAD_REQUEST, "hace falta una imagen"));
    };
    Ok(field.bytes().await.map_err(|e| err(StatusCode::BAD_REQUEST, &e.to_string()))?.to_vec())
}

/// "Sobrescribir" del editor (spec 2026-09-10 §3, punto "editar desde Media"):
/// reemplaza los bytes de la fila EXISTENTE, mismo `id`. Los análisis previos
/// no se tocan -- `analisis_desincronizados` es quien detecta la desincronía
/// después, comparando hashes, nunca este endpoint reescribiéndolos.
pub async fn sobrescribir(
    State(app): State<App>,
    Path(id): Path<i64>,
    headers: HeaderMap,
    mut mp: Multipart,
) -> Result<Json<Image>, Fail> {
    let case_id: i64 = app
        .store
        .conn()
        .query_row("SELECT case_id FROM images WHERE id = ?1", [id], |r| r.get(0))
        .map_err(|_| err(StatusCode::NOT_FOUND, "no existe esa imagen"))?;
    guard_case(&app, &headers, case_id)?;
    let data = leer_campo_unico(&mut mp).await?;
    let img = sobrescribir_bytes(&app.store, &app.dir, id, &data).map_err(|e| err(StatusCode::UNSUPPORTED_MEDIA_TYPE, &e))?;
    Ok(Json(img))
}

/// "Guardar como copia": una fila nueva, la original intacta con sus
/// análisis tal cual -- mismo `INSERT` que ya usa `images::upload`, solo que
/// los bytes vienen del editor y no de una ruta local recién elegida.
pub async fn copiar(
    State(app): State<App>,
    Path(id): Path<i64>,
    headers: HeaderMap,
    mut mp: Multipart,
) -> Result<Json<Image>, Fail> {
    let case_id: i64 = app
        .store
        .conn()
        .query_row("SELECT case_id FROM images WHERE id = ?1", [id], |r| r.get(0))
        .map_err(|_| err(StatusCode::NOT_FOUND, "no existe esa imagen"))?;
    let (uid, pid, _) = guard_case(&app, &headers, case_id)?;
    let filename: String = app
        .store
        .conn()
        .query_row("SELECT filename FROM images WHERE id = ?1", [id], |r| r.get(0))
        .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;
    let data = leer_campo_unico(&mut mp).await?;
    let (mime, w, h, ex, sha) = {
        let procesada = crate::routes::images::procesar_imagen(&data, &filename)
            .map_err(|msg| err(StatusCode::UNSUPPORTED_MEDIA_TYPE, &msg))?;
        (procesada.mime, procesada.w, procesada.h, procesada.ex, procesada.sha)
    };
    let dir = dir_for(&app, pid);
    let new_id = {
        let c = app.store.conn();
        c.execute(
            "INSERT INTO images (case_id, uploader_id, filename, bytes, sha256, width, height, mime,
                                  exif_json, exif_lat, exif_lng, created_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)",
            rusqlite::params![
                case_id, uid, filename, data.len() as i64, sha, w, h, mime, ex.json, ex.lat, ex.lng,
                crate::routes::access::now()
            ],
        )
        .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;
        c.last_insert_rowid()
    };
    std::fs::write(dir.join(new_id.to_string()), &data).map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;
    let img = app
        .store
        .conn()
        .query_row(&format!("SELECT {COLS} FROM images WHERE id = ?1"), [new_id], row_to_image)
        .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;
    Ok(Json(img))
}

