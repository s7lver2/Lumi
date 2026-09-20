//! Los tres interruptores del spec 2026-09-10 (editor pre-subida, panel
//! Media, debug de calibración) más
//! `progreso_detallado_activo`, que llegó después por el mismo hueco:
//! `upscaler_activo`, `media_por_proyecto_activo`, `modo_calibracion`,
//! `progreso_detallado_activo`. Mismo patrón exacto que `routes::rendimiento`:
//! clave en `Store`, sin tabla nueva, `GET`/`PATCH` protegidos por
//! `require_admin`, descripción legible del estado actual. Los cuatro nacen
//! APAGADOS — a diferencia de `limpieza_por_presion` en `rendimiento.rs`,
//! ninguno de estos es un modo que el owner quiera encendido de fábrica.

use crate::routes::auth::{bearer, require_admin};
use crate::App;
use axum::extract::State;
use axum::{http::HeaderMap, http::StatusCode, Json};
use lumi_proto::api::{FeatureFlags, PatchFeatureFlagsReq};

pub(crate) const CLAVE_UPSCALER: &str = "upscaler_activo";
pub(crate) const CLAVE_MEDIA_PROYECTO: &str = "media_por_proyecto_activo";
pub(crate) const CLAVE_CALIBRACION: &str = "modo_calibracion";
/// Cuarto interruptor, más reciente que los tres del spec 2026-09-10: fases
/// del pipeline (recuperando/verificando) + tiempo estimado durante un
/// análisis (`queue::notificar_fase`). Mismo criterio que los otros tres:
/// eventos de más por análisis que el owner puede no querer pagar nunca.
pub(crate) const CLAVE_PROGRESO_DETALLADO: &str = "progreso_detallado_activo";

const DESC_UPSCALER_ON: &str = "activado: el editor pre-subida ofrece «Mejorar calidad», que encola un upscale real de IA en la cola de trabajos.";
const DESC_UPSCALER_OFF: &str = "desactivado: el botón de mejorar calidad no aparece en el editor -- no hay nada capado que explicar, es una función que este servidor aún no ha encendido.";

const DESC_MEDIA_ON: &str = "activado: el panel Media gana un selector «Este caso / Todo el proyecto» en su cabecera.";
const DESC_MEDIA_OFF: &str = "desactivado: el panel Media solo enseña las imágenes del caso actual, sin selector de modo.";

const DESC_CALIBRACION_ON: &str = "activado: el panel admin gana la sección «Calibración» (umbrales de verificación, respuesta cruda del modelo, forzar motor/dispositivo).";
const DESC_CALIBRACION_OFF: &str = "desactivado: ninguna de las tres herramientas de calibración es visible ni tiene efecto, ni para el propio administrador.";

const DESC_PROGRESO_ON: &str = "activado: mientras se analiza una imagen, el cliente enseña en qué fase va (recuperando, verificando) y un tiempo estimado según la media de análisis recientes.";
const DESC_PROGRESO_OFF: &str = "desactivado: el cliente solo sabe que un análisis está «procesando», sin fases ni estimación -- comportamiento de siempre.";

fn leer(app: &App, clave: &str) -> bool {
    app.store.get_meta(clave).as_deref() == Some("1")
}

/// Lee el flag directamente sobre un `Store` -- para los sitios que no
/// tienen un `App` a mano (p.ej. `queue::Queue`, que decide si un
/// `forzar_motor` cuenta o se ignora).
pub(crate) fn activo(store: &crate::store::Store, clave: &str) -> bool {
    store.get_meta(clave).as_deref() == Some("1")
}

fn settings(app: &App) -> FeatureFlags {
    let upscaler_activo = leer(app, CLAVE_UPSCALER);
    let media_por_proyecto_activo = leer(app, CLAVE_MEDIA_PROYECTO);
    let modo_calibracion = leer(app, CLAVE_CALIBRACION);
    let progreso_detallado_activo = leer(app, CLAVE_PROGRESO_DETALLADO);
    FeatureFlags {
        upscaler_activo,
        upscaler_activo_desc: if upscaler_activo { DESC_UPSCALER_ON.into() } else { DESC_UPSCALER_OFF.into() },
        media_por_proyecto_activo,
        media_por_proyecto_activo_desc: if media_por_proyecto_activo { DESC_MEDIA_ON.into() } else { DESC_MEDIA_OFF.into() },
        modo_calibracion,
        modo_calibracion_desc: if modo_calibracion { DESC_CALIBRACION_ON.into() } else { DESC_CALIBRACION_OFF.into() },
        progreso_detallado_activo,
        progreso_detallado_activo_desc: if progreso_detallado_activo { DESC_PROGRESO_ON.into() } else { DESC_PROGRESO_OFF.into() },
    }
}

pub async fn get(State(app): State<App>, headers: HeaderMap) -> Result<Json<FeatureFlags>, StatusCode> {
    require_admin(&app, &bearer(&headers))?;
    Ok(Json(settings(&app)))
}

/// A diferencia de `rendimiento::patch`, esta ruta la lee además cualquier
/// sesión válida a través de `/v1/features` (ver `get_public`) -- el cliente
/// necesita saber si el botón de upscaler o el selector de proyecto de Media
/// deben pintarse, y eso no es información administrativa: es la misma
/// lógica que ya sigue el capability matrix (nunca oculto tras un endpoint
/// solo-admin lo que decide qué se pinta para todos).
pub async fn get_public(
    State(app): State<App>,
    headers: HeaderMap,
) -> Result<Json<FeatureFlags>, StatusCode> {
    crate::routes::auth::require_session(&app, &bearer(&headers)).map_err(|_| StatusCode::UNAUTHORIZED)?;
    Ok(Json(settings(&app)))
}

pub async fn patch(
    State(app): State<App>,
    headers: HeaderMap,
    Json(req): Json<PatchFeatureFlagsReq>,
) -> Result<Json<FeatureFlags>, StatusCode> {
    let admin = require_admin(&app, &bearer(&headers))?;
    if let Some(v) = req.upscaler_activo {
        app.store.set_meta(CLAVE_UPSCALER, if v { "1" } else { "0" }).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        tracing::info!("upscaler {} por el administrador {admin}", if v { "activado" } else { "desactivado" });
    }
    if let Some(v) = req.media_por_proyecto_activo {
        app.store.set_meta(CLAVE_MEDIA_PROYECTO, if v { "1" } else { "0" }).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        tracing::info!("media por proyecto {} por el administrador {admin}", if v { "activado" } else { "desactivado" });
    }
    if let Some(v) = req.modo_calibracion {
        app.store.set_meta(CLAVE_CALIBRACION, if v { "1" } else { "0" }).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        tracing::info!("modo calibración {} por el administrador {admin}", if v { "activado" } else { "desactivado" });
    }
    if let Some(v) = req.progreso_detallado_activo {
        app.store.set_meta(CLAVE_PROGRESO_DETALLADO, if v { "1" } else { "0" }).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        tracing::info!("progreso detallado {} por el administrador {admin}", if v { "activado" } else { "desactivado" });
    }
    Ok(Json(settings(&app)))
}
