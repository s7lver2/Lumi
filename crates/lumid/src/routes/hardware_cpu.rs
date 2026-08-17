//! GET/PATCH de la CPU dentro de Hardware. Misma forma que
//! `routes::hardware` para GPU: autentica aquí, la lógica vive en
//! `crate::hardware_cpu`.

use crate::routes::auth::{bearer, require_admin};
use crate::App;
use axum::extract::State;
use axum::{http::HeaderMap, http::StatusCode, Json};
use lumi_proto::api::{CpuDevice, PatchCpuReq};

pub async fn leer(State(app): State<App>, headers: HeaderMap) -> Result<Json<CpuDevice>, StatusCode> {
    require_admin(&app, &bearer(&headers))?;
    Ok(Json(crate::hardware_cpu::dispositivo(&app)))
}

pub async fn aplicar(
    State(app): State<App>,
    headers: HeaderMap,
    Json(req): Json<PatchCpuReq>,
) -> Result<Json<CpuDevice>, (StatusCode, String)> {
    require_admin(&app, &bearer(&headers)).map_err(|c| (c, "hace falta ser administrador".to_string()))?;
    match crate::hardware_cpu::aplicar(&app, &req).await {
        Ok(dev) => Ok(Json(dev)),
        Err(crate::hardware_cpu::AplicarCpuError::FueraDeRango(m)) => Err((StatusCode::CONFLICT, m)),
        Err(crate::hardware_cpu::AplicarCpuError::Escritura(m)) => Err((StatusCode::INTERNAL_SERVER_ERROR, m)),
    }
}
