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

use lumi_proto::api::{AdminUser, DeviceRow, PatchLimitsReq, PatchUserReq, SessionInfo, UserDetail};

fn user_row(app: &App, id: i64) -> Option<AdminUser> {
    let base: (i64, String, Option<String>, i64, i64, i64, i64) = app
        .store
        .conn()
        .query_row(
            "SELECT id, username, display_name, is_admin, blocked, must_change_password, created_at
             FROM users WHERE id = ?1",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?)),
        )
        .ok()?;
    Some(AdminUser {
        id: base.0,
        username: base.1,
        display_name: base.2,
        is_admin: base.3 == 1,
        blocked: base.4 == 1,
        must_change_password: base.5 == 1,
        created_at: base.6,
        limits: crate::limits::effective(&app.store, id),
    })
}

pub async fn list_users(
    State(app): State<App>,
    headers: HeaderMap,
) -> Result<Json<Vec<AdminUser>>, StatusCode> {
    require_admin(&app, &bearer(&headers))?;
    let ids: Vec<i64> = {
        let c = app.store.conn();
        let mut q = c
            .prepare("SELECT id FROM users ORDER BY created_at")
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        let v = q.query_map([], |r| r.get(0)).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        v.flatten().collect()
    };
    // Los ids se recogen antes de soltar el mutex: `user_row` vuelve a pedirlo.
    Ok(Json(ids.into_iter().filter_map(|i| user_row(&app, i)).collect()))
}

pub async fn get_user(
    State(app): State<App>,
    Path(id): Path<i64>,
    headers: HeaderMap,
) -> Result<Json<UserDetail>, StatusCode> {
    require_admin(&app, &bearer(&headers))?;
    let user = user_row(&app, id).ok_or(StatusCode::NOT_FOUND)?;
    let global = crate::limits::global(&app.store);
    let overrides = crate::limits::overrides(&app.store, id);
    let c = app.store.conn();
    let mut dq = c
        .prepare("SELECT name, os, first_seen, last_seen FROM devices WHERE user_id = ?1 ORDER BY last_seen DESC")
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let devices: Vec<DeviceRow> = dq
        .query_map([id], |r| {
            Ok(DeviceRow { name: r.get(0)?, os: r.get(1)?, first_seen: r.get(2)?, last_seen: r.get(3)? })
        })
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .flatten()
        .collect();
    let mut sq = c
        .prepare(
            "SELECT s.public_id, d.name, d.os, s.created_at, s.last_seen
             FROM sessions s LEFT JOIN devices d ON d.id = s.device_id
             WHERE s.user_id = ?1 AND s.public_id IS NOT NULL AND s.expires_at > ?2
             ORDER BY s.created_at DESC",
        )
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let sessions: Vec<SessionInfo> = sq
        .query_map(rusqlite::params![id, now()], |r| {
            Ok(SessionInfo {
                public_id: r.get(0)?,
                device_name: r.get(1)?,
                os: r.get(2)?,
                created_at: r.get(3)?,
                last_seen: r.get(4)?,
                // "La sesión actual" es del que mira, y quien mira es el admin,
                // no este usuario: aquí nunca hay sesión propia que marcar.
                current: false,
            })
        })
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .flatten()
        .collect();
    Ok(Json(UserDetail { user, global, overrides, devices, sessions }))
}

pub async fn patch_user(
    State(app): State<App>,
    Path(id): Path<i64>,
    headers: HeaderMap,
    Json(req): Json<PatchUserReq>,
) -> Result<Json<UserDetail>, (StatusCode, String)> {
    let admin = require_admin(&app, &bearer(&headers))
        .map_err(|c| (c, "hace falta ser administrador".to_string()))?;
    let bad = |m: &str| (StatusCode::BAD_REQUEST, m.to_string());
    if id == admin && req.blocked == Some(true) {
        return Err(bad("no puedes bloquearte a ti mismo"));
    }
    {
        let c = app.store.conn();
        if let Some(b) = req.blocked {
            c.execute("UPDATE users SET blocked = ?1 WHERE id = ?2", rusqlite::params![b as i64, id])
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
            // Bloquear corta el acceso YA: dejar viva una sesión de 12 h
            // convertiría el bloqueo en una sugerencia. Los trabajos ya
            // encolados siguen: qué hacer con ellos es del subsistema 4.
            if b {
                let _ = c.execute("DELETE FROM sessions WHERE user_id = ?1", [id]);
            }
        }
        if let Some(m) = req.must_change_password {
            c.execute(
                "UPDATE users SET must_change_password = ?1 WHERE id = ?2",
                rusqlite::params![m as i64, id],
            )
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        }
    }
    for (k, v) in &req.limits {
        let r = if v.is_null() {
            crate::limits::clear(&app.store, Some(id), k)
        } else {
            crate::limits::set(&app.store, Some(id), k, v)
        };
        r.map_err(|e| bad(&e.to_string()))?;
    }
    // Se devuelve el detalle recalculado para que la interfaz no tenga que
    // adivinar el resultado ni volver a pedirlo.
    get_user(State(app), Path(id), headers)
        .await
        .map(|d| d)
        .map_err(|c| (c, "no se pudo releer el usuario".to_string()))
}

pub async fn get_limits(
    State(app): State<App>,
    headers: HeaderMap,
) -> Result<Json<lumi_proto::api::Limits>, StatusCode> {
    require_admin(&app, &bearer(&headers))?;
    Ok(Json(crate::limits::global(&app.store)))
}

pub async fn patch_limits(
    State(app): State<App>,
    headers: HeaderMap,
    Json(req): Json<PatchLimitsReq>,
) -> Result<Json<lumi_proto::api::Limits>, (StatusCode, String)> {
    require_admin(&app, &bearer(&headers))
        .map_err(|c| (c, "hace falta ser administrador".to_string()))?;
    for (k, v) in &req.limits {
        let r = if v.is_null() {
            crate::limits::clear(&app.store, None, k)
        } else {
            crate::limits::set(&app.store, None, k, v)
        };
        r.map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?;
    }
    Ok(Json(crate::limits::global(&app.store)))
}
