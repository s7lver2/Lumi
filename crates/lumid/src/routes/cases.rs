//! Casos: el contenedor dentro de un proyecto. Las imágenes cuelgan de aquí.

use crate::projects::{access, Role};
use crate::routes::access::now;
use crate::routes::auth::{bearer, require_session};
use crate::routes::projects::{err, Fail};
use crate::App;
use axum::extract::{Path, State};
use axum::{http::HeaderMap, http::StatusCode, Json};
use lumi_proto::api::{Case, CaseReq, NameReq};

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
pub async fn guard_case(
    app: &App,
    headers: &HeaderMap,
    method: &axum::http::Method,
    case_id: i64,
) -> Result<(i64, i64, Role), Fail> {
    let (uid, is_admin) = require_session(app, &bearer(headers))
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
    // Darkroom Fase 1 §3, punto 1: hasta ahora el candado solo lo comprobaba
    // `enter` -- cualquier otra ruta (o una API key) podía escribir en un
    // caso tomado por otra persona. Solo lo que escribe (POST/PATCH/PUT/
    // DELETE) exige tener el caso; las lecturas pasan siempre, y un
    // administrador nunca se queda fuera de algo que administra (mismo
    // criterio que `routes::mantenimiento`).
    if !is_admin
        && method != axum::http::Method::GET
        && method != axum::http::Method::HEAD
        && crate::routes::colaboracion::caso_exclusivo(app)
    {
        let held: Option<(i64, i64)> = app
            .store
            .conn()
            .query_row("SELECT user_id, since FROM case_locks WHERE case_id = ?1", [case_id], |r| {
                Ok((r.get(0)?, r.get(1)?))
            })
            .ok();
        if let Some((holder, since)) = held {
            if holder != uid && now() - since < crate::routes::colaboracion::caso_liberar_s(app) {
                let username: String = app
                    .store
                    .conn()
                    .query_row("SELECT username FROM users WHERE id = ?1", [holder], |r| r.get(0))
                    .unwrap_or_else(|_| "otra persona".into());
                return Err(err(
                    StatusCode::CONFLICT,
                    &format!(
                        "{username} tiene este caso ahora mismo; solo puede haber una persona trabajando en él a la vez"
                    ),
                ));
            }
        }
    }
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
    // Los ajustes se leen ANTES de tomar la conexión: `get_meta` vuelve a
    // pedir el mismo mutex del store, y pedirlo con el guard ya en la mano
    // cuelga el hilo para siempre.
    let ahora = now();
    let limite = crate::routes::colaboracion::caso_liberar_s(&app);
    let c = app.store.conn();
    let mut q = c
        .prepare(
            "SELECT k.id, k.project_id, k.name, k.backend, k.created_at,
                    (SELECT COUNT(*) FROM images WHERE case_id = k.id),
                    (SELECT COUNT(*) FROM analyses WHERE case_id = k.id),
                    (SELECT COUNT(*) FROM analyses WHERE case_id = k.id AND state = 'hecho'),
                    (SELECT result_lat FROM analyses WHERE case_id = k.id AND state = 'hecho'
                      ORDER BY finished_at DESC LIMIT 1),
                    (SELECT result_lng FROM analyses WHERE case_id = k.id AND state = 'hecho'
                      ORDER BY finished_at DESC LIMIT 1),
                    lk.username, lk.user_id
             FROM cases k
             LEFT JOIN (
               SELECT cl.case_id, u.username, u.id AS user_id
               FROM case_locks cl
               JOIN sessions s ON s.token = cl.token AND s.expires_at > ?2
               JOIN users u ON u.id = cl.user_id
               WHERE ?2 - cl.since < ?3
             ) lk ON lk.case_id = k.id
             WHERE k.project_id = ?1 ORDER BY k.created_at",
        )
        .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;
    let rows = q
        .query_map(rusqlite::params![project_id, ahora, limite], |r| {
            Ok(Case {
                id: r.get(0)?,
                project_id: r.get(1)?,
                name: r.get(2)?,
                backend: r.get(3)?,
                created_at: r.get(4)?,
                images: r.get(5)?,
                analyses: r.get(6)?,
                resolved: r.get(7)?,
                lat: r.get(8)?,
                lng: r.get(9)?,
                locked_by: r.get(10)?,
                locked_by_id: r.get(11)?,
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
    Json(req): Json<CaseReq>,
) -> Result<Json<Case>, Fail> {
    guard_project(&app, &headers, project_id)?;
    let name = req.name.trim();
    if name.is_empty() || name.chars().count() > MAX_NAME {
        return Err(err(StatusCode::BAD_REQUEST, "el nombre está vacío o pasa de 80 caracteres"));
    }
    if req.backend != "normal" && req.backend != "darkroom" {
        return Err(err(StatusCode::BAD_REQUEST, "backend debe ser \"normal\" o \"darkroom\""));
    }
    let t = now();
    let c = app.store.conn();
    c.execute(
        "INSERT INTO cases (project_id, name, backend, created_at) VALUES (?1, ?2, ?3, ?4)",
        rusqlite::params![project_id, name, req.backend, t],
    )
    .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;
    let id = c.last_insert_rowid();
    // Tocar el proyecto: la lista del arranque se ordena por uso reciente, y
    // crear un caso dentro es usarlo.
    let _ = c.execute("UPDATE projects SET updated_at = ?1 WHERE id = ?2", rusqlite::params![t, project_id]);
    tracing::info!("caso \"{name}\" ({}) creado en el proyecto {project_id}", req.backend);
    Ok(Json(Case {
        id,
        project_id,
        name: name.to_string(),
        backend: req.backend,
        images: 0,
        analyses: 0,
        resolved: 0,
        lat: None,
        lng: None,
        created_at: t,
        locked_by: None,
        locked_by_id: None,
    }))
}

pub async fn rename(
    State(app): State<App>,
    Path(id): Path<i64>,
    method: axum::http::Method,
    headers: HeaderMap,
    Json(req): Json<NameReq>,
) -> Result<StatusCode, Fail> {
    guard_case(&app, &headers, &method, id).await?;
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
    method: axum::http::Method,
    headers: HeaderMap,
) -> Result<StatusCode, Fail> {
    let (_, pid, _) = guard_case(&app, &headers, &method, id).await?;
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

/// Un caso, una persona a la vez -- si `caso_exclusivo` está activo
/// (`routes::colaboracion`). Es la misma cerradura que antes vivía en
/// `project_locks`/`routes::projects`, mudada de ámbito: varias personas ya
/// pueden compartir un proyecto, pero no el mismo caso (spec Darkroom Parte
/// 3).
pub async fn enter(
    State(app): State<App>,
    Path(id): Path<i64>,
    headers: HeaderMap,
) -> Result<StatusCode, Fail> {
    // `guard_case` con GET a propósito: tomar el candado es justo la
    // operación que NO puede chocar con el candado -- si chocara, nadie
    // podría robar uno abandonado. La exclusividad la comprueba este mismo
    // handler unas líneas más abajo, y con más criterio (además del plazo,
    // mira si la sesión de quien lo tiene sigue viva).
    let (uid, pid, _role) = guard_case(&app, &headers, &axum::http::Method::GET, id).await?;
    let token = bearer(&headers);
    // Igual que en `list`: los ajustes, antes del guard de la conexión.
    let exclusivo = crate::routes::colaboracion::caso_exclusivo(&app);
    let limite = crate::routes::colaboracion::caso_liberar_s(&app);
    let tope = crate::routes::colaboracion::proyecto_max_personas(&app);
    let c = app.store.conn();
    if exclusivo {
        let held: Option<(i64, String, i64)> = c
            .query_row(
                "SELECT user_id, token, since FROM case_locks WHERE case_id = ?1",
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
                if session_valid && now() - since < limite {
                    let username: String = c
                        .query_row("SELECT username FROM users WHERE id = ?1", [holder], |r| r.get(0))
                        .unwrap_or_else(|_| "otra persona".into());
                    return Err(err(
                        StatusCode::CONFLICT,
                        &format!(
                            "{username} está trabajando en este caso ahora mismo; solo puede haber una persona dentro a la vez"
                        ),
                    ));
                }
            }
        }
    }
    if tope > 0 {
        let ya_tenia: bool = c
            .query_row("SELECT 1 FROM case_locks WHERE case_id = ?1 AND user_id = ?2", [id, uid], |_| Ok(()))
            .is_ok();
        if !ya_tenia {
            let personas: i64 = c
                .query_row(
                    "SELECT COUNT(DISTINCT cl.user_id) FROM case_locks cl
                     JOIN cases k ON k.id = cl.case_id
                     JOIN sessions s ON s.token = cl.token AND s.expires_at > ?2
                     WHERE k.project_id = ?1 AND ?2 - cl.since < ?3",
                    rusqlite::params![pid, now(), limite],
                    |r| r.get(0),
                )
                .unwrap_or(0);
            if personas >= tope {
                return Err(err(
                    StatusCode::CONFLICT,
                    "este proyecto ya tiene el máximo de personas trabajando a la vez que permite el administrador",
                ));
            }
        }
    }
    // Se guarda el hash, no el token en claro: esta fila se compara luego
    // directamente contra `sessions.token` (que ya guarda el hash) para saber
    // si la sesión de quien tiene el candado sigue viva.
    c.execute(
        "INSERT INTO case_locks (case_id, user_id, token, since) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(case_id) DO UPDATE SET user_id = ?2, token = ?3, since = ?4",
        rusqlite::params![id, uid, lumi_proto::crypto::hash_token(&token), now()],
    )
    .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;
    Ok(StatusCode::NO_CONTENT)
}

/// Solo quita el candado si es el tuyo: si ya te lo robaron por caducado no
/// hay nada que soltar, y si es de otra persona no es asunto tuyo tocarlo.
pub async fn leave(State(app): State<App>, Path(id): Path<i64>, headers: HeaderMap) -> Result<StatusCode, Fail> {
    let (uid, _) = require_session(&app, &bearer(&headers)).map_err(|c| (c, "sesión inválida".to_string()))?;
    let pid: Option<i64> = app.store.conn().query_row("SELECT project_id FROM cases WHERE id = ?1", [id], |r| r.get(0)).ok();
    app.store
        .conn()
        .execute("DELETE FROM case_locks WHERE case_id = ?1 AND user_id = ?2", rusqlite::params![id, uid])
        .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;
    if let Some(pid) = pid {
        difundir_caso_libre(&app, pid, id);
    }
    Ok(StatusCode::NO_CONTENT)
}

/// Le quita el candado a quien lo tenga, sin esperar a que lo suelte él mismo
/// o a que caduque -- para cuando alguien se queda dentro del caso y otra
/// persona necesita entrar ya. Quién puede hacerlo lo decide el administrador
/// (`colaboracion::caso_expulsar_rol`).
pub async fn kick(
    State(app): State<App>,
    Path(id): Path<i64>,
    headers: HeaderMap,
) -> Result<StatusCode, Fail> {
    // GET otra vez, por lo mismo que `enter`: expulsar a quien tiene el
    // candado no puede exigir tenerlo. Quién puede hacerlo lo decide
    // `caso_expulsar_rol` justo aquí debajo.
    let (uid, pid, role) = guard_case(&app, &headers, &axum::http::Method::GET, id).await?;
    let rol = crate::routes::colaboracion::caso_expulsar_rol(&app);
    let is_admin = crate::routes::auth::require_admin(&app, &bearer(&headers)).is_ok();
    let permitido = match rol.as_str() {
        "cualquier_miembro" => true,
        "admin_o_dueno" => is_admin || role == Role::Owner,
        _ => is_admin,
    };
    if !permitido {
        return Err(err(StatusCode::FORBIDDEN, "no tienes permiso para expulsar a quien tiene este caso"));
    }
    // El bloque acota el guard de la conexión: `difundir_caso_libre` vuelve a
    // pedir el mismo mutex del store, y hacerlo con este todavía en la mano
    // cuelga el hilo para siempre.
    let (holder, case_name): (i64, String) = {
        let c = app.store.conn();
        let holder: i64 = c
            .query_row("SELECT user_id FROM case_locks WHERE case_id = ?1", [id], |r| r.get(0))
            .map_err(|_| err(StatusCode::CONFLICT, "no hay nadie dentro de este caso ahora mismo"))?;
        c.execute("DELETE FROM case_locks WHERE case_id = ?1", [id])
            .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;
        let case_name: String =
            c.query_row("SELECT name FROM cases WHERE id = ?1", [id], |r| r.get(0)).unwrap_or_default();
        (holder, case_name)
    };
    tracing::info!("caso #{id} ({case_name}): usuario {holder} expulsado del candado por el usuario {uid}");
    app.queue.difundir(lumi_proto::api::Cambio::Expulsion { user_id: holder, case_id: id, case_name });
    difundir_caso_libre(&app, pid, id);
    Ok(StatusCode::NO_CONTENT)
}

/// Nadie libera un candado de caso si cierra el portátil de golpe o pierde
/// la red -- sin este barrido, `caso_liberar_s` sería un número que nadie
/// aplica (spec Darkroom Parte 3, punto 2). Mismo patrón que
/// `telemetry::muestrear_historial`: un bucle con su propio `sleep`, sin
/// plazo fijo en el código -- lo decide el administrador
/// (`routes::colaboracion::caso_liberar_s`) y puede cambiar en caliente.
pub async fn barrer_candados_caducados(app: App) {
    loop {
        // El ajuste, antes de la conexión: `get_meta` pide el mismo mutex.
        let limite = crate::routes::colaboracion::caso_liberar_s(&app);
        let ahora = now();
        let caducados: Vec<(i64, i64)> = {
            let c = app.store.conn();
            let filas: Vec<(i64, i64)> = c
                .prepare("SELECT cl.case_id, k.project_id FROM case_locks cl JOIN cases k ON k.id = cl.case_id WHERE ?1 - cl.since >= ?2")
                .and_then(|mut q| {
                    q.query_map(rusqlite::params![ahora, limite], |r| Ok((r.get(0)?, r.get(1)?)))
                        .map(|rows| rows.flatten().collect())
                })
                .unwrap_or_default();
            if !filas.is_empty() {
                let _ = c.execute("DELETE FROM case_locks WHERE ?1 - since >= ?2", rusqlite::params![ahora, limite]);
            }
            filas
        };
        for (case_id, project_id) in &caducados {
            tracing::info!("caso #{case_id}: candado liberado por inactividad ({limite}s)");
            difundir_caso_libre(&app, *project_id, *case_id);
        }
        tokio::time::sleep(std::time::Duration::from_secs(60)).await;
    }
}

/// Los miembros del proyecto de un caso, para avisarles por SSE que quedó
/// libre. `app.queue.difundir` reparte un único `Cambio` a todos los
/// suscriptores conectados; `Cambio::para` decide a quién le llega.
fn difundir_caso_libre(app: &App, project_id: i64, case_id: i64) {
    let miembros: Vec<i64> = {
        let c = app.store.conn();
        c.prepare("SELECT user_id FROM project_members WHERE project_id = ?1 AND status = 'accepted'")
            .and_then(|mut q| q.query_map([project_id], |r| r.get::<_, i64>(0)).map(|rows| rows.flatten().collect()))
            .unwrap_or_default()
    };
    if miembros.is_empty() {
        return;
    }
    app.queue.difundir(lumi_proto::api::Cambio::CasoLibre { miembros, case_id });
}
