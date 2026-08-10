//! Instalar, listar y desinstalar índices. Todo pide administrador: instalar
//! gasta disco y ancho de banda del servidor, así que es una decisión de
//! administración y no de investigación.

use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::Json;
use futures::stream::Stream;
use serde::{Deserialize, Serialize};
use std::convert::Infallible;

use crate::routes::auth::{bearer, require_admin};
use crate::App;

#[derive(Deserialize)]
pub struct Peticion {
    pub url: String,
}

#[derive(Serialize)]
pub struct Instalado {
    pub paquete: String,
    pub nombre: String,
    pub autor: String,
    pub teselas: i64,
    pub bytes: i64,
    pub modelo: String,
    pub version: String,
    pub completo: bool,
}

pub async fn instalar(
    State(app): State<App>,
    headers: HeaderMap,
    Json(p): Json<Peticion>,
) -> Result<StatusCode, StatusCode> {
    require_admin(&app, &bearer(&headers))?;
    if app.indices_en_curso.lock().unwrap().as_ref().is_some_and(|p| !p.terminado) {
        // Un solo hueco a propósito: dos instalaciones contra el mismo disco
        // y la misma red no van más rápido, van peor.
        return Err(StatusCode::CONFLICT);
    }
    let a = app.clone();
    tokio::spawn(async move {
        if let Err(e) = crate::indices::instalar(a.clone(), p.url).await {
            if let Some(g) = a.indices_en_curso.lock().unwrap().as_mut() {
                g.error = Some(e.to_string());
                g.terminado = true;
            }
        }
    });
    Ok(StatusCode::ACCEPTED)
}

/// El progreso no se persiste en ninguna parte (regla del subsistema 4): esto
/// solo reemite lo que ya vive en `app.indices_en_curso`, la misma variable
/// que el `POST` escribe. Al contrario que `routes::queue::events`, que
/// reemite un `broadcast::Receiver` de eventos ya ocurridos, aquí no hay un
/// canal de eventos — hay una única fotografía mutable, porque solo puede
/// haber una instalación en curso — así que el bucle sondea esa fotografía en
/// vez de recibir de un canal. El resto de la forma (SSE, keep-alive, cortar
/// al terminar) es la misma.
pub async fn eventos(
    State(app): State<App>,
    headers: HeaderMap,
) -> Result<Sse<impl Stream<Item = Result<Event, Infallible>>>, StatusCode> {
    require_admin(&app, &bearer(&headers))?;
    let stream = async_stream::stream! {
        let mut ultimo: Option<String> = None;
        loop {
            let (json, terminado) = {
                let g = app.indices_en_curso.lock().unwrap();
                match g.as_ref() {
                    Some(p) => (serde_json::to_string(p).unwrap_or_default(), p.terminado),
                    None => (String::new(), true),
                }
            };
            if !json.is_empty() && Some(&json) != ultimo.as_ref() {
                yield Ok(Event::default().data(json.clone()));
                ultimo = Some(json);
            }
            if terminado {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(400)).await;
        }
    };
    Ok(Sse::new(stream).keep_alive(KeepAlive::default()))
}

pub async fn listar(
    State(app): State<App>,
    headers: HeaderMap,
) -> Result<Json<Vec<Instalado>>, StatusCode> {
    require_admin(&app, &bearer(&headers))?;
    let c = app.store.conn();
    let mut q = c
        .prepare(
            "SELECT paquete, nombre, autor, teselas, bytes, modelo, version, completo
               FROM installed_indices ORDER BY installed_at DESC",
        )
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let filas = q
        .query_map([], |r| {
            Ok(Instalado {
                paquete: r.get(0)?,
                nombre: r.get(1)?,
                autor: r.get(2)?,
                teselas: r.get(3)?,
                bytes: r.get(4)?,
                modelo: r.get(5)?,
                version: r.get(6)?,
                completo: r.get::<_, i64>(7)? == 1,
            })
        })
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .flatten()
        .collect();
    Ok(Json(filas))
}

/// Se borra en este orden: puntos de Qdrant, filas de `reference_images`,
/// carpeta en disco, fila de `installed_indices`. Si se corta a mitad, lo
/// peor que queda es disco ocupado — nunca puntos que ya no se pueden
/// atribuir a nada.
pub async fn desinstalar(
    State(app): State<App>,
    Path(paquete): Path<String>,
    headers: HeaderMap,
) -> Result<StatusCode, StatusCode> {
    require_admin(&app, &bearer(&headers))?;

    let existe: bool = app
        .store
        .conn()
        .query_row("SELECT 1 FROM installed_indices WHERE paquete = ?1", [&paquete], |_| Ok(()))
        .is_ok();
    if !existe {
        return Err(StatusCode::NOT_FOUND);
    }

    let (modelo, version): (String, String) = app
        .store
        .conn()
        .query_row(
            "SELECT modelo, version FROM installed_indices WHERE paquete = ?1",
            [&paquete],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap_or_default();
    let ids: Vec<i64> = {
        let c = app.store.conn();
        let mut q = c
            .prepare("SELECT id FROM reference_images WHERE paquete = ?1")
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        let filas = q
            .query_map([&paquete], |r| r.get(0))
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
            .flatten()
            .collect();
        filas
    };

    if !ids.is_empty() && !modelo.is_empty() {
        let coleccion = crate::qdrant::coleccion_de(&modelo, &version);
        // Best effort: si Qdrant no responde, seguimos igual — dejar puntos
        // huérfanos en una colección es peor que dejarlos, pero un índice que
        // no se puede desinstalar nunca por una red caída sería peor todavía.
        let _ = crate::qdrant::Cliente::nuevo().borrar(&coleccion, &ids).await;
    }

    let c = app.store.conn();
    let _ = c.execute("DELETE FROM reference_images WHERE paquete = ?1", [&paquete]);
    drop(c);

    let carpeta = app.dir.join("indices").join(&paquete);
    let _ = std::fs::remove_dir_all(&carpeta);

    app.store
        .conn()
        .execute("DELETE FROM installed_indices WHERE paquete = ?1", [&paquete])
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(StatusCode::NO_CONTENT)
}
