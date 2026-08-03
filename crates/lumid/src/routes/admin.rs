//! Superficie de administración. PROVISIONAL en su forma de interfaz, pero no
//! en sus rutas: el subsistema 3 rediseña las pantallas y se queda esta API.

use crate::routes::access::{now, APPROVED_TTL_S};
use crate::routes::auth::{bearer, require_admin};
use crate::App;
use axum::extract::{Path, State};
use axum::{http::HeaderMap, http::StatusCode, Json};
use lumi_proto::api::{AdminRequest, ResolveReq};

/// ¿La dirección está fuera del rango privado? Un aviso, no un bloqueo: puede
/// ser perfectamente legítimo (VPN mal configurada, oficina remota), pero el
/// admin merece verlo antes de aprobar.
fn is_external(ip: &str) -> bool {
    match ip.parse::<std::net::IpAddr>() {
        Ok(std::net::IpAddr::V4(v4)) => !(v4.is_private() || v4.is_loopback() || v4.is_link_local()),
        Ok(std::net::IpAddr::V6(v6)) => !(v6.is_loopback() || v6.segments()[0] & 0xfe00 == 0xfc00),
        Err(_) => true,
    }
}

pub async fn list_requests(
    State(app): State<App>,
    headers: HeaderMap,
) -> Result<Json<Vec<AdminRequest>>, StatusCode> {
    require_admin(&app, &bearer(&headers))?;
    let c = app.store.conn();
    // Autorrevisión: nadie más aplica la caducidad a los 7 días. El único
    // momento en que importa que una solicitud pendiente esté caducada es
    // cuando alguien la mira, así que se limpia aquí y no en una tarea
    // periódica.
    let _ = c.execute(
        "UPDATE access_requests SET status = 'expired'
         WHERE status = 'pending' AND expires_at < ?1",
        [now()],
    );
    let mut q = c
        .prepare(
            "SELECT id, display_name, message, source_ip, status, reason, created_at, expires_at
             FROM access_requests ORDER BY (status = 'pending') DESC, created_at DESC",
        )
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let rows = q
        .query_map([], |r| {
            let source_ip: String = r.get(3)?;
            Ok(AdminRequest {
                id: r.get(0)?,
                display_name: r.get(1)?,
                message: r.get(2)?,
                external: is_external(&source_ip),
                source_ip,
                status: r.get(4)?,
                reason: r.get(5)?,
                created_at: r.get(6)?,
                expires_at: r.get(7)?,
            })
        })
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .flatten()
        .collect();
    Ok(Json(rows))
}

pub async fn resolve_request(
    State(app): State<App>,
    Path(id): Path<i64>,
    headers: HeaderMap,
    Json(req): Json<ResolveReq>,
) -> Result<StatusCode, (StatusCode, String)> {
    let admin = require_admin(&app, &bearer(&headers))
        .map_err(|c| (c, "hace falta ser administrador".to_string()))?;
    let c = app.store.conn();
    let status: String = c
        .query_row("SELECT status FROM access_requests WHERE id = ?1", [id], |r| r.get(0))
        .map_err(|_| (StatusCode::NOT_FOUND, "no existe esa solicitud".to_string()))?;
    // La primera resolución gana. Dos administradores mirando la misma lista
    // no pueden aprobar y rechazar lo mismo.
    if status != "pending" {
        return Err((StatusCode::CONFLICT, format!("esa solicitud ya está {status}")));
    }
    let t = now();
    if req.approve {
        let models = req
            .granted_models
            .filter(|m| !m.is_empty())
            .and_then(|m| serde_json::to_string(&m).ok());
        c.execute(
            "UPDATE access_requests
             SET status = 'approved', granted_models = ?1, expires_at = ?2,
                 resolved_at = ?3, resolved_by = ?4
             WHERE id = ?5",
            rusqlite::params![models, t + APPROVED_TTL_S, t, admin, id],
        )
    } else {
        c.execute(
            "UPDATE access_requests
             SET status = 'rejected', reason = ?1, resolved_at = ?2, resolved_by = ?3
             WHERE id = ?4",
            rusqlite::params![req.reason, t, admin, id],
        )
    }
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    tracing::info!("solicitud #{id} {} por el usuario {admin}", if req.approve { "aprobada" } else { "rechazada" });
    Ok(StatusCode::NO_CONTENT)
}
