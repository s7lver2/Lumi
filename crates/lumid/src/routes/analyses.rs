//! Análisis. Este subsistema los CREA y no los resuelve: nacen en `pendiente`
//! y ahí se quedan hasta que existan la cola (subsistema 4) y el motor (5).
//!
//! Esa fila con su `state` y su `model` es literalmente el enchufe del
//! subsistema 4: cuando la cola arranque, encontrará trabajo real esperando.

use crate::routes::access::now;
use crate::routes::auth::{bearer, require_session};
use crate::routes::cases::guard_case;
use crate::routes::projects::{err, Fail};
use crate::App;
use axum::extract::{Path, State};
use axum::{http::HeaderMap, http::StatusCode, Json};
use lumi_proto::api::{Analysis, AnalysisReq};

const COLS: &str = "id, case_id, model, state, error, result_lat, result_lng,
                    result_radius_m, result_confidence, created_at, finished_at";

fn image_ids(c: &rusqlite::Connection, analysis_id: i64) -> Vec<i64> {
    let Ok(mut q) = c.prepare("SELECT image_id FROM analysis_images WHERE analysis_id = ?1") else {
        return vec![];
    };
    q.query_map([analysis_id], |r| r.get(0))
        .map(|it| it.flatten().collect())
        .unwrap_or_default()
}

fn row_to_analysis(r: &rusqlite::Row) -> rusqlite::Result<Analysis> {
    Ok(Analysis {
        id: r.get(0)?,
        case_id: r.get(1)?,
        model: r.get(2)?,
        state: r.get(3)?,
        error: r.get(4)?,
        result_lat: r.get(5)?,
        result_lng: r.get(6)?,
        result_radius_m: r.get(7)?,
        result_confidence: r.get(8)?,
        image_ids: vec![],
        created_at: r.get(9)?,
        finished_at: r.get(10)?,
    })
}

pub async fn list(
    State(app): State<App>,
    Path(case_id): Path<i64>,
    headers: HeaderMap,
) -> Result<Json<Vec<Analysis>>, Fail> {
    guard_case(&app, &headers, case_id)?;
    let c = app.store.conn();
    let mut q = c
        .prepare(&format!(
            "SELECT {COLS} FROM analyses WHERE case_id = ?1 ORDER BY created_at DESC"
        ))
        .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;
    let mut rows: Vec<Analysis> = q
        .query_map([case_id], row_to_analysis)
        .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?
        .flatten()
        .collect();
    for a in &mut rows {
        a.image_ids = image_ids(&c, a.id);
    }
    Ok(Json(rows))
}

pub async fn get_one(
    State(app): State<App>,
    Path(id): Path<i64>,
    headers: HeaderMap,
) -> Result<Json<Analysis>, Fail> {
    let missing = || err(StatusCode::NOT_FOUND, "no existe ese análisis");
    let case_id: i64 = app
        .store
        .conn()
        .query_row("SELECT case_id FROM analyses WHERE id = ?1", [id], |r| r.get(0))
        .map_err(|_| missing())?;
    guard_case(&app, &headers, case_id)?;
    let c = app.store.conn();
    let mut a = c
        .query_row(&format!("SELECT {COLS} FROM analyses WHERE id = ?1"), [id], row_to_analysis)
        .map_err(|_| missing())?;
    a.image_ids = image_ids(&c, id);
    Ok(Json(a))
}

