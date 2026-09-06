//! Mismo patrón que `comprobar_actualizacion` en cliente/Indexer
//! (`client/src-tauri/src/main.rs`, `indexer/src-tauri/src/actualizacion.rs`):
//! la URL está duplicada a propósito, es configuración de red de cada
//! binario, no protocolo compartido.

use lumi_proto::actualizacion::Manifiesto;

use crate::error::InstaladorError;

const VERSIONES_URL: &str = "https://lumi.s7lver.xyz/api/versiones";

/// `reqwest::Error::to_string()` a secas se queda con el mensaje de fuera
/// ("error sending request for url (...)") y esconde la causa real (DNS,
/// TLS, conexión rechazada, timeout) en su cadena de `source()` — que es
/// justo lo que hacía falta ver para diagnosticar el fallo de red de WSL2
/// que llevó a añadir `local_address` más arriba y que resultó no ser eso.
/// Encadena todos los niveles con " ← " para que el mensaje final los
/// traiga todos, no solo el primero.
fn detalle(e: &reqwest::Error) -> String {
    use std::error::Error;
    let mut partes = vec![e.to_string()];
    let mut actual: Option<&(dyn Error + 'static)> = e.source();
    while let Some(err) = actual {
        partes.push(err.to_string());
        actual = err.source();
    }
    partes.join(" ← ")
}

pub fn obtener_verificado() -> Result<Manifiesto, InstaladorError> {
    // Sin tope, una red lenta o caída a medias podía dejar esta llamada
    // colgada indefinidamente. Subido de 5s a 20s: bajo WSL2 (con NAT
    // virtual de por medio) el primer handshake TLS de un proceso puede
    // tardar bastante más que sobre una red nativa, aunque un `curl` suelto
    // (con su propia caché de conexión/DNS) responda casi al instante.
    //
    // `local_address` (atar el socket a una IPv4 sin especificar, para
    // evitar que reqwest se quede esperando un intento de IPv6 que no
    // implementa Happy Eyeballs) se probó y no ayudó — el timeout seguía
    // agotándose igual, así que puede que interfiriera con el NAT virtual
    // de WSL2 en vez de evitarlo. Se retira: mejor un timeout más generoso
    // que un ajuste de bajo nivel sin confirmar que ayuda.
    let cliente = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|e| InstaladorError::Red(detalle(&e)))?;
    let manifiesto: Manifiesto = cliente
        .get(VERSIONES_URL)
        .send()
        .map_err(|e| InstaladorError::Red(detalle(&e)))?
        .json()
        .map_err(|e| InstaladorError::Red(detalle(&e)))?;
    manifiesto
        .comprobar()
        .map_err(|e| InstaladorError::Manifiesto(e.to_string()))?;
    Ok(manifiesto)
}
