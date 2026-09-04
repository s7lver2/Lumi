//! Análisis. Este subsistema los CREA y no los resuelve: nacen en `pendiente`
//! y ahí se quedan hasta que existan la cola (subsistema 4) y el motor (5).
//!
//! Esa fila con su `state` y su `model` es literalmente el enchufe del
//! subsistema 4: cuando la cola arranque, encontrará trabajo real esperando.

use crate::routes::access::now;
use crate::routes::auth::{bearer, require_admin, require_session};
use crate::routes::cases::guard_case;
use crate::routes::projects::{err, Fail};
use crate::App;
use axum::extract::{Path, State};
use axum::{http::HeaderMap, http::StatusCode, Json};
use lumi_proto::api::{Analysis, AnalysisReq};

const COLS: &str = "id, case_id, model, state, error, result_lat, result_lng,
                    result_radius_m, result_confidence, created_at, finished_at, nivel_efectivo,
                    result_inliers, result_verificador";

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
        hypotheses: vec![],
        nivel_efectivo: r.get(11)?,
        agentes: vec![],
        created_at: r.get(9)?,
        finished_at: r.get(10)?,
        result_inliers: r.get(12)?,
        result_verificador: r.get(13)?,
    })
}

/// Las alternativas de un análisis, en orden. Vacía y no `null` cuando no
/// hay ninguna: el cliente no debería tener dos casos donde hay uno.
fn hypotheses(c: &rusqlite::Connection, analysis_id: i64) -> Vec<lumi_proto::worker::Hipotesis> {
    let Ok(mut q) = c.prepare(
        "SELECT lat, lng, radio_m, peso, indice, autor, inliers, verificador, motivo_agente
           FROM analysis_hypotheses WHERE analysis_id = ?1 ORDER BY orden",
    ) else {
        return vec![];
    };
    q.query_map([analysis_id], |r| {
        Ok(lumi_proto::worker::Hipotesis {
            lat: r.get(0)?,
            lng: r.get(1)?,
            radio_m: r.get(2)?,
            peso: r.get(3)?,
            indice: r.get(4)?,
            autor: r.get(5)?,
            inliers: r.get::<_, Option<i64>>(6)?.map(|n| n as u32),
            verificador: r.get(7)?,
            motivo_agente: r.get(8)?,
        })
    })
    .map(|it| it.flatten().collect())
    .unwrap_or_default()
}

fn agentes(c: &rusqlite::Connection, analysis_id: i64) -> Vec<lumi_proto::api::DichoDeAgente> {
    let Ok(mut q) = c.prepare(
        "SELECT agente, nombre, etiqueta, confianza, tipo, detalle
           FROM analysis_agents WHERE analysis_id = ?1 ORDER BY agente",
    ) else {
        return Vec::new();
    };
    let Ok(filas) = q.query_map([analysis_id], |r| {
        Ok(lumi_proto::api::DichoDeAgente {
            agente: r.get(0)?,
            nombre: r.get(1)?,
            etiqueta: r.get(2)?,
            confianza: r.get(3)?,
            tipo: r.get(4)?,
            detalle: r.get(5)?,
        })
    }) else {
        return Vec::new();
    };
    filas.flatten().collect()
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
        a.hypotheses = hypotheses(&c, a.id);
        a.agentes = agentes(&c, a.id);
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
    a.hypotheses = hypotheses(&c, id);
    a.agentes = agentes(&c, id);
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
        if l.weekly_enabled {
            let semana: i64 = app
                .store
                .conn()
                .query_row(
                    "SELECT COUNT(*) FROM analyses WHERE requested_by = ?1 AND created_at > ?2",
                    rusqlite::params![uid, now() - 7 * 86400],
                    |r| r.get(0),
                )
                .unwrap_or(0);
            if semana >= l.max_weekly {
                return Err(err(
                    StatusCode::TOO_MANY_REQUESTS,
                    &format!("has llegado a tu tope de {} análisis semanales", l.max_weekly),
                ));
            }
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
    // Sin esto el trabajo esperaría al tic de dos segundos de la cola. Con
    // esto sale hacia una GPU en cuanto hay una libre.
    app.queue.avisar();
    tracing::info!("análisis #{id} encolado (modelo {})", req.model);
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
        result_inliers: None,
        result_verificador: None,
        image_ids: req.image_ids,
        hypotheses: vec![],
        nivel_efectivo: None,
        agentes: vec![],
        created_at: t,
        finished_at: None,
    }))
}

pub async fn remove(
    State(app): State<App>,
    Path(id): Path<i64>,
    headers: HeaderMap,
) -> Result<StatusCode, Fail> {
    let (case_id, state): (i64, String) = app
        .store
        .conn()
        .query_row("SELECT case_id, state FROM analyses WHERE id = ?1", [id], |r| {
            Ok((r.get(0)?, r.get(1)?))
        })
        .map_err(|_| err(StatusCode::NOT_FOUND, "no existe ese análisis"))?;
    // Un administrador puede cancelar cualquier pendiente desde la página
    // de Cola aunque no sea miembro del proyecto de ese caso. Cualquier
    // otra persona sigue necesitando `guard_case`.
    if require_admin(&app, &bearer(&headers)).is_err() {
        guard_case(&app, &headers, case_id)?;
    }
    // Cancelar es esto: borrar lo que todavía no ha empezado. Lo que ya está en
    // una GPU llega hasta el final — matarlo tiraría cómputo ya gastado.
    if state == "en_curso" {
        return Err(err(
            StatusCode::CONFLICT,
            "este análisis ya se está ejecutando; no se puede cancelar a mitad",
        ));
    }
    let c = app.store.conn();
    let _ = c.execute("DELETE FROM analysis_images WHERE analysis_id = ?1", [id]);
    // Un huérfano en analysis_hypotheses/analysis_agents no rompe nada hoy,
    // pero es basura que crece: se borra en cascada con el resto de lo que
    // cuelga del análisis. Antes solo se limpiaba hipótesis y no agentes.
    let _ = c.execute("DELETE FROM analysis_hypotheses WHERE analysis_id = ?1", [id]);
    let _ = c.execute("DELETE FROM analysis_agents WHERE analysis_id = ?1", [id]);
    c.execute("DELETE FROM analyses WHERE id = ?1", [id])
        .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;
    tracing::info!("análisis #{id} cancelado (estaba {state})");
    Ok(StatusCode::NO_CONTENT)
}
