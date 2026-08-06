//! Subir, listar y borrar imágenes. El archivo original se escribe una vez y
//! no se vuelve a tocar: en contexto forense, reescribirlo es destruir la
//! prueba. La miniatura es un archivo aparte, al lado.

use crate::routes::access::now;
use crate::routes::auth::{bearer, require_session};
use crate::routes::cases::guard_case;
use crate::routes::projects::{err, Fail};
use crate::App;
use axum::extract::{Multipart, Path, State};
use axum::{http::HeaderMap, http::StatusCode, Json};
use lumi_proto::api::{Image, ProjectImage, ReuseReq, Usage};
use sha2::{Digest, Sha256};

/// Lado mayor de la miniatura. 320 px basta para la tira a densidad doble.
const THUMB: u32 = 320;
const MAX_BYTES: usize = 64 * 1024 * 1024;

const COLS: &str = "id, case_id, filename, bytes, width, height, mime,
                    exif_lat, exif_lng, exif_json, created_at";

fn dir_for(app: &App, project_id: i64) -> std::path::PathBuf {
    app.dir.join("projects").join(project_id.to_string())
}

fn usage(app: &App, uid: i64) -> Usage {
    Usage {
        used_bytes: crate::projects::used_bytes(&app.store, uid),
        limit_gb: crate::limits::effective(&app.store, uid).max_storage_gb,
        overridden: crate::limits::overrides(&app.store, uid).contains_key("max_storage_gb"),
    }
}

fn row_to_image(r: &rusqlite::Row) -> rusqlite::Result<Image> {
    let raw: Option<String> = r.get(9)?;
    Ok(Image {
        id: r.get(0)?,
        case_id: r.get(1)?,
        filename: r.get(2)?,
        bytes: r.get(3)?,
        width: r.get(4)?,
        height: r.get(5)?,
        mime: r.get(6)?,
        exif_lat: r.get(7)?,
        exif_lng: r.get(8)?,
        exif: raw.and_then(|s| serde_json::from_str(&s).ok()),
        created_at: r.get(10)?,
    })
}

pub async fn list(
    State(app): State<App>,
    Path(case_id): Path<i64>,
    headers: HeaderMap,
) -> Result<Json<Vec<Image>>, Fail> {
    guard_case(&app, &headers, case_id)?;
    let c = app.store.conn();
    let mut q = c
        .prepare(&format!("SELECT {COLS} FROM images WHERE case_id = ?1 ORDER BY created_at"))
        .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;
    let rows = q
        .query_map([case_id], row_to_image)
        .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?
        .flatten()
        .collect();
    Ok(Json(rows))
}

/// Las imágenes de los OTROS casos del proyecto, para el mosaico de "ya
/// subidas al proyecto" del destino de arrastre. Cualquier miembro puede
/// verlas: el aislamiento que importa es entre proyectos, no entre los casos
/// de uno mismo.
pub async fn project_gallery(
    State(app): State<App>,
    Path(pid): Path<i64>,
    headers: HeaderMap,
) -> Result<Json<Vec<ProjectImage>>, Fail> {
    let (uid, _) = require_session(&app, &bearer(&headers)).map_err(|c| (c, "sesión inválida".to_string()))?;
    crate::projects::access(&app.store, uid, pid)
        .ok_or_else(|| err(StatusCode::NOT_FOUND, "no existe ese proyecto"))?;
    let c = app.store.conn();
    let mut q = c
        .prepare(
            "SELECT i.id, i.case_id, i.filename, i.bytes, i.width, i.height, i.mime,
                    i.exif_lat, i.exif_lng, i.exif_json, i.created_at, k.name
             FROM images i JOIN cases k ON k.id = i.case_id
             WHERE k.project_id = ?1
             ORDER BY i.created_at DESC",
        )
        .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;
    let rows = q
        .query_map([pid], |r| {
            Ok(ProjectImage { image: row_to_image(r)?, case_name: r.get(11)? })
        })
        .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?
        .flatten()
        .collect();
    Ok(Json(rows))
}

