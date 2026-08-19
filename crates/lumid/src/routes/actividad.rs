//! Feed de "actividad reciente" del Resumen: fusiona cuatro fuentes que ya
//! existen (cuentas, análisis resueltos, avisos, solicitudes resueltas) por
//! fecha — sin tabla ni escritura nueva, solo lectura.

use crate::routes::auth::{bearer, require_admin};
use crate::App;
use axum::extract::State;
use axum::{http::HeaderMap, http::StatusCode, Json};
use lumi_proto::api::ActividadItem;

const LIMITE: i64 = 15;

/// Texto plano de un documento Tiptap JSON, truncado — solo para la vista
/// previa de un aviso en el feed, nunca se reconstruye el documento entero.
fn extracto(v: &serde_json::Value) -> String {
    fn recorrer(v: &serde_json::Value, out: &mut String) {
        if let Some(t) = v.get("text").and_then(|t| t.as_str()) {
            out.push_str(t);
        }
        if let Some(hijos) = v.get("content").and_then(|c| c.as_array()) {
            for h in hijos {
                out.push(' ');
                recorrer(h, out);
            }
        }
    }
    let mut s = String::new();
    recorrer(v, &mut s);
    let s = s.split_whitespace().collect::<Vec<_>>().join(" ");
    if s.chars().count() > 50 {
        format!("{}…", s.chars().take(50).collect::<String>())
    } else {
        s
    }
}

pub async fn get(State(app): State<App>, headers: HeaderMap) -> Result<Json<Vec<ActividadItem>>, StatusCode> {
    require_admin(&app, &bearer(&headers))?;
    let c = app.store.conn();
    let mut items: Vec<ActividadItem> = Vec::new();

    if let Ok(mut q) = c.prepare("SELECT username, created_at FROM users ORDER BY created_at DESC LIMIT ?1") {
        if let Ok(filas) = q.query_map([LIMITE], |r| {
            Ok(ActividadItem::CuentaCreada { username: r.get(0)?, at: r.get(1)? })
        }) {
            items.extend(filas.flatten());
        }
    }

    if let Ok(mut q) = c.prepare(
        "SELECT id, state, finished_at FROM analyses
         WHERE state IN ('hecho','error') AND finished_at IS NOT NULL
         ORDER BY finished_at DESC LIMIT ?1",
    ) {
        if let Ok(filas) = q.query_map([LIMITE], |r| {
            Ok(ActividadItem::AnalisisResuelto { id: r.get(0)?, estado: r.get(1)?, at: r.get(2)? })
        }) {
            items.extend(filas.flatten());
        }
    }

    if let Ok(mut q) = c.prepare("SELECT contenido, created_at FROM avisos ORDER BY created_at DESC LIMIT ?1") {
        if let Ok(filas) = q.query_map([LIMITE], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?))) {
            for (raw, at) in filas.flatten() {
                if let Ok(v) = serde_json::from_str::<serde_json::Value>(&raw) {
                    items.push(ActividadItem::AvisoPublicado { extracto: extracto(&v), at });
                }
            }
        }
    }

    if let Ok(mut q) = c.prepare(
        "SELECT display_name, status, resolved_at FROM access_requests
         WHERE status IN ('approved','rejected') AND resolved_at IS NOT NULL
         ORDER BY resolved_at DESC LIMIT ?1",
    ) {
        if let Ok(filas) = q.query_map([LIMITE], |r| {
            let status: String = r.get(1)?;
            Ok(ActividadItem::SolicitudResuelta {
                display_name: r.get(0)?,
                aprobada: status == "approved",
                at: r.get(2)?,
            })
        }) {
            items.extend(filas.flatten());
        }
    }

    items.sort_by(|a, b| b.at().cmp(&a.at()));
    items.truncate(LIMITE as usize);
    Ok(Json(items))
}