pub async fn create(
    State(app): State<App>,
    Path(case_id): Path<i64>,
    headers: HeaderMap,
    Json(req): Json<AnalysisReq>,
) -> Result<Json<Analysis>, Fail> {
    let (uid, _, _) = guard_case(&app, &headers, case_id)?;
    let is_admin = require_session(&app, &bearer(&headers)).map(|(_, a)| a).unwrap_or(false);
    if req.image_ids.is_empty() {
        return Err(err(StatusCode::BAD_REQUEST, "hay que elegir al menos una imagen"));
    }

    // Las imágenes tienen que ser de ESTE caso. Sin esto, conocer un id de
    // imagen ajena bastaría para arrastrarla a un análisis propio.
    {
        let c = app.store.conn();
        for id in &req.image_ids {
            let ok: i64 = c
                .query_row(
                    "SELECT COUNT(*) FROM images WHERE id = ?1 AND case_id = ?2",
                    rusqlite::params![id, case_id],
                    |r| r.get(0),
                )
                .unwrap_or(0);
            if ok == 0 {
                return Err(err(StatusCode::BAD_REQUEST, "esa imagen no es de este caso"));
            }
        }
    }

    if !is_admin {
        let l = crate::limits::effective(&app.store, uid);
        if !l.models.contains(&req.model) {
            return Err(err(
                StatusCode::FORBIDDEN,
                &format!("tu cuenta no tiene acceso al modelo {}", req.model),
            ));
        }
        let hoy: i64 = app
            .store
            .conn()
            .query_row(
                "SELECT COUNT(*) FROM analyses WHERE requested_by = ?1 AND created_at > ?2",
                rusqlite::params![uid, now() - 86400],
                |r| r.get(0),
            )
            .unwrap_or(0);
        if hoy >= l.max_daily {
            return Err(err(
                StatusCode::TOO_MANY_REQUESTS,
                &format!("has llegado a tu tope de {} análisis diarios", l.max_daily),
            ));
        }
    }

    let t = now();
    let id = {
        let c = app.store.conn();
        c.execute(
            "INSERT INTO analyses (case_id, requested_by, model, state, created_at)
             VALUES (?1, ?2, ?3, 'pendiente', ?4)",
            rusqlite::params![case_id, uid, req.model, t],
        )
        .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;
        let id = c.last_insert_rowid();
        for img in &req.image_ids {
            c.execute(
                "INSERT INTO analysis_images (analysis_id, image_id) VALUES (?1, ?2)",
                rusqlite::params![id, img],
            )
            .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;
        }
        id
    };
    tracing::info!("análisis #{id} en cola (modelo {}), sin motor todavía", req.model);
    Ok(Json(Analysis {
        id,
        case_id,
        model: req.model,
        state: "pendiente".into(),
        error: None,
        result_lat: None,
        result_lng: None,
        result_radius_m: None,
        result_confidence: None,
        image_ids: req.image_ids,
        created_at: t,
        finished_at: None,
    }))
}

/// SOLO PARA DESARROLLO. Rellena un análisis con un resultado inventado para
/// poder construir el mapa y la tarjeta contra algo real mientras no exista
/// el motor. Compilado fuera en release: `debug_assertions` es false ahí.
#[cfg(debug_assertions)]
pub async fn fake(
    State(app): State<App>,
    Path(id): Path<i64>,
    headers: HeaderMap,
) -> Result<StatusCode, Fail> {
    let case_id: i64 = app
        .store
        .conn()
        .query_row("SELECT case_id FROM analyses WHERE id = ?1", [id], |r| r.get(0))
        .map_err(|_| err(StatusCode::NOT_FOUND, "no existe ese análisis"))?;
    guard_case(&app, &headers, case_id)?;
    // Fijos y no aleatorios: así dos ejecuciones del mismo comando dan lo
    // mismo y una captura de pantalla sigue valiendo mañana.
    app.store
        .conn()
        .execute(
            "UPDATE analyses SET state = 'hecho', result_lat = 43.3612, result_lng = -8.4104,
                                 result_radius_m = 1400, result_confidence = 0.72,
                                 finished_at = ?1 WHERE id = ?2",
            rusqlite::params![now(), id],
        )
        .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn remove(
    State(app): State<App>,
    Path(id): Path<i64>,
    headers: HeaderMap,
) -> Result<StatusCode, Fail> {
    let case_id: i64 = app
        .store
        .conn()
        .query_row("SELECT case_id FROM analyses WHERE id = ?1", [id], |r| r.get(0))
        .map_err(|_| err(StatusCode::NOT_FOUND, "no existe ese análisis"))?;
    guard_case(&app, &headers, case_id)?;
    let c = app.store.conn();
    let _ = c.execute("DELETE FROM analysis_images WHERE analysis_id = ?1", [id]);
    c.execute("DELETE FROM analyses WHERE id = ?1", [id])
        .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;
    Ok(StatusCode::NO_CONTENT)
}
