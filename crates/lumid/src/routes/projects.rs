//! Proyectos y quién entra en ellos.
//!
//! El dueño es una fila de `project_members` con `role = 'owner'`: no hay
//! `owner_id`. Así "qué proyectos veo" es una sola unión, idéntica para el
//! dueño y para un invitado.

use crate::projects::{access, Role};
use crate::routes::access::now;
use crate::routes::auth::{bearer, require_session};
use crate::App;
use axum::extract::{Path, Query, State};
use axum::{http::HeaderMap, http::StatusCode, Json};
use lumi_proto::api::{Invite, MemberReq, NameReq, Project, ProjectMember, UserSummary};
use std::collections::HashMap;

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
             -- Una invitación pendiente no es un proyecto tuyo todavía: vive
             -- en `/v1/me/invites` hasta que la aceptas.
             WHERE m.user_id = ?1 AND m.status = 'accepted'
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
        "INSERT INTO project_members (project_id, user_id, role, status, added_at)
         VALUES (?1, ?2, 'owner', 'accepted', ?3)",
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
            // Sin estas dos, borrar un proyecto dejaba huérfanas para siempre
            // las filas de hipótesis y de agentes de cada análisis suyo —
            // nada las vuelve a tocar ni las cuenta, así que solo crecen.
            "DELETE FROM analysis_hypotheses WHERE analysis_id IN
               (SELECT a.id FROM analyses a JOIN cases k ON k.id = a.case_id WHERE k.project_id = ?1)",
            "DELETE FROM analysis_agents WHERE analysis_id IN
               (SELECT a.id FROM analyses a JOIN cases k ON k.id = a.case_id WHERE k.project_id = ?1)",
            "DELETE FROM analyses WHERE case_id IN (SELECT id FROM cases WHERE project_id = ?1)",
            "DELETE FROM images   WHERE case_id IN (SELECT id FROM cases WHERE project_id = ?1)",
            "DELETE FROM cases    WHERE project_id = ?1",
            "DELETE FROM project_members WHERE project_id = ?1",
            "DELETE FROM project_locks WHERE project_id = ?1",
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
            "SELECT m.user_id, u.username, m.role, m.status, m.added_at
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
                status: r.get(3)?,
                added_at: r.get(4)?,
            })
        })
        .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?
        .flatten()
        .collect();
    Ok(Json(rows))
}

/// Invitar no mete a nadie dentro todavía: deja la fila en `pending` y es
/// cosa de la invitada aceptarla desde `/v1/me/invites`. `access()` no la
/// cuenta hasta entonces.
pub async fn add_member(
    State(app): State<App>,
    Path(id): Path<i64>,
    headers: HeaderMap,
    Json(req): Json<MemberReq>,
) -> Result<StatusCode, Fail> {
    let (inviter, _) = guard(&app, &headers, id, true)?;
    let c = app.store.conn();
    let uid: i64 = c
        .query_row(
            "SELECT id FROM users WHERE username = ?1",
            [req.username.trim()],
            |r| r.get(0),
        )
        .map_err(|_| err(StatusCode::NOT_FOUND, "no hay ningún usuario con ese nombre"))?;
    let filas = c
        .execute(
            "INSERT INTO project_members (project_id, user_id, role, status, invited_by, added_at)
             VALUES (?1, ?2, 'member', 'pending', ?3, ?4)
             ON CONFLICT(project_id, user_id) DO NOTHING",
            rusqlite::params![id, uid, inviter, now()],
        )
        .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;
    // `ON CONFLICT DO NOTHING` deja `filas` en 0 si ya era miembro o ya
    // estaba invitada — avisar en ese caso sería una notificación de algo
    // que no acaba de pasar. Sin esto, la invitada dependía de un sondeo
    // cada 60s en `NotificationsPopover` para enterarse; ahora llega por el
    // mismo canal que ya tiene abierto su propia sesión.
    if filas > 0 {
        let project_name: String = c
            .query_row("SELECT name FROM projects WHERE id = ?1", [id], |r| r.get(0))
            .unwrap_or_default();
        let invited_by: String = c
            .query_row("SELECT username FROM users WHERE id = ?1", [inviter], |r| r.get(0))
            .unwrap_or_default();
        app.queue.difundir(lumi_proto::api::Cambio::Invitacion {
            user_id: uid,
            project_id: id,
            project_name,
            invited_by,
        });
    }
    Ok(StatusCode::NO_CONTENT)
}

