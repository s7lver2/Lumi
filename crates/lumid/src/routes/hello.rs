//! Lo primero que lee el cliente, antes de confiar en nada. Sin
//! autenticación, y disponible también con la clave maestra bloqueada.

use crate::App;
use axum::{extract::State, Json};
use lumi_proto::api::Hello;

pub async fn get(State(app): State<App>) -> Json<Hello> {
    // Timeout corto (dentro de `Cliente::vivo`): esto es lo primero que pide
    // el cliente al conectar, y una red que no llega a Qdrant no puede
    // colgarlo.
    let qdrant_vivo = crate::qdrant::Cliente::nuevo().vivo().await;
    Json(Hello {
        version: env!("CARGO_PKG_VERSION").into(),
        state: app.store.state(),
        mode: app.mode,
        locked: app.master.read().await.is_none(),
        fingerprint: app.fingerprint.clone(),
        capabilities: lumi_proto::caps::matrix(
            app.mode,
            app.gpus.len(),
            qdrant_vivo,
            &crate::hardware::capacidades().await,
        ),
        gpus: app.gpus.clone(),
    })
}
