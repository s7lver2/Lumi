use crate::routes::auth::{bearer, require_session};
use crate::{telemetry, App};
use axum::extract::State;
use axum::http::HeaderMap;
use axum::response::sse::{Event, KeepAlive, Sse};
use futures::stream::Stream;
use std::convert::Infallible;
use std::time::Duration;

pub async fn sse(State(app): State<App>, headers: HeaderMap) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    // Se resuelve UNA VEZ, no en cada muestra: quién es esta conexión no
    // cambia mientras el stream sigue abierto. `None` (sin token, o token
    // caducado) no rompe la telemetría — solo deja `avisos` vacío, el resto
    // de la muestra (GPU, cola, mantenimiento) sigue sin depender de esto,
    // igual que en `LOCKED`.
    let visto_por = require_session(&app, &bearer(&headers)).ok();
    let stream = async_stream::stream! {
        loop {
            let s = telemetry::sample(&app, visto_por);
            yield Ok(Event::default().json_data(&s).unwrap_or_default());
            tokio::time::sleep(Duration::from_secs(1)).await;
        }
    };
    Sse::new(stream).keep_alive(KeepAlive::default())
}
