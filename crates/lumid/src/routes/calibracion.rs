//! Las cuatro herramientas de debug de calibración (spec 2026-09-10 §4),
//! todas detrás de `modo_calibracion` (`routes::features`): con el
//! interruptor apagado, cada ruta de aquí contesta 403 con el mismo motivo,
//! tanto para leer como para escribir -- no es una función capada con
//! explicación en la UI, es tooling que este servidor no ha montado, y eso
//! se cumple también en la API y no solo escondiendo el botón.
//!
//! 4a (umbrales de verificación) y 4b (prompts de agentes) comparten el
//! mismo mecanismo: un override en `Store` (clave meta), con fallback al
//! JSON del registro. El override es por-servidor, nunca se escribe de
//! vuelta al fichero ni se propaga a otra instalación (ver el comentario de
//! `verificar::construir_afinados`, que es quien de verdad LEE el override
//! de umbrales en el camino caliente).

use crate::routes::auth::{bearer, require_admin};
use crate::routes::projects::{err, Fail};
use crate::App;
use axum::extract::{Path, State};
use axum::{http::StatusCode, http::HeaderMap, Json};

fn requiere_calibracion(app: &App) -> Result<(), Fail> {
    if app.store.get_meta(crate::routes::features::CLAVE_CALIBRACION).as_deref() != Some("1") {
        return Err(err(StatusCode::FORBIDDEN, "el modo de calibración no está activado en este servidor"));
    }
    Ok(())
}

fn clave_umbral(id: &str) -> String {
    format!("umbral_inliers:{id}")
}

#[derive(serde::Serialize)]
pub struct UmbralVista {
    pub verificador: String,
    /// El valor que de verdad se usa ahora mismo: el override si existe, si
    /// no el del JSON del registro, si no `UMBRAL_INLIERS`.
    pub umbral_inliers: u32,
    /// `true` cuando el valor de arriba viene de un `PATCH` guardado en
    /// `Store` y no del fichero del registro.
    pub overridden: bool,
}

#[derive(serde::Deserialize)]
pub struct PatchUmbralReq {
    /// `None` borra el override (vuelve al valor del JSON).
    pub umbral_inliers: Option<u32>,
}

pub async fn get_umbral(
    State(app): State<App>,
    Path(id): Path<String>,
    headers: HeaderMap,
) -> Result<Json<UmbralVista>, Fail> {
    require_admin(&app, &bearer(&headers)).map_err(|c| (c, "sesión inválida".into()))?;
    requiere_calibracion(&app)?;
    let de_json = app
        .queue
        .verificadores
        .lock()
        .unwrap()
        .iter()
        .find(|v| v.id == id)
        .and_then(|v| v.umbral_inliers)
        .unwrap_or(lumi_index::arbitro::UMBRAL_INLIERS);
    let overr = app.store.get_meta(&clave_umbral(&id)).and_then(|s| s.parse::<u32>().ok());
    Ok(Json(UmbralVista {
        verificador: id,
        umbral_inliers: overr.unwrap_or(de_json),
        overridden: overr.is_some(),
    }))
}

pub async fn patch_umbral(
    State(app): State<App>,
    Path(id): Path<String>,
    headers: HeaderMap,
    Json(req): Json<PatchUmbralReq>,
) -> Result<Json<UmbralVista>, Fail> {
    let admin = require_admin(&app, &bearer(&headers)).map_err(|c| (c, "sesión inválida".into()))?;
    requiere_calibracion(&app)?;
    match req.umbral_inliers {
        Some(v) => {
            app.store
                .set_meta(&clave_umbral(&id), &v.to_string())
                .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;
            tracing::info!("umbral_inliers de «{id}» fijado a {v} por el administrador {admin}");
        }
        None => {
            app.store
                .delete_meta(&clave_umbral(&id))
                .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;
            tracing::info!("umbral_inliers de «{id}» vuelto al valor del registro por el administrador {admin}");
        }
    }
    get_umbral(State(app), Path(id), headers).await
}

