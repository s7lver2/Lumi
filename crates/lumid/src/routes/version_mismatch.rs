//! Aviso de que un cliente detectó una versión distinta a la del servidor.
//! Mismo patrón que `access_requests`/`credit_requests`: una tabla, un
//! estado. A diferencia de esas dos, no hay nada que aprobar/conceder — el
//! admin solo se entera (`EventoAdmin::SolicitudVersion`, panel de
//! Solicitudes) y actualiza `lumid` por su cuenta desde
//! `ActualizacionesView.tsx`. `create` es sin autenticación, igual que
//! `access_requests::create` (segunda superficie escribible sin
//! credenciales del proyecto): mismo régimen anti-abuso, mismos límites.

use crate::routes::access::now;
use crate::routes::auth::{bearer, require_admin};
use crate::routes::projects::{err, Fail};
use crate::App;
use axum::extract::{ConnectInfo, Path, State};
use axum::{http::HeaderMap, http::StatusCode, Json};
use lumi_proto::api::{EventoAdmin, VersionMismatchInfo, VersionMismatchReq};
use std::net::SocketAddr;

const MAX_VERSION_LEN: usize = 32;
const PER_HOUR: i64 = 3;
const PER_DAY: i64 = 10;
const MAX_PENDING: i64 = 100;

pub async fn create(
    State(app): State<App>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    Json(req): Json<VersionMismatchReq>,
) -> Result<StatusCode, Fail> {
    let version_cliente = req.version_cliente.trim();
    if version_cliente.is_empty() || version_cliente.chars().count() > MAX_VERSION_LEN {
        return Err(err(StatusCode::BAD_REQUEST, "version invalida"));
    }

    let ip = peer.ip().to_string();
    let t = now();
    let c = app.store.conn();
    let count = |since: i64| -> i64 {
        c.query_row(
            "SELECT COUNT(*) FROM version_mismatch_requests WHERE source_ip = ?1 AND created_at > ?2",
            rusqlite::params![ip, since],
            |r| r.get(0),
        )
        .unwrap_or(0)
    };
    if count(t - 3600) >= PER_HOUR {
        return Err(err(StatusCode::TOO_MANY_REQUESTS, "demasiadas solicitudes; espera una hora"));
    }
    if count(t - 86400) >= PER_DAY {
        return Err(err(StatusCode::TOO_MANY_REQUESTS, "demasiadas solicitudes; espera 24 horas"));
    }
    let pending: i64 = c
        .query_row(
            "SELECT COUNT(*) FROM version_mismatch_requests WHERE resolved_at IS NULL",
            [],
            |r| r.get(0),
        )
        .unwrap_or(0);
    if pending >= MAX_PENDING {
        return Err(err(
            StatusCode::SERVICE_UNAVAILABLE,
            "hay demasiadas solicitudes sin resolver; inténtalo más tarde",
        ));
    }

    c.execute(
        "INSERT INTO version_mismatch_requests (version_cliente, source_ip, created_at) VALUES (?1, ?2, ?3)",
        rusqlite::params![version_cliente, ip, t],
    )
    .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;
    let id = c.last_insert_rowid();
    tracing::info!("aviso de version distinta #{id} desde {ip}: cliente en {version_cliente}");
    let _ = app.admin_eventos.send(EventoAdmin::SolicitudVersion {
        version_cliente: version_cliente.to_string(),
    });
    Ok(StatusCode::CREATED)
}

fn map_row(r: &rusqlite::Row) -> rusqlite::Result<VersionMismatchInfo> {
    Ok(VersionMismatchInfo {
        id: r.get(0)?,
        version_cliente: r.get(1)?,
        source_ip: r.get(2)?,
        created_at: r.get(3)?,
        resolved_at: r.get(4)?,
    })
}

pub async fn list_all(
    State(app): State<App>,
    headers: HeaderMap,
) -> Result<Json<Vec<VersionMismatchInfo>>, StatusCode> {
    require_admin(&app, &bearer(&headers))?;
    let c = app.store.conn();
    let mut q = c
        .prepare(
            "SELECT id, version_cliente, source_ip, created_at, resolved_at
             FROM version_mismatch_requests ORDER BY (resolved_at IS NULL) DESC, created_at DESC",
        )
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let rows = q.query_map([], map_row).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(rows.flatten().collect()))
}

pub async fn resolve(
    State(app): State<App>,
    Path(id): Path<i64>,
    headers: HeaderMap,
) -> Result<StatusCode, Fail> {
    let admin = require_admin(&app, &bearer(&headers))
        .map_err(|c| (c, "hace falta ser administrador".to_string()))?;
    let c = app.store.conn();
    let t = now();
    let n = c
        .execute(
            "UPDATE version_mismatch_requests SET resolved_at = ?1, resolved_by = ?2 WHERE id = ?3 AND resolved_at IS NULL",
            rusqlite::params![t, admin, id],
        )
        .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;
    if n == 0 {
        return Err(err(StatusCode::NOT_FOUND, "no existe esa solicitud, o ya estaba descartada"));
    }
    Ok(StatusCode::NO_CONTENT)
}
