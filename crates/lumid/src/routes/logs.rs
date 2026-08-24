//! Reenvía `journalctl -u lumid -f` línea a línea por SSE, sin interpretar
//! nada del lado del servidor — el nivel y el módulo se leen en el cliente.
//! Ver `docs/superpowers/specs/2026-08-21-doctor-design.md`.

use crate::routes::auth::{bearer, require_admin};
use crate::App;
use axum::extract::State;
use axum::http::HeaderMap;
use axum::response::sse::{Event, KeepAlive, Sse};
use futures::stream::Stream;
use std::convert::Infallible;
use std::process::Stdio;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

pub async fn stream(
    State(app): State<App>, headers: HeaderMap,
) -> Result<Sse<impl Stream<Item = Result<Event, Infallible>>>, axum::http::StatusCode> {
    require_admin(&app, &bearer(&headers))?;

    let hijo = Command::new("journalctl")
        .args(["-u", "lumid", "-n", "300", "-f", "-o", "cat", "--no-pager"])
        .stdout(Stdio::piped())
        // Si el cliente cierra el SSE, este proceso muere con él en vez de
        // quedarse leyendo el log para siempre sin nadie escuchando.
        .kill_on_drop(true)
        .spawn();

    let stream = async_stream::stream! {
        let Ok(mut hijo) = hijo else {
            yield Ok(Event::default().event("error").data("journalctl no está disponible en este sistema"));
            return;
        };
        let Some(salida) = hijo.stdout.take() else {
            yield Ok(Event::default().event("error").data("no se pudo leer la salida de journalctl"));
            return;
        };
        let mut lineas = BufReader::new(salida).lines();
        while let Ok(Some(linea)) = lineas.next_line().await {
            yield Ok(Event::default().data(linea));
        }
    };
    Ok(Sse::new(stream).keep_alive(KeepAlive::default()))
}