/// Copia una imagen de otro caso del MISMO proyecto a este. Es una copia y no
/// un traslado: el caso de origen no pierde nada, que es justo la razón de
/// que un investigador quiera reutilizarla sin desmontar su otro caso.
pub async fn reuse(
    State(app): State<App>,
    Path(case_id): Path<i64>,
    headers: HeaderMap,
    Json(req): Json<ReuseReq>,
) -> Result<Json<Image>, Fail> {
    let (uid, pid, _) = guard_case(&app, &headers, case_id)?;
    let is_admin = require_session(&app, &bearer(&headers)).map(|(_, a)| a).unwrap_or(false);

    let (src_case, src_pid, filename, bytes, sha256, width, height, mime, exif_json, exif_lat, exif_lng): (
        i64, i64, String, i64, String, Option<i64>, Option<i64>, String, Option<String>, Option<f64>, Option<f64>,
    ) = app
        .store
        .conn()
        .query_row(
            "SELECT i.case_id, k.project_id, i.filename, i.bytes, i.sha256, i.width, i.height, i.mime,
                    i.exif_json, i.exif_lat, i.exif_lng
             FROM images i JOIN cases k ON k.id = i.case_id WHERE i.id = ?1",
            [req.image_id],
            |r| {
                Ok((
                    r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?,
                    r.get(6)?, r.get(7)?, r.get(8)?, r.get(9)?, r.get(10)?,
                ))
            },
        )
        .map_err(|_| err(StatusCode::NOT_FOUND, "no existe esa imagen"))?;
    if src_pid != pid {
        return Err(err(StatusCode::FORBIDDEN, "esa imagen es de otro proyecto"));
    }
    if src_case == case_id {
        return Err(err(StatusCode::BAD_REQUEST, "esa imagen ya está en este caso"));
    }
    if !is_admin {
        let u = usage(&app, uid);
        let cap = u.limit_gb * 1024 * 1024 * 1024;
        if u.used_bytes + bytes > cap {
            return Err(err(StatusCode::INSUFFICIENT_STORAGE, "no cabe en tu cuota"));
        }
    }

    let id = {
        let c = app.store.conn();
        c.execute(
            "INSERT INTO images (case_id, uploader_id, filename, bytes, sha256, width, height, mime,
                                  exif_json, exif_lat, exif_lng, created_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)",
            rusqlite::params![
                case_id, uid, filename, bytes, sha256, width, height, mime, exif_json, exif_lat, exif_lng, now()
            ],
        )
        .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;
        c.last_insert_rowid()
    };

    // Mismo proyecto, así que el directorio es el mismo: solo hace falta un
    // segundo archivo con el nuevo id al lado del original.
    let dir = dir_for(&app, pid);
    std::fs::copy(dir.join(req.image_id.to_string()), dir.join(id.to_string()))
        .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;
    let _ = std::fs::copy(dir.join(format!("{}.thumb", req.image_id)), dir.join(format!("{id}.thumb")));

    let img = app
        .store
        .conn()
        .query_row(&format!("SELECT {COLS} FROM images WHERE id = ?1"), [id], row_to_image)
        .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;
    let _ = app.store.conn().execute(
        "UPDATE projects SET updated_at = ?1 WHERE id = ?2",
        rusqlite::params![now(), pid],
    );
    Ok(Json(img))
}

