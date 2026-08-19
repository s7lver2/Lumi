//! GET/PATCH de la sección Hardware. La lógica de rango/escritura vive en
//! `crate::hardware`; aquí solo se autentica y se traduce a HTTP.

use crate::routes::auth::{bearer, require_admin};
use crate::App;
use axum::extract::{Path, State};
use axum::{http::HeaderMap, http::StatusCode, Json};
use lumi_proto::api::{HardwareDevice, PatchHardwareReq};

pub async fn listar(State(app): State<App>, headers: HeaderMap) -> Result<Json<Vec<HardwareDevice>>, StatusCode> {
    require_admin(&app, &bearer(&headers))?;
    // `dispositivos` inicializa NVML y hace llamadas nativas síncronas —
    // nada de esto es async de verdad. Ejecutarlo inline bloqueaba el hilo
    // del runtime que le tocara: con pocos hilos (p.ej. 2 CPUs en una VM),
    // un par de peticiones concurrentes a esta ruta bastaban para dejar sin
    // hilos libres al runtime entero — el mismo síntoma que el freeze de
    // login ya arreglado esta sesión, aquí con otra causa. `spawn_blocking`
    // lo manda al pool dedicado para trabajo bloqueante, que no compite con
    // el accept loop ni con el resto de peticiones.
    let dispositivos = tokio::task::spawn_blocking(move || crate::hardware::dispositivos(&app))
        .await
        .unwrap_or_default();
    Ok(Json(dispositivos))
}

pub async fn aplicar(
    State(app): State<App>,
    headers: HeaderMap,
    Path(index): Path<u32>,
    Json(req): Json<PatchHardwareReq>,
) -> Result<Json<HardwareDevice>, (StatusCode, String)> {
    require_admin(&app, &bearer(&headers)).map_err(|c| (c, "hace falta ser administrador".to_string()))?;
    match crate::hardware::aplicar(&app, index, &req).await {
        Ok(dev) => Ok(Json(dev)),
        Err(crate::hardware::AplicarError::FueraDeRango(motivo)) => Err((StatusCode::CONFLICT, motivo)),
        Err(crate::hardware::AplicarError::Nvml(e)) => Err((StatusCode::INTERNAL_SERVER_ERROR, e)),
        Err(crate::hardware::AplicarError::Curvas(e)) => Err((StatusCode::INTERNAL_SERVER_ERROR, e)),
    }
}
