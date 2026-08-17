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
        capabilities: {
            let hw = crate::hardware::capacidades().await;
            let (cpu_intel, cpu_intel_reason, cpu_amd, cpu_amd_reason, cpu_temp, cpu_temp_reason) =
                crate::hardware_cpu::capacidades().await;
            lumi_proto::caps::matrix(
                app.mode,
                app.gpus.len(),
                qdrant_vivo,
                &lumi_proto::caps::HardwareCaps {
                    cpu_potencia_intel: cpu_intel,
                    cpu_potencia_intel_reason: cpu_intel_reason,
                    cpu_potencia_amd: cpu_amd,
                    cpu_potencia_amd_reason: cpu_amd_reason,
                    cpu_temperatura: cpu_temp,
                    cpu_temperatura_reason: cpu_temp_reason,
                    ..hw
                },
            )
        },
        gpus: app.gpus.clone(),
    })
}
