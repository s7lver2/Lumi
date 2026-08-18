//! Solicitudes de más cupo (diario o semanal). Mismo patrón que
//! `access_requests`: una tabla, un estado, "la primera resolución gana".
//! Vive en su propio fichero porque el estado que gestiona (una tabla y su
//! ciclo de vida) es distinto del de `admin.rs`, que es superficie de
//! administración variada.

use crate::routes::access::now;
use crate::routes::auth::{bearer, require_admin, require_session};
use crate::routes::projects::{err, Fail};
use crate::App;
use axum::extract::{Path, State};
use axum::{http::HeaderMap, http::StatusCode, Json};
use lumi_proto::api::{CreateCreditReq, CreditRequestInfo, EventoAdmin, ResolveCreditReq};

const SELECT: &str = "SELECT cr.id, cr.user_id, u.username, cr.tipo, cr.valor_actual,
    cr.valor_propuesto, cr.mensaje, cr.status, cr.reason, cr.created_at
    FROM credit_requests cr JOIN users u ON u.id = cr.user_id";

fn map_row(r: &rusqlite::Row) -> rusqlite::Result<CreditRequestInfo> {
    Ok(CreditRequestInfo {
        id: r.get(0)?,
        user_id: r.get(1)?,
        username: r.get(2)?,
        tipo: r.get(3)?,
        valor_actual: r.get(4)?,
        valor_propuesto: r.get(5)?,
        mensaje: r.get(6)?,
        status: r.get(7)?,
        reason: r.get(8)?,
        created_at: r.get(9)?,
    })
}

pub async fn create(
    State(app): State<App>,
    headers: HeaderMap,
    Json(req): Json<CreateCreditReq>,
) -> Result<Json<CreditRequestInfo>, Fail> {
    let (uid, _) =
        require_session(&app, &bearer(&headers)).map_err(|c| (c, "sesión inválida".to_string()))?;
    if req.tipo != "diario" && req.tipo != "semanal" {
        return Err(err(StatusCode::BAD_REQUEST, "tipo desconocido"));
    }
    let c = app.store.conn();
    // Solo una pendiente a la vez por tipo, mismo criterio que
    // "la primera resolución gana" de access_requests.
    let ya: i64 = c
        .query_row(
            "SELECT COUNT(*) FROM credit_requests WHERE user_id = ?1 AND tipo = ?2 AND status = 'pending'",
            rusqlite::params![uid, req.tipo],
            |r| r.get(0),
        )
        .unwrap_or(0);
    if ya > 0 {
        return Err(err(StatusCode::CONFLICT, "ya tienes una solicitud pendiente de este tipo"));
    }
    let l = crate::limits::effective(&app.store, uid);
    let valor_actual = if req.tipo == "diario" { l.max_daily } else { l.max_weekly };
    let t = now();
    c.execute(
        "INSERT INTO credit_requests
            (user_id, tipo, valor_actual, valor_propuesto, mensaje, status, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, 'pending', ?6)",
        rusqlite::params![uid, req.tipo, valor_actual, req.valor_propuesto, req.mensaje, t],
    )
    .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;
    let id = c.last_insert_rowid();
    let info = c
        .query_row(&format!("{SELECT} WHERE cr.id = ?1"), [id], map_row)
        .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;

    let username: String = c
        .query_row("SELECT username FROM users WHERE id = ?1", [uid], |r| r.get(0))
        .unwrap_or_default();
    let _ = app.admin_eventos.send(EventoAdmin::SolicitudCredito {
        user_id: uid,
        username,
        tipo: info.tipo.clone(),
        valor_actual: info.valor_actual,
        valor_propuesto: info.valor_propuesto,
    });

    Ok(Json(info))
}

pub async fn list_all(
    State(app): State<App>,
    headers: HeaderMap,
) -> Result<Json<Vec<CreditRequestInfo>>, StatusCode> {
    require_admin(&app, &bearer(&headers))?;
    let c = app.store.conn();
    let mut q = c
        .prepare(&format!("{SELECT} ORDER BY cr.created_at DESC"))
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let rows = q.query_map([], map_row).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(rows.flatten().collect()))
}

pub async fn resolve(
    State(app): State<App>,
    Path(id): Path<i64>,
    headers: HeaderMap,
    Json(req): Json<ResolveCreditReq>,
) -> Result<StatusCode, Fail> {
    let admin = require_admin(&app, &bearer(&headers))
        .map_err(|c| (c, "hace falta ser administrador".to_string()))?;
    let c = app.store.conn();
    let (status, user_id, tipo, propuesto): (String, i64, String, i64) = c
        .query_row(
            "SELECT status, user_id, tipo, valor_propuesto FROM credit_requests WHERE id = ?1",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .map_err(|_| err(StatusCode::NOT_FOUND, "no existe esa solicitud"))?;
    if status != "pending" {
        return Err(err(StatusCode::CONFLICT, &format!("esa solicitud ya está {status}")));
    }
    let t = now();
    if req.approve {
        let valor = req.valor_final.unwrap_or(propuesto);
        let key = if tipo == "diario" { "max_daily" } else { "max_weekly" };
        crate::limits::set(&app.store, Some(user_id), key, &serde_json::json!(valor))
            .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;
        c.execute(
            "UPDATE credit_requests SET status = 'approved', resolved_at = ?1, resolved_by = ?2 WHERE id = ?3",
            rusqlite::params![t, admin, id],
        )
    } else {
        c.execute(
            "UPDATE credit_requests SET status = 'rejected', reason = ?1, resolved_at = ?2, resolved_by = ?3 WHERE id = ?4",
            rusqlite::params![req.reason, t, admin, id],
        )
    }
    .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;
    Ok(StatusCode::NO_CONTENT)
}