/// Cuántas veces ha buscado cada sesión en la última ventana. Sin esto, una
/// sola sesión válida podía reconstruir el catálogo entero de usernames
/// probando letra por letra — la búsqueda en sí sigue siendo necesaria (es
/// la única forma honesta de saber si una cuenta existe antes de invitarla),
/// pero nada obliga a que sea gratis y sin límite para quien la use así.
fn limitador_busqueda() -> &'static std::sync::Mutex<HashMap<i64, (i64, u32)>> {
    static L: std::sync::OnceLock<std::sync::Mutex<HashMap<i64, (i64, u32)>>> = std::sync::OnceLock::new();
    L.get_or_init(|| std::sync::Mutex::new(HashMap::new()))
}

const BUSQUEDAS_POR_MINUTO: u32 = 20;

/// Sugerencias mientras se escribe a quién invitar. Cualquier sesión vale —no
/// solo el dueño del proyecto— porque en el momento de pedir esto todavía no
/// se sabe si el nombre pertenece a un proyecto que gestionas; es la misma
/// búsqueda que usaría cualquiera para comprobar si existe una cuenta con ese
/// nombre. Solo enseña id y username, nunca nada admin/bloqueado/etc.
pub async fn search_users(
    State(app): State<App>, headers: HeaderMap, Query(q): Query<HashMap<String, String>>,
) -> Result<Json<Vec<UserSummary>>, Fail> {
    let (uid, _) = require_session(&app, &bearer(&headers)).map_err(|c| (c, "sesión inválida".to_string()))?;
    let needle = q.get("q").map(|s| s.trim()).unwrap_or("");
    // Un solo carácter escanea casi cualquier username en 26 peticiones; dos
    // ya reducen el catálogo lo bastante como para que buscar de verdad (en
    // vez de barrer el servidor) sea el camino más corto.
    if needle.chars().count() < 2 {
        return Ok(Json(vec![]));
    }
    {
        let t = now();
        let mut mapa = limitador_busqueda().lock().unwrap();
        let entrada = mapa.entry(uid).or_insert((t, 0));
        if t - entrada.0 >= 60 {
            *entrada = (t, 0);
        }
        entrada.1 += 1;
        if entrada.1 > BUSQUEDAS_POR_MINUTO {
            return Err(err(StatusCode::TOO_MANY_REQUESTS, "demasiadas búsquedas; espera un momento"));
        }
    }
    let c = app.store.conn();
    let mut stmt = c
        .prepare("SELECT id, username FROM users WHERE username LIKE ?1 ORDER BY username LIMIT 8")
        .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;
    let rows = stmt
        .query_map([format!("%{needle}%")], |r| Ok(UserSummary { id: r.get(0)?, username: r.get(1)? }))
        .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?
        .flatten()
        .collect();
    Ok(Json(rows))
}

/// Las invitaciones sin resolver de quien pregunta, en todos sus proyectos.
pub async fn my_invites(State(app): State<App>, headers: HeaderMap) -> Result<Json<Vec<Invite>>, Fail> {
    let (uid, _) = require_session(&app, &bearer(&headers)).map_err(|c| (c, "sesión inválida".to_string()))?;
    let c = app.store.conn();
    let mut q = c
        .prepare(
            "SELECT m.project_id, p.name, COALESCE(u.username, '?'), m.added_at
             FROM project_members m
             JOIN projects p ON p.id = m.project_id
             LEFT JOIN users u ON u.id = m.invited_by
             WHERE m.user_id = ?1 AND m.status = 'pending'
             ORDER BY m.added_at DESC",
        )
        .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;
    let rows = q
        .query_map([uid], |r| {
            Ok(Invite {
                project_id: r.get(0)?,
                project_name: r.get(1)?,
                invited_by: r.get(2)?,
                added_at: r.get(3)?,
            })
        })
        .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?
        .flatten()
        .collect();
    Ok(Json(rows))
}

