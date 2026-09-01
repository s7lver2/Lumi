//! Mismo patrón que `comprobar_actualizacion` en cliente/Indexer
//! (`client/src-tauri/src/main.rs`, `indexer/src-tauri/src/actualizacion.rs`):
//! la URL está duplicada a propósito, es configuración de red de cada
//! binario, no protocolo compartido.

use lumi_proto::actualizacion::Manifiesto;

use crate::error::InstaladorError;

const VERSIONES_URL: &str = "https://lumi.s7lver.xyz/api/versiones";

pub fn obtener_verificado() -> Result<Manifiesto, InstaladorError> {
    // Sin tope, una red lenta o caída a medias podía dejar esta llamada
    // colgada indefinidamente — 5s es de sobra para una respuesta JSON de
    // unos pocos KB, y falla rápido y con un motivo claro si no llega.
    let cliente = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .map_err(|e| InstaladorError::Red(e.to_string()))?;
    let manifiesto: Manifiesto = cliente
        .get(VERSIONES_URL)
        .send()
        .map_err(|e| InstaladorError::Red(e.to_string()))?
        .json()
        .map_err(|e| InstaladorError::Red(e.to_string()))?;
    manifiesto
        .comprobar()
        .map_err(|e| InstaladorError::Manifiesto(e.to_string()))?;
    Ok(manifiesto)
}
