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
            yield Ok(Event::default().data(quitar_ansi(&linea)));
        }
    };
    Ok(Sse::new(stream).keep_alive(KeepAlive::default()))
}

/// Líneas escritas antes de que `main.rs` desactivara `with_ansi` siguen
/// teniendo códigos de escape de color incrustados en el propio `journal` —
/// eso no se puede arreglar retroactivamente en el log ya escrito, así que se
/// limpia aquí, en el único sitio por el que pasa toda línea camino al panel.
fn quitar_ansi(linea: &str) -> String {
    let mut limpio = String::with_capacity(linea.len());
    let mut chars = linea.chars();
    while let Some(c) = chars.next() {
        if c == '\u{1b}' {
            // Secuencia CSI: ESC '[' ... byte final entre 0x40 y 0x7E. Se
            // consume entera y no se copia nada de ella.
            if chars.clone().next() == Some('[') {
                chars.next();
                for c2 in chars.by_ref() {
                    if ('\u{40}'..='\u{7e}').contains(&c2) {
                        break;
                    }
                }
            }
            continue;
        }
        limpio.push(c);
    }
    limpio
}
