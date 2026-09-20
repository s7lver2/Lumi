//! Casos: el contenedor dentro de un proyecto. Las imágenes cuelgan de aquí.

use crate::projects::{access, Role};
use crate::routes::access::now;
use crate::routes::auth::{bearer, require_session};
use crate::routes::projects::{err, Fail};
use crate::App;
use axum::extract::{Path, State};
use axum::{http::HeaderMap, http::StatusCode, Json};
use lumi_proto::api::{Case, NameReq};

const MAX_NAME: usize = 80;

/// Sesión + acceso al proyecto del caso. Devuelve (usuario, proyecto, papel).
/// La usan también las imágenes y los análisis: es su único camino a `access`.
///
/// D1: uno de los dos caminos calientes elegidos para la primera tanda de
/// migración a `Store::leer` (junto a los middlewares de D2) -- las dos
/// consultas de aquí abajo corrían antes inline en el hilo del runtime bajo
/// `app.store.conn()` directo, y `guard_case` se llama en casi cualquier
/// ruta protegida (imágenes, análisis, export...). Duplica el SQL de
/// `projects::access`/`project_of_case` en vez de llamarlas (esas dos toman
/// `&Store`, no `&Connection`, y cambiar su firma tocaría a todos SUS
/// llamantes, fuera de alcance de este ítem) -- ambas consultas siguen
/// siendo el mismo criterio de acceso, solo que agrupadas bajo un único
/// `spawn_blocking`.
pub async fn guard_case(app: &App, headers: &HeaderMap, case_id: i64) -> Result<(i64, i64, Role), Fail> {
    let (uid, _) = require_session(app, &bearer(headers))
        .map_err(|c| (c, "sesión inválida".to_string()))?;
    let missing = || err(StatusCode::NOT_FOUND, "no existe ese caso");
    let (pid, role): (Option<i64>, Option<String>) = crate::store::Store::leer(app.store.clone(), move |c| {
        let pid: Option<i64> = c
            .query_row("SELECT project_id FROM cases WHERE id = ?1", [case_id], |r| r.get(0))
            .ok();
        let Some(pid) = pid else { return (None, None) };
        let role: Option<String> = c
            .query_row(
                "SELECT role FROM project_members
                 WHERE project_id = ?1 AND user_id = ?2 AND status = 'accepted'",
                rusqlite::params![pid, uid],
                |r| r.get(0),
            )
            .ok();
        (Some(pid), role)
    })
    .await;
    let pid = pid.ok_or_else(missing)?;
    let role = match role.as_deref() {
        Some("owner") => Role::Owner,
        Some("member") => Role::Member,
        _ => return Err(missing()),
    };
    Ok((uid, pid, role))
}

fn guard_project(app: &App, headers: &HeaderMap, project_id: i64) -> Result<i64, Fail> {
    let (uid, _) = require_session(app, &bearer(headers))
        .map_err(|c| (c, "sesión inválida".to_string()))?;
    access(&app.store, uid, project_id)
        .ok_or_else(|| err(StatusCode::NOT_FOUND, "no existe ese proyecto"))?;
    Ok(uid)
}

pub async fn list(
    State(app): State<App>,
    Path(project_id): Path<i64>,
    headers: HeaderMap,
) -> Result<Json<Vec<Case>>, Fail> {
    guard_project(&app, &headers, project_id)?;
    let c = app.store.conn();
    let mut q = c
        .prepare(
            "SELECT k.id, k.project_id, k.name, k.created_at,
                    (SELECT COUNT(*) FROM images WHERE case_id = k.id),
                    (SELECT COUNT(*) FROM analyses WHERE case_id = k.id),
                    (SELECT COUNT(*) FROM analyses WHERE case_id = k.id AND state = 'hecho'),
                    (SELECT result_lat FROM analyses WHERE case_id = k.id AND state = 'hecho'
                      ORDER BY finished_at DESC LIMIT 1),
                    (SELECT result_lng FROM analyses WHERE case_id = k.id AND state = 'hecho'
                      ORDER BY finished_at DESC LIMIT 1)
             FROM cases k WHERE k.project_id = ?1 ORDER BY k.created_at",
        )
        .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;
    let rows = q
        .query_map([project_id], |r| {
            Ok(Case {
                id: r.get(0)?,
                project_id: r.get(1)?,
                name: r.get(2)?,
                created_at: r.get(3)?,
                images: r.get(4)?,
                analyses: r.get(5)?,
                resolved: r.get(6)?,
                lat: r.get(7)?,
                lng: r.get(8)?,
            })
        })
        .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?
        .flatten()
        .collect();
    Ok(Json(rows))
}