pub async fn upload(
    State(app): State<App>,
    Path(case_id): Path<i64>,
    headers: HeaderMap,
    mut mp: Multipart,
) -> Result<Json<Vec<Image>>, Fail> {
    let (uid, pid, _) = guard_case(&app, &headers, case_id)?;
    let is_admin = require_session(&app, &bearer(&headers)).map(|(_, a)| a).unwrap_or(false);
    let dir = dir_for(&app, pid);
    std::fs::create_dir_all(&dir)
        .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;

    let mut out = Vec::new();
    while let Some(field) = mp
        .next_field()
        .await
        .map_err(|e| err(StatusCode::BAD_REQUEST, &e.to_string()))?
    {
        let filename = field.file_name().unwrap_or("sin-nombre").to_string();
        let data = field
            .bytes()
            .await
            .map_err(|e| err(StatusCode::BAD_REQUEST, &e.to_string()))?;
        if data.len() > MAX_BYTES {
            return Err(err(StatusCode::PAYLOAD_TOO_LARGE, "esa imagen pasa de 64 MB"));
        }

        // La cuota se comprueba por archivo y no por lote: así el primero de
        // diez entra aunque el décimo no quepa, en vez de perderse todos.
        if !is_admin {
            let u = usage(&app, uid);
            let cap = u.limit_gb * 1024 * 1024 * 1024;
            if u.used_bytes + data.len() as i64 > cap {
                let faltan = (u.used_bytes + data.len() as i64 - cap) as f64 / 1024.0 / 1024.0;
                let origen = if u.overridden {
                    format!("tu límite es de {} GB, anulado para tu cuenta", u.limit_gb)
                } else {
                    format!("tu límite es de {} GB, heredado del global", u.limit_gb)
                };
                return Err(err(
                    StatusCode::INSUFFICIENT_STORAGE,
                    &format!("no caben {faltan:.0} MB más: {origen}"),
                ));
            }
        }

        // Descodificar ANTES de escribir nada: si no es una imagen, el disco
        // no se toca y se dice qué se detectó de verdad.
        let fmt = image::guess_format(&data).map_err(|_| {
            err(StatusCode::UNSUPPORTED_MEDIA_TYPE, &format!("{filename} no es una imagen"))
        })?;
        let decoded = image::load_from_memory_with_format(&data, fmt)
            .map_err(|e| err(StatusCode::UNSUPPORTED_MEDIA_TYPE, &format!("{filename}: {e}")))?;
        let (w, h) = (decoded.width() as i64, decoded.height() as i64);
        let mime = fmt.to_mime_type().to_string();
        let ex = crate::exif::read(&data);
        let sha = format!("{:x}", Sha256::digest(&data));

        let id = {
            let c = app.store.conn();
            c.execute(
                "INSERT INTO images
                 (case_id, uploader_id, filename, bytes, sha256, width, height, mime,
                  exif_json, exif_lat, exif_lng, created_at)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)",
                rusqlite::params![
                    case_id, uid, filename, data.len() as i64, sha, w, h, mime,
                    ex.json, ex.lat, ex.lng, now()
                ],
            )
            .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;
            c.last_insert_rowid()
        };

        // El original, byte a byte, sin recomprimir ni quitarle el EXIF.
        std::fs::write(dir.join(id.to_string()), &data)
            .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;
        // Y la miniatura al lado, siempre JPEG: la tira no necesita más.
        let thumb = decoded.thumbnail(THUMB, THUMB);
        let mut buf = std::io::Cursor::new(Vec::new());
        if thumb.to_rgb8().write_to(&mut buf, image::ImageFormat::Jpeg).is_ok() {
            let _ = std::fs::write(dir.join(format!("{id}.thumb")), buf.into_inner());
        }

        let img = app
            .store
            .conn()
            .query_row(&format!("SELECT {COLS} FROM images WHERE id = ?1"), [id], row_to_image)
            .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;
        out.push(img);
    }

    let _ = app.store.conn().execute(
        "UPDATE projects SET updated_at = ?1 WHERE id = ?2",
        rusqlite::params![now(), pid],
    );
    Ok(Json(out))
}

pub async fn remove(
    State(app): State<App>,
    Path(id): Path<i64>,
    headers: HeaderMap,
) -> Result<StatusCode, Fail> {
    let case_id: i64 = app
        .store
        .conn()
        .query_row("SELECT case_id FROM images WHERE id = ?1", [id], |r| r.get(0))
        .map_err(|_| err(StatusCode::NOT_FOUND, "no existe esa imagen"))?;
    let (_, pid, _) = guard_case(&app, &headers, case_id)?;
    // Si se fuera, el resultado aterrizaría sobre un caso al que le falta la
    // prueba que lo produjo. En una herramienta forense eso no es aceptable.
    let en_uso: i64 = app
        .store
        .conn()
        .query_row(
            "SELECT COUNT(*) FROM analysis_images ai JOIN analyses a ON a.id = ai.analysis_id
             WHERE ai.image_id = ?1 AND a.state = 'en_curso'",
            [id],
            |r| r.get(0),
        )
        .unwrap_or(0);
    if en_uso > 0 {
        return Err(err(
            StatusCode::CONFLICT,
            "esta imagen se está analizando ahora mismo; espera a que termine",
        ));
    }
    {
        let c = app.store.conn();
        let _ = c.execute("DELETE FROM analysis_images WHERE image_id = ?1", [id]);
        c.execute("DELETE FROM images WHERE id = ?1", [id])
            .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;
    }
    let dir = dir_for(&app, pid);
    let _ = std::fs::remove_file(dir.join(id.to_string()));
    let _ = std::fs::remove_file(dir.join(format!("{id}.thumb")));
    Ok(StatusCode::NO_CONTENT)
}