fn resolve_invite(app: &App, headers: &HeaderMap, project_id: i64, accept: bool) -> Result<StatusCode, Fail> {
    let (uid, _) = require_session(app, &bearer(headers)).map_err(|c| (c, "sesión inválida".to_string()))?;
    let sql = if accept {
        "UPDATE project_members SET status = 'accepted' WHERE project_id = ?1 AND user_id = ?2 AND status = 'pending'"
    } else {
        "DELETE FROM project_members WHERE project_id = ?1 AND user_id = ?2 AND status = 'pending'"
    };
    let n = app
        .store
        .conn()
        .execute(sql, rusqlite::params![project_id, uid])
        .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;
    if n == 0 {
        return Err(err(StatusCode::NOT_FOUND, "no tienes ninguna invitación pendiente a ese proyecto"));
    }
    Ok(StatusCode::NO_CONTENT)
}

pub async fn accept_invite(
    State(app): State<App>, Path(id): Path<i64>, headers: HeaderMap,
) -> Result<StatusCode, Fail> {
    resolve_invite(&app, &headers, id, true)
}

pub async fn decline_invite(
    State(app): State<App>, Path(id): Path<i64>, headers: HeaderMap,
) -> Result<StatusCode, Fail> {
    resolve_invite(&app, &headers, id, false)
}

/// Un proyecto, una persona a la vez. Es una cerradura de andar por casa: una
/// fila en `project_locks`, sin colas ni avisos en tiempo real. `enter` la
/// toma o la roba si está muerta; `leave` la suelta. Nada la libera si la app
/// se cierra mal salvo el tiempo (`STALE_AFTER`) o que la sesión de quien la
/// tenía caduque: por ahora es suficiente y no hace falta un latido.
const STALE_AFTER: i64 = 12 * 60 * 60;

pub async fn enter(State(app): State<App>, Path(id): Path<i64>, headers: HeaderMap) -> Result<StatusCode, Fail> {
    let (uid, _) = guard(&app, &headers, id, false)?;
    let token = bearer(&headers);
    let c = app.store.conn();
    let held: Option<(i64, String, i64)> = c
        .query_row(
            "SELECT user_id, token, since FROM project_locks WHERE project_id = ?1",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .ok();
    if let Some((holder, holder_token, since)) = held {
        if holder != uid {
            let session_valid = c
                .query_row(
                    "SELECT 1 FROM sessions WHERE token = ?1 AND expires_at > ?2",
                    rusqlite::params![holder_token, now()],
                    |_| Ok(()),
                )
                .is_ok();
            if session_valid && now() - since < STALE_AFTER {
                let username: String = c
                    .query_row("SELECT username FROM users WHERE id = ?1", [holder], |r| r.get(0))
                    .unwrap_or_else(|_| "otra persona".into());
                return Err(err(
                    StatusCode::CONFLICT,
                    &format!(
                        "{username} está trabajando en este proyecto ahora mismo; solo puede haber una persona dentro a la vez"
                    ),
                ));
            }
            // La sesión de quien la tenía ya no existe o lleva media jornada
            // colgada: se toma como abandonada y se roba sin preguntar.
        }
    }
    // Se guarda el hash, no el token en claro: esta fila se compara luego
    // directamente contra `sessions.token` (que ya guarda el hash) para
    // saber si la sesión de quien tiene el candado sigue viva — las dos
    // columnas tienen que hablar el mismo idioma.
    c.execute(
        "INSERT INTO project_locks (project_id, user_id, token, since) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(project_id) DO UPDATE SET user_id = ?2, token = ?3, since = ?4",
        rusqlite::params![id, uid, lumi_proto::crypto::hash_token(&token), now()],
    )
    .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;
    Ok(StatusCode::NO_CONTENT)
}

/// Solo quita el candado si es el tuyo: si ya te lo robaron por caducado no
/// hay nada que soltar, y si es de otra persona no es asunto tuyo tocarlo.
pub async fn leave(State(app): State<App>, Path(id): Path<i64>, headers: HeaderMap) -> Result<StatusCode, Fail> {
    let (uid, _) = require_session(&app, &bearer(&headers)).map_err(|c| (c, "sesión inválida".to_string()))?;
    app.store
        .conn()
        .execute(
            "DELETE FROM project_locks WHERE project_id = ?1 AND user_id = ?2",
            rusqlite::params![id, uid],
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
