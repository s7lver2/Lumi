//! Comprobación de versión nueva contra el canal de actualizaciones — ver
//! `crates/lumi-proto/src/actualizacion.rs` para el formato y la firma.
//! Independiente de Lumi: el Indexer se publica y se comprueba aparte.

use lumi_proto::actualizacion::{Manifiesto, Producto};

/// Misma URL que el cliente (`client/src-tauri/src/main.rs`) — duplicada a
/// propósito, no compartida por una constante en `lumi-proto`, porque es
/// configuración de red de cada app, no parte del protocolo.
const VERSIONES_URL: &str = "https://lumi-web.vercel.app/api/versiones";

#[derive(serde::Serialize)]
#[serde(tag = "tipo", rename_all = "lowercase")]
pub enum EstadoActualizacion {
    Disponible { version: String, notas: String, url: String },
    Retirada,
}

/// `Err` = no se pudo comprobar (sin red, sin firma o firma inválida); el
/// lado TS no pinta nada ante un error. `Ok(None)` = se comprobó y no hay
/// nada nuevo que ofrecer.
pub async fn comprobar() -> Result<Option<EstadoActualizacion>, String> {
    let manifiesto: Manifiesto = reqwest::Client::new()
        .get(VERSIONES_URL)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;
    manifiesto.comprobar().map_err(|e| e.to_string())?;

    let version_actual = env!("CARGO_PKG_VERSION");
    if manifiesto.version_retirada(Producto::Indexer, version_actual) {
        return Ok(Some(EstadoActualizacion::Retirada));
    }
    let Some(publi) = manifiesto.mas_nueva(Producto::Indexer, version_actual, "windows-x86_64") else {
        return Ok(None);
    };
    let url = publi
        .artefactos
        .iter()
        .find(|a| a.plataforma == "windows-x86_64")
        .map(|a| a.url.clone())
        .unwrap_or_default();
    Ok(Some(EstadoActualizacion::Disponible {
        version: publi.version.clone(),
        notas: publi.notas.clone(),
        url,
    }))
}
