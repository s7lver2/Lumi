//! Mismo patrón que `comprobar_actualizacion` en cliente/Indexer
//! (`client/src-tauri/src/main.rs`, `indexer/src-tauri/src/actualizacion.rs`):
//! la URL está duplicada a propósito, es configuración de red de cada
//! binario, no protocolo compartido.

use lumi_proto::actualizacion::Manifiesto;

use crate::error::InstaladorError;

const VERSIONES_URL: &str = "https://lumi.s7lver.xyz/api/versiones";

pub fn obtener_verificado() -> Result<Manifiesto, InstaladorError> {
    let manifiesto: Manifiesto = reqwest::blocking::get(VERSIONES_URL)
        .map_err(|e| InstaladorError::Red(e.to_string()))?
        .json()
        .map_err(|e| InstaladorError::Red(e.to_string()))?;
    manifiesto
        .comprobar()
        .map_err(|e| InstaladorError::Manifiesto(e.to_string()))?;
    Ok(manifiesto)
}