pub async fn create(
    State(app): State<App>,
    Path(project_id): Path<i64>,
    headers: HeaderMap,
    Json(req): Json<NameReq>,
) -> Result<Json<Case>, Fail> {
    guard_project(&app, &headers, project_id)?;
    let name = req.name.trim();
    if name.is_empty() || name.chars().count() > MAX_NAME {
        return Err(err(StatusCode::BAD_REQUEST, "el nombre está vacío o pasa de 80 caracteres"));
    }
    let t = now();
    let c = app.store.conn();
    c.execute(
        "INSERT INTO cases (project_id, name, created_at) VALUES (?1, ?2, ?3)",
        rusqlite::params![project_id, name, t],
    )
    .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;
    let id = c.last_insert_rowid();
    // Tocar el proyecto: la lista del arranque se ordena por uso reciente, y
    // crear un caso dentro es usarlo.
    let _ = c.execute("UPDATE projects SET updated_at = ?1 WHERE id = ?2", rusqlite::params![t, project_id]);
    tracing::info!("caso \"{name}\" creado en el proyecto {project_id}");
    Ok(Json(Case {
        id,
        project_id,
        name: name.to_string(),
        images: 0,
        analyses: 0,
        resolved: 0,
        lat: None,
        lng: None,
        created_at: t,
    }))
}

pub async fn rename(
    State(app): State<App>,
    Path(id): Path<i64>,
    headers: HeaderMap,
    Json(req): Json<NameReq>,
) -> Result<StatusCode, Fail> {
    guard_case(&app, &headers, id).await?;
    let name = req.name.trim();
    if name.is_empty() || name.chars().count() > MAX_NAME {
        return Err(err(StatusCode::BAD_REQUEST, "el nombre está vacío o pasa de 80 caracteres"));
    }
    app.store
        .conn()
        .execute("UPDATE cases SET name = ?1 WHERE id = ?2", rusqlite::params![name, id])
        .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn remove(
    State(app): State<App>,
    Path(id): Path<i64>,
    headers: HeaderMap,
) -> Result<StatusCode, Fail> {
    let (_, pid, _) = guard_case(&app, &headers, id).await?;
    // Los archivos de cada imagen, antes de perder sus filas.
    let files: Vec<i64> = {
        let c = app.store.conn();
        let mut q = c
            .prepare("SELECT id FROM images WHERE case_id = ?1")
            .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;
        let v = q.query_map([id], |r| r.get(0)).map(|it| it.flatten().collect());
        v.unwrap_or_default()
    };
    {
        let c = app.store.conn();
        for sql in [
            "DELETE FROM analysis_images WHERE analysis_id IN (SELECT id FROM analyses WHERE case_id = ?1)",
            // Mismo motivo que en `projects::remove`: sin esto quedan
            // huérfanas para siempre, y nada las cuenta ni las reclama.
            "DELETE FROM analysis_hypotheses WHERE analysis_id IN (SELECT id FROM analyses WHERE case_id = ?1)",
            "DELETE FROM analysis_agents WHERE analysis_id IN (SELECT id FROM analyses WHERE case_id = ?1)",
            "DELETE FROM analyses WHERE case_id = ?1",
            "DELETE FROM images WHERE case_id = ?1",
            "DELETE FROM cases WHERE id = ?1",
        ] {
            c.execute(sql, [id])
                .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;
        }
    }
    let base = app.dir.join("projects").join(pid.to_string());
    for img in files {
        let _ = std::fs::remove_file(base.join(img.to_string()));
        let _ = std::fs::remove_file(base.join(format!("{img}.thumb")));
    }
    tracing::info!("caso {id} borrado, del proyecto {pid}");
    Ok(StatusCode::NO_CONTENT)
}