/// Cuánto llevas ocupado y cuánto te dejan. Lo pinta la pantalla de arranque.
pub async fn my_usage(State(app): State<App>, headers: HeaderMap) -> Result<Json<Usage>, Fail> {
    let (uid, _) =
        require_session(&app, &bearer(&headers)).map_err(|c| (c, "sesión inválida".to_string()))?;
    Ok(Json(usage(&app, uid)))
}

/// Devuelve bytes crudos, no JSON. Es la única familia de rutas del daemon que
/// lo hace, y por eso el cliente necesita un canal aparte del puente de texto
/// (ver la tarea del esquema `lumi://`).
async fn serve(
    app: &App,
    headers: &HeaderMap,
    id: i64,
    thumb: bool,
) -> Result<([(axum::http::HeaderName, String); 2], Vec<u8>), Fail> {
    let (case_id, mime): (i64, String) = app
        .store
        .conn()
        .query_row("SELECT case_id, mime FROM images WHERE id = ?1", [id], |r| {
            Ok((r.get(0)?, r.get(1)?))
        })
        .map_err(|_| err(StatusCode::NOT_FOUND, "no existe esa imagen"))?;
    let (_, pid, _) = guard_case(app, headers, case_id)?;

    let dir = dir_for(app, pid);
    let (path, ctype) = if thumb {
        (dir.join(format!("{id}.thumb")), "image/jpeg".to_string())
    } else {
        (dir.join(id.to_string()), mime)
    };
    let bytes = std::fs::read(&path).map_err(|_| {
        // Fila sin archivo: es una inconsistencia real, no un 404 del usuario.
        err(StatusCode::INTERNAL_SERVER_ERROR, "el archivo de esa imagen falta en el disco")
    })?;
    // Inmutable de verdad: una imagen nunca se reescribe, solo se borra.
    Ok((
        [
            (axum::http::header::CONTENT_TYPE, ctype),
            (axum::http::header::CACHE_CONTROL, "private, max-age=31536000, immutable".into()),
        ],
        bytes,
    ))
}

pub async fn serve_full(
    State(app): State<App>,
    Path(id): Path<i64>,
    headers: HeaderMap,
) -> Result<([(axum::http::HeaderName, String); 2], Vec<u8>), Fail> {
    serve(&app, &headers, id, false).await
}

pub async fn serve_thumb(
    State(app): State<App>,
    Path(id): Path<i64>,
    headers: HeaderMap,
) -> Result<([(axum::http::HeaderName, String); 2], Vec<u8>), Fail> {
    serve(&app, &headers, id, true).await
}

#[cfg(test)]
mod tests {
    use crate::limits;
    use crate::projects::used_bytes;
    use crate::store::Store;

    /// Las dos formas silenciosas de romper esto en una refactorización
    /// distraída: contar por proyecto en vez de por quien sube, y leer la
    /// tabla `limits` en vez de preguntar a `effective`.
    #[test]
    fn la_cuota_es_de_quien_sube_y_el_tope_sale_de_effective() {
        let dir = std::env::temp_dir().join(format!("lumi-cuota-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let s = Store::open(&dir).unwrap();
        s.conn()
            .execute(
                "INSERT INTO images (case_id, uploader_id, filename, bytes, sha256, mime, created_at)
                 VALUES (1, 20, 'a', 100, 'x', 'image/jpeg', 0),
                        (1, 20, 'b', 250, 'y', 'image/jpeg', 0),
                        (1, 10, 'c', 999, 'z', 'image/jpeg', 0)",
                [],
            )
            .unwrap();

        // Mismo caso y mismo proyecto: cada uno carga con lo suyo igualmente.
        assert_eq!(used_bytes(&s, 20), 350);
        assert_eq!(used_bytes(&s, 10), 999);
        assert_eq!(used_bytes(&s, 30), 0);

        // El tope se hereda del global hasta que hay anulación propia, y la
        // interfaz tiene que poder distinguir un caso del otro.
        limits::set(&s, None, "max_storage_gb", &serde_json::json!(20)).unwrap();
        assert_eq!(limits::effective(&s, 20).max_storage_gb, 20);
        assert!(!limits::overrides(&s, 20).contains_key("max_storage_gb"));

        limits::set(&s, Some(20), "max_storage_gb", &serde_json::json!(5)).unwrap();
        assert_eq!(limits::effective(&s, 20).max_storage_gb, 5);
        assert!(limits::overrides(&s, 20).contains_key("max_storage_gb"));
        assert_eq!(limits::effective(&s, 10).max_storage_gb, 20);

        drop(s);
        std::fs::remove_dir_all(&dir).ok();
    }
}
