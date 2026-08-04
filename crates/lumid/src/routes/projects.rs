//! Proyectos y quién entra en ellos.
//!
//! El dueño es una fila de `project_members` con `role = 'owner'`: no hay
//! `owner_id`. Así "qué proyectos veo" es una sola unión, idéntica para el
//! dueño y para un invitado.

use crate::projects::{access, Role};
use crate::routes::access::now;
use crate::routes::auth::{bearer, require_session};
use crate::App;
use axum::extract::{Path, State};
use axum::{http::HeaderMap, http::StatusCode, Json};
use lumi_proto::api::{MemberReq, NameReq, Project, ProjectMember};

const MAX_NAME: usize = 80;

/// Error con su motivo escrito, no solo un código. Lo reutilizan los casos,
/// las imágenes y los análisis: es la forma de error de todo el subsistema.
pub type Fail = (StatusCode, String);

pub fn err(c: StatusCode, m: &str) -> Fail {
    (c, m.to_string())
}

/// Sesión válida + papel en el proyecto. `manage` exige ser el dueño.
fn guard(app: &App, headers: &HeaderMap, project_id: i64, manage: bool) -> Result<(i64, Role), Fail> {
    let (uid, _) = require_session(app, &bearer(headers))
        .map_err(|c| (c, "sesión inválida".to_string()))?;
    // 404 y no 403 cuando no eres miembro: confirmar que el proyecto existe ya
    // sería filtrar que alguien investiga algo.
    let role = access(&app.store, uid, project_id)
        .ok_or_else(|| err(StatusCode::NOT_FOUND, "no existe ese proyecto"))?;
    if manage && !role.manages() {
        return Err(err(StatusCode::FORBIDDEN, "solo el dueño del proyecto puede hacer esto"));
    }
    Ok((uid, role))
}

pub async fn list(State(app): State<App>, headers: HeaderMap) -> Result<Json<Vec<Project>>, Fail> {
    let (uid, _) = require_session(&app, &bearer(&headers))
        .map_err(|c| (c, "sesión inválida".to_string()))?;
    let c = app.store.conn();
    // Antes esto era una subconsulta correlacionada por proyecto (tres,
    // de hecho): para cada fila de `projects` volvía a recorrer `images`
    // entera buscando las suyas por `case_id`, sin ningún índice que
    // relacione imagen con proyecto directamente. Con unos pocos proyectos
    // de prueba no se notaba; con las imágenes acumuladas de sesiones
    // reales, la lista tardaba segundos en cargar. Los `GROUP BY` de abajo
    // agregan cada tabla en una sola pasada, y el `LEFT JOIN` con `projects`
    // es lo único que queda por proyecto.
    let mut q = c
        .prepare(
            "SELECT p.id, p.name, m.role, p.created_at, p.updated_at,
                    COALESCE(kc.n, 0), COALESCE(ic.n, 0), COALESCE(ic.bytes, 0)
             FROM projects p
             JOIN project_members m ON m.project_id = p.id
             LEFT JOIN (SELECT project_id, COUNT(*) AS n FROM cases GROUP BY project_id) kc
               ON kc.project_id = p.id
             LEFT JOIN (
               SELECT k.project_id AS project_id, COUNT(*) AS n, SUM(i.bytes) AS bytes
               FROM images i JOIN cases k ON k.id = i.case_id
               GROUP BY k.project_id
             ) ic ON ic.project_id = p.id
             WHERE m.user_id = ?1
             ORDER BY p.updated_at DESC",
        )
        .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;
    let rows = q
        .query_map([uid], |r| {
            Ok(Project {
                id: r.get(0)?,
                name: r.get(1)?,
                role: r.get(2)?,
                created_at: r.get(3)?,
                updated_at: r.get(4)?,
                cases: r.get(5)?,
                images: r.get(6)?,
                bytes: r.get(7)?,
            })
        })
        .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?
        .flatten()
        .collect();
    Ok(Json(rows))
}

pub async fn create(
    State(app): State<App>,
    headers: HeaderMap,
    Json(req): Json<NameReq>,
) -> Result<Json<Project>, Fail> {
    let (uid, is_admin) = require_session(&app, &bearer(&headers))
        .map_err(|c| (c, "sesión inválida".to_string()))?;
    let name = req.name.trim();
    if name.is_empty() || name.chars().count() > MAX_NAME {
        return Err(err(StatusCode::BAD_REQUEST, "el nombre está vacío o pasa de 80 caracteres"));
    }
    // Los administradores ignoran los límites, igual que en el subsistema 2.
    if !is_admin && !crate::limits::effective(&app.store, uid).can_create_projects {
        return Err(err(
            StatusCode::FORBIDDEN,
            "tu cuenta no puede crear proyectos; habla con el administrador",
        ));
    }
    let t = now();
    let c = app.store.conn();
    c.execute(
        "INSERT INTO projects (name, created_at, updated_at) VALUES (?1, ?2, ?2)",
        rusqlite::params![name, t],
    )
    .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;
    let id = c.last_insert_rowid();
    c.execute(
        "INSERT INTO project_members (project_id, user_id, role, added_at) VALUES (?1, ?2, 'owner', ?3)",
        rusqlite::params![id, uid, t],
    )
    .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;
    Ok(Json(Project {
        id,
        name: name.to_string(),
        role: "owner".into(),
        cases: 0,
        images: 0,
        bytes: 0,
        created_at: t,
        updated_at: t,
    }))
}

