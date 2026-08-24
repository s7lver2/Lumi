//! Avisos del administrador: broadcast, solo-admins, o dirigidos a personas
//! concretas. El contenido es el documento JSON de Tiptap — se guarda y se
//! devuelve tal cual, como valor JSON anidado, nunca como una cadena HTML
//! que alguna pantalla tuviera que interpretar.

use crate::routes::access::now;
use crate::routes::auth::{bearer, require_admin};
use crate::App;
use axum::extract::{Path, State};
use axum::{http::HeaderMap, http::StatusCode, Json};
use lumi_proto::api::{AvisoInfo, CrearAvisoReq};

const SELECT_AVISO: &str =
    "SELECT id, contenido, icono, prioridad, destino, creado_por, created_at FROM avisos";

fn map_row(r: &rusqlite::Row) -> rusqlite::Result<AvisoInfo> {
    let contenido_texto: String = r.get(1)?;
    Ok(AvisoInfo {
        id: r.get(0)?,
        contenido: serde_json::from_str(&contenido_texto).unwrap_or(serde_json::Value::Null),
        icono: r.get(2)?,
        prioridad: r.get(3)?,
        destino: r.get(4)?,
        creado_por: r.get(5)?,
        created_at: r.get(6)?,
    })
}

/// Sin filtrar por destino: solo la pantalla de gestión llama a esto, y
/// necesita ver y poder borrar cualquier aviso, esté dirigido a quien esté
/// — a diferencia de la campana, que recibe la lista ya filtrada por
/// `telemetry::sample` (Task 4).
pub async fn list_all(State(app): State<App>, headers: HeaderMap) -> Result<Json<Vec<AvisoInfo>>, StatusCode> {
    require_admin(&app, &bearer(&headers))?;
    let c = app.store.conn();
    let mut q = c
        .prepare(&format!("{SELECT_AVISO} ORDER BY created_at DESC"))
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let filas = q.query_map([], map_row).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(filas.flatten().collect()))
}

pub async fn create(
    State(app): State<App>,
    headers: HeaderMap,
    Json(req): Json<CrearAvisoReq>,
) -> Result<Json<AvisoInfo>, (StatusCode, String)> {
    let uid = require_admin(&app, &bearer(&headers)).map_err(|c| (c, "hace falta ser administrador".to_string()))?;
    if !["todos", "admins", "personas"].contains(&req.destino.as_str()) {
        return Err((StatusCode::BAD_REQUEST, "destino desconocido".to_string()));
    }
    if req.destino == "personas" && req.usuarios.is_empty() {
        return Err((StatusCode::BAD_REQUEST, "faltan los destinatarios".to_string()));
    }

    let c = app.store.conn();
    let creado_por: String = c
        .query_row("SELECT username FROM users WHERE id = ?1", [uid], |r| r.get(0))
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let t = now();
    let contenido_texto = serde_json::to_string(&req.contenido).unwrap_or_default();
    c.execute(
        "INSERT INTO avisos (contenido, icono, prioridad, destino, creado_por, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        rusqlite::params![contenido_texto, req.icono, req.prioridad, req.destino, creado_por, t],
    )
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let id = c.last_insert_rowid();

    if req.destino == "personas" {
        for username in &req.usuarios {
            let uid: Option<i64> = c
                .query_row("SELECT id FROM users WHERE username = ?1", [username], |r| r.get(0))
                .ok();
            if let Some(uid) = uid {
                c.execute(
                    "INSERT OR IGNORE INTO avisos_usuarios (aviso_id, user_id) VALUES (?1, ?2)",
                    rusqlite::params![id, uid],
                )
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
            }
        }
    }

    tracing::info!("aviso #{id} publicado por {creado_por} (destino: {})", req.destino);
    c.query_row(&format!("{SELECT_AVISO} WHERE id = ?1"), [id], map_row)
        .map(Json)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))
}

/// Cualquier administrador puede borrar cualquier aviso, no solo quien lo
/// escribió — mismo criterio que el resto del panel, que no distingue entre
/// administradores.
pub async fn remove(State(app): State<App>, Path(id): Path<i64>, headers: HeaderMap) -> Result<StatusCode, StatusCode> {
    let admin = require_admin(&app, &bearer(&headers))?;
    let c = app.store.conn();
    let n = c
        .execute("DELETE FROM avisos WHERE id = ?1", [id])
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    c.execute("DELETE FROM avisos_usuarios WHERE aviso_id = ?1", [id]).ok();
    if n == 0 {
        return Err(StatusCode::NOT_FOUND);
    }
    tracing::info!("aviso #{id} borrado por el administrador {admin}");
    Ok(StatusCode::NO_CONTENT)
}