// --- 4b: prompts de agentes editables -------------------------------------

fn clave_agente(id: &str) -> String {
    format!("agente_override:{id}")
}

#[derive(serde::Serialize)]
pub struct AgenteVistaCalibracion {
    pub agente: lumi_index::agentes::Agente,
    pub overridden: bool,
}

/// El agente EFECTIVO ahora mismo: el override guardado en `Store`, si
/// existe y sigue deserializando contra el struct actual, si no el del
/// registro cargado en memoria (`app.queue.agentes`).
fn agente_efectivo(app: &App, id: &str) -> Option<(lumi_index::agentes::Agente, bool)> {
    let de_registro = app.queue.agentes.lock().unwrap().iter().find(|a| a.id == id).cloned()?;
    match app.store.get_meta(&clave_agente(id)) {
        Some(json) => match serde_json::from_str::<lumi_index::agentes::Agente>(&json) {
            Ok(a) => Some((a, true)),
            // Un override que ya no deserializa (struct cambiado entre
            // versiones) no debe tumbar el análisis: se cae al del registro,
            // igual que "el que no sabe no castiga" en `agentes::aplicar`.
            Err(_) => Some((de_registro, false)),
        },
        None => Some((de_registro, false)),
    }
}

pub async fn get_agente(
    State(app): State<App>,
    Path(id): Path<String>,
    headers: HeaderMap,
) -> Result<Json<AgenteVistaCalibracion>, Fail> {
    require_admin(&app, &bearer(&headers)).map_err(|c| (c, "sesión inválida".into()))?;
    requiere_calibracion(&app)?;
    let (agente, overridden) =
        agente_efectivo(&app, &id).ok_or_else(|| err(StatusCode::NOT_FOUND, "ese agente no existe en el registro"))?;
    Ok(Json(AgenteVistaCalibracion { agente, overridden }))
}

#[derive(serde::Deserialize)]
pub struct PatchAgenteReq {
    /// El `Agente` completo tal y como debe quedar -- no un parche parcial:
    /// así la validación (deserializar contra el struct de Rust) cubre el
    /// documento entero de una vez, y no hay forma de guardar una
    /// combinación de campos que nunca hubiera compuesto un JSON válido por
    /// su cuenta. `None` borra el override.
    pub agente: Option<lumi_index::agentes::Agente>,
}

pub async fn patch_agente(
    State(app): State<App>,
    Path(id): Path<String>,
    headers: HeaderMap,
    Json(req): Json<PatchAgenteReq>,
) -> Result<Json<AgenteVistaCalibracion>, Fail> {
    let admin = require_admin(&app, &bearer(&headers)).map_err(|c| (c, "sesión inválida".into()))?;
    requiere_calibracion(&app)?;
    if app.queue.agentes.lock().unwrap().iter().all(|a| a.id != id) {
        return Err(err(StatusCode::NOT_FOUND, "ese agente no existe en el registro"));
    }
    match req.agente {
        Some(a) => {
            if a.id != id {
                return Err(err(StatusCode::BAD_REQUEST, "el «id» del cuerpo no coincide con el de la URL"));
            }
            // La validación es el propio `Json(req)` de axum (ya deserializó
            // contra `Agente`) MÁS este re-serializado: si algún día
            // `Agente` gana un campo con un `Deserialize` permisivo que deja
            // pasar basura silenciosamente, guardar el JSON ya canónico
            // (recompuesto por Rust, no el que mandó el cliente) es lo que
            // impide que ese JSON crudo llegue nunca a `lumi_agentes.py`.
            let canonico = serde_json::to_string(&a).map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;
            app.store
                .set_meta(&clave_agente(&id), &canonico)
                .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;
            tracing::info!("prompt del agente «{id}» sobrescrito por el administrador {admin}");
        }
        None => {
            app.store
                .delete_meta(&clave_agente(&id))
                .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;
            tracing::info!("override del agente «{id}» borrado por el administrador {admin}");
        }
    }
    get_agente(State(app), Path(id), headers).await
}