pub async fn rename(
    State(app): State<App>,
    Path(id): Path<i64>,
    headers: HeaderMap,
    Json(req): Json<NameReq>,
) -> Result<StatusCode, Fail> {
    guard(&app, &headers, id, true)?;
    let name = req.name.trim();
    if name.is_empty() || name.chars().count() > MAX_NAME {
        return Err(err(StatusCode::BAD_REQUEST, "el nombre está vacío o pasa de 80 caracteres"));
    }
    app.store
        .conn()
        .execute(
            "UPDATE projects SET name = ?1, updated_at = ?2 WHERE id = ?3",
            rusqlite::params![name, now(), id],
        )
        .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;
    Ok(StatusCode::NO_CONTENT)
}

/// Borra el proyecto entero. La cascada es a mano porque el store abre con
/// `foreign_keys = OFF`, y los archivos hay que barrerlos igual: la base no
/// sabe nada del disco.
pub async fn remove(
    State(app): State<App>,
    Path(id): Path<i64>,
    headers: HeaderMap,
) -> Result<StatusCode, Fail> {
    guard(&app, &headers, id, true)?;
    {
        let c = app.store.conn();
        let sql = [
            "DELETE FROM analysis_images WHERE analysis_id IN
               (SELECT a.id FROM analyses a JOIN cases k ON k.id = a.case_id WHERE k.project_id = ?1)",
            "DELETE FROM analyses WHERE case_id IN (SELECT id FROM cases WHERE project_id = ?1)",
            "DELETE FROM images   WHERE case_id IN (SELECT id FROM cases WHERE project_id = ?1)",
            "DELETE FROM cases    WHERE project_id = ?1",
            "DELETE FROM project_members WHERE project_id = ?1",
            "DELETE FROM projects WHERE id = ?1",
        ];
        for s in sql {
            c.execute(s, [id])
                .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;
        }
    }
    let _ = std::fs::remove_dir_all(app.dir.join("projects").join(id.to_string()));
    tracing::info!("proyecto #{id} borrado");
    Ok(StatusCode::NO_CONTENT)
}

pub async fn members(
    State(app): State<App>,
    Path(id): Path<i64>,
    headers: HeaderMap,
) -> Result<Json<Vec<ProjectMember>>, Fail> {
    guard(&app, &headers, id, false)?;
    let c = app.store.conn();
    let mut q = c
        .prepare(
            "SELECT m.user_id, u.username, m.role, m.added_at
             FROM project_members m JOIN users u ON u.id = m.user_id
             WHERE m.project_id = ?1 ORDER BY (m.role = 'owner') DESC, u.username",
        )
        .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;
    let rows = q
        .query_map([id], |r| {
            Ok(ProjectMember {
                user_id: r.get(0)?,
                username: r.get(1)?,
                role: r.get(2)?,
                added_at: r.get(3)?,
            })
        })
        .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?
        .flatten()
        .collect();
    Ok(Json(rows))
}

pub async fn add_member(
    State(app): State<App>,
    Path(id): Path<i64>,
    headers: HeaderMap,
    Json(req): Json<MemberReq>,
) -> Result<StatusCode, Fail> {
    guard(&app, &headers, id, true)?;
    let c = app.store.conn();
    let uid: i64 = c
        .query_row(
            "SELECT id FROM users WHERE username = ?1",
            [req.username.trim()],
            |r| r.get(0),
        )
        .map_err(|_| err(StatusCode::NOT_FOUND, "no hay ningún usuario con ese nombre"))?;
    c.execute(
        "INSERT INTO project_members (project_id, user_id, role, added_at) VALUES (?1, ?2, 'member', ?3)
         ON CONFLICT(project_id, user_id) DO NOTHING",
        rusqlite::params![id, uid, now()],
    )
    .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;
    Ok(StatusCode::NO_CONTENT)
}

/// El dueño quita a quien quiera; cualquiera puede quitarse a sí mismo. El
/// dueño no puede salirse: no hay a quién dejarle el proyecto porque traspasar
/// la propiedad está aparcado (ver FUTURO.md). Su salida es borrarlo.
pub async fn remove_member(
    State(app): State<App>,
    Path((id, target)): Path<(i64, i64)>,
    headers: HeaderMap,
) -> Result<StatusCode, Fail> {
    let (uid, role) = guard(&app, &headers, id, false)?;
    if target != uid && !role.manages() {
        return Err(err(StatusCode::FORBIDDEN, "solo el dueño del proyecto puede hacer esto"));
    }
    if target == uid && role.manages() {
        return Err(err(
            StatusCode::CONFLICT,
            "eres el dueño: para dejar de tenerlo hay que borrar el proyecto",
        ));
    }
    app.store
        .conn()
        .execute(
            "DELETE FROM project_members WHERE project_id = ?1 AND user_id = ?2 AND role <> 'owner'",
            rusqlite::params![id, target],
        )
        .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;
    Ok(StatusCode::NO_CONTENT)
}
