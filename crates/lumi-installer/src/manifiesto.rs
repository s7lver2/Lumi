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
    //
    // `local_address` fuerza IPv4: reqwest no implementa Happy Eyeballs
    // (RFC 8305) — si el DNS devuelve AAAA antes que A, intenta la conexión
    // IPv6 primero y espera a que falle antes de probar la siguiente. En
    // entornos con IPv6 roto pero anunciado (WSL2 es el caso real que hizo
    // falta esto — ni desactivar IPv6 a nivel de sistema ni el modo de red
    // "mirrored" lo arreglaron) esa espera por sí sola agota los 5s. Atar el
    // socket local a una dirección IPv4 hace que cualquier intento de
    // conectar a un destino IPv6 falle al instante (familias de dirección
    // distintas), así que solo se prueba la IPv4 — sin esperar a que un IPv6
    // que nunca iba a responder termine de no hacerlo.
    let cliente = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .local_address(std::net::IpAddr::V4(std::net::Ipv4Addr::UNSPECIFIED))
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
