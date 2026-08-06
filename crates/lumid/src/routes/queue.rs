//! El canal por el que el cliente se entera de sus resultados.
//!
//! Y, de paso, la presencia: mientras este flujo está abierto, su dueño cuenta
//! como conectado. No hace falta ni una ventana heurística sobre `last_seen` ni
//! una escritura por petición — que es justo lo que el subsistema 2 rechazó a
//! propósito al documentar `require_session`.

use crate::routes::auth::{bearer, require_admin, require_session};
use crate::App;
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::Json;
use futures::stream::Stream;
use lumi_proto::api::QueueView;
use std::convert::Infallible;
use tokio::sync::broadcast::error::RecvError;

pub async fn events(
    State(app): State<App>,
    headers: HeaderMap,
) -> Result<Sse<impl Stream<Item = Result<Event, Infallible>>>, StatusCode> {
    let (uid, _) = require_session(&app, &bearer(&headers))?;
    let mut rx = app.queue.suscribir();
    let presencia = app.queue.entra(uid);

    let stream = async_stream::stream! {
        // La presencia se suelta exactamente cuando este flujo se cierra, sea
        // porque cerró la app o porque se cayó la red. No hay nada que limpiar
        // a mano ni un temporizador que pueda quedarse corto o largo.
        let _presencia = presencia;
        loop {
            match rx.recv().await {
                Ok(c) if c.user_id() == uid => {
                    yield Ok(Event::default().json_data(&c).unwrap_or_default());
                }
                Ok(_) => {}
                // Un cliente lento se pierde eventos antiguos y sigue con los
                // nuevos. Cortarle el flujo por ir tarde sería peor: perdería
                // también la presencia.
                Err(RecvError::Lagged(_)) => {}
                Err(RecvError::Closed) => break,
            }
        }
    };
    // El latido importa aquí más que en ningún otro sitio: un proxy que corte
    // conexiones inactivas haría que alguien delante de la pantalla pareciera
    // desconectado y le pausaría su propio trabajo.
    Ok(Sse::new(stream).keep_alive(KeepAlive::default()))
}

pub async fn view(
    State(app): State<App>,
    headers: HeaderMap,
) -> Result<Json<QueueView>, StatusCode> {
    require_admin(&app, &bearer(&headers))?;
    Ok(Json(app.queue.foto()))
}
