//! El log se sirve por SSE desde un offset. El cliente que se reengancha
//! manda `?from=<bytes>` y recibe solo lo que se perdió, no el log entero.

use crate::{routes::auth::{bearer, require_admin}, tasks, App};
use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::sse::{Event, Sse};
use axum::Json;
use futures::stream::Stream;
use lumi_proto::api::{TaskSpec, TaskStatus};
use serde::Deserialize;
use std::convert::Infallible;
use std::io::{Read, Seek, SeekFrom};
use std::time::Duration;

pub async fn create(
    State(app): State<App>,
    headers: HeaderMap,
    Json(spec): Json<TaskSpec>,
) -> Result<Json<TaskStatus>, StatusCode> {
    require_admin(&app, &bearer(&headers))?;
    let id = tasks::spawn(&app, spec.kind).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    tracing::info!("tarea de aprovisionamiento lanzada: {:?} ({id})", spec.kind);
    tasks::status(&app, &id).map(Json).ok_or(StatusCode::INTERNAL_SERVER_ERROR)
}

// Sin autenticación aquí, este bug ya viajó a producción una vez: cualquiera
// que llegase al daemon podía leer el estado y el log de una tarea sin
// token. El aprovisionamiento es cosa de administradores, igual que crearla.
pub async fn get(
    State(app): State<App>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<TaskStatus>, StatusCode> {
    require_admin(&app, &bearer(&headers))?;
    tasks::status(&app, &id).map(Json).ok_or(StatusCode::NOT_FOUND)
}

#[derive(Deserialize)]
pub struct From {
    #[serde(default)]
    from: u64,
}

pub async fn log_sse(
    State(app): State<App>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Query(q): Query<From>,
) -> Result<Sse<impl Stream<Item = Result<Event, Infallible>>>, StatusCode> {
    require_admin(&app, &bearer(&headers))?;
    let path = tasks::log_path(&app.dir, &id);
    let mut offset = q.from;
    let stream = async_stream::stream! {
        loop {
            let mut buf = String::new();
            if let Ok(mut f) = std::fs::File::open(&path) {
                if f.seek(SeekFrom::Start(offset)).is_ok() {
                    let n = f.read_to_string(&mut buf).unwrap_or(0);
                    offset += n as u64;
                }
            }
            if !buf.is_empty() {
                // El id del evento es el offset: si el cliente se cae, vuelve
                // con ese número y no pierde ni repite una línea.
                yield Ok(Event::default().id(offset.to_string()).data(buf));
            }
            tokio::time::sleep(Duration::from_millis(400)).await;
        }
    };
    Ok(Sse::new(stream).keep_alive(axum::response::sse::KeepAlive::default()))
}
