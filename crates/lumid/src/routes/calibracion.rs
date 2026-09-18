//! Las herramientas de debug de calibración (spec 2026-09-10 §4a), detrás de
//! `modo_calibracion` (`routes::features`): con el interruptor apagado, cada
//! ruta de aquí contesta 403 con el mismo motivo, tanto para leer como para
//! escribir -- no es una función capada con explicación en la UI, es tooling
//! que este servidor no ha montado, y eso se cumple también en la API y no
//! solo escondiendo el botón.
//!
//! Umbrales de verificación: un override en `Store` (clave meta), con
//! fallback al JSON del registro. El override es por-servidor, nunca se
//! escribe de vuelta al fichero ni se propaga a otra instalación (ver el
//! comentario de `verificar::construir_afinados`, que es quien de verdad LEE
//! el override de umbrales en el camino caliente).
//!
//! El editor de prompts de agentes (4b) que vivía aquí se retira en el
//! rediseño de 2026-09-17: nadie leía el override que guardaba (ni la cola,
//! que relee las fichas del disco, ni `workers/lumi_agentes.py`, que lee
//! `registros/agentes/` directamente) -- calibrar un agente ahora es editar
//! su JSON en el registro y reiniciar `lumid`, spec §9 ("las fichas siguen
//! siendo datos... esta vez de verdad").

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

/// Solo lo que el picker del panel necesita: elegir por nombre, no por id
/// tecleado a ciegas, y ver de un vistazo cuáles ya tienen un override
/// guardado en este servidor. Los 7 verificadores del registro caben en una
/// sola lista sin paginar.
#[derive(serde::Serialize)]
pub struct VerificadorVista {
    pub id: String,
    pub nombre: String,
    pub tipo: String,
    pub overridden: bool,
}

pub async fn listar_verificadores(
    State(app): State<App>,
    headers: HeaderMap,
) -> Result<Json<Vec<VerificadorVista>>, Fail> {
    require_admin(&app, &bearer(&headers)).map_err(|c| (c, "sesión inválida".into()))?;
    requiere_calibracion(&app)?;
    let fuera = app
        .queue
        .verificadores
        .lock()
        .unwrap()
        .iter()
        .map(|v| VerificadorVista {
            overridden: app.store.get_meta(&clave_umbral(&v.id)).is_some(),
            id: v.id.clone(),
            nombre: v.nombre.clone(),
            tipo: v.tipo.clone(),
        })
        .collect();
    Ok(Json(fuera))
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

