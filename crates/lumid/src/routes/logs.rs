//! Reenvía `journalctl -u lumid -f` línea a línea por SSE, sin interpretar
//! nada del lado del servidor — el nivel y el módulo se leen en el cliente.
//! Ver `docs/superpowers/specs/2026-08-21-doctor-design.md`.

use crate::routes::auth::{bearer, require_admin};
use crate::App;
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::Json;
use futures::stream::Stream;
use lumi_proto::api::{LogCategoria, LogSettings, PatchLogSettingsReq};
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

fn vista(app: &App) -> LogSettings {
    let base = crate::logging::nivel_base(&app.store);
    let categorias = crate::logging::CATEGORIAS
        .iter()
        .map(|c| LogCategoria {
            id: c.id.to_string(),
            label: c.label.to_string(),
            nivel: crate::logging::nivel_de(&app.store, c.id, &base),
        })
        .collect();
    LogSettings {
        base,
        categorias,
        niveles: crate::logging::NIVELES.iter().map(|s| s.to_string()).collect(),
    }
}

pub async fn ajustes_get(
    State(app): State<App>, headers: HeaderMap,
) -> Result<Json<LogSettings>, StatusCode> {
    require_admin(&app, &bearer(&headers))?;
    Ok(Json(vista(&app)))
}

pub async fn ajustes_patch(
    State(app): State<App>, headers: HeaderMap, Json(req): Json<PatchLogSettingsReq>,
) -> Result<Json<LogSettings>, (StatusCode, String)> {
    let admin = require_admin(&app, &bearer(&headers)).map_err(|c| (c, "hace falta ser administrador".to_string()))?;
    let bad = |m: &str| (StatusCode::BAD_REQUEST, m.to_string());

    if let Some(nivel) = &req.base {
        if !crate::logging::NIVELES.contains(&nivel.as_str()) {
            return Err(bad("nivel base desconocido"));
        }
        crate::logging::set_nivel_base(&app.store, nivel).map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    }
    if let Some(categorias) = &req.categorias {
        for (id, nivel) in categorias {
            if !crate::logging::CATEGORIAS.iter().any(|c| c.id == id) {
                return Err(bad(&format!("categoría desconocida: {id}")));
            }
            if !crate::logging::NIVELES.contains(&nivel.as_str()) {
                return Err(bad(&format!("nivel desconocido para {id}: {nivel}")));
            }
            crate::logging::set_nivel_categoria(&app.store, id, nivel)
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        }
    }

    let filtro = crate::logging::construir_filtro(&app.store);
    app.log_filter
        .reload(tracing_subscriber::EnvFilter::new(&filtro))
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    tracing::info!("el administrador {admin} cambió el nivel de log: {filtro}");
    Ok(Json(vista(&app)))
}
