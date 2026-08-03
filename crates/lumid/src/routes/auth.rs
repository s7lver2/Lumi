use crate::{master, App};
use axum::{extract::State, http::StatusCode, Json};
use lumi_proto::api::UnsealReq;

/// Desbloquea la maestra y reanuda la cola. En este subsistema la cola aún no
/// existe; el subsistema 4 engancha aquí su reanudación.
pub async fn unseal(
    State(app): State<App>,
    Json(req): Json<UnsealReq>,
) -> Result<StatusCode, (StatusCode, String)> {
    if app.master.read().await.is_some() {
        return Ok(StatusCode::NO_CONTENT);
    }
    let mk = master::unseal(&app.dir, &req.passphrase)
        .map_err(|e| (StatusCode::UNAUTHORIZED, e.to_string()))?;
    *app.master.write().await = Some(mk);
    tracing::info!("clave maestra desbloqueada");
    Ok(StatusCode::NO_CONTENT)
}
