//! Un asset publicado: bajar, comprobar, descifrar y desplegar.
//!
//! El orden importa. El SHA-256 se comprueba ANTES de descifrar y de abrir el
//! zip: descomprimir algo que no es lo que dijo la ficha es darle de comer al
//! parseador bytes de un desconocido.

use anyhow::{anyhow, Result};
use base64::{engine::general_purpose::STANDARD, Engine};
use sha2::{Digest, Sha256};
use std::path::Path;

/// Techo de bytes descomprimidos por paquete. Sin esto, un zip de unos pocos
/// KB con una ratio de compresión absurda podía llenar el disco entero antes
/// de que nada se diera cuenta — el sha256 solo comprueba el CIFRADO, nunca
/// dice nada sobre cuánto pesa lo de dentro. 50 GiB es generoso para un
/// índice geo-referenciado real y sigue parando una bomba de verdad.
const MAX_DESCOMPRIMIDO: u64 = 50 * 1024 * 1024 * 1024;

/// La clave AES viaja en la ficha, en base64. Eso es deliberado: el cifrado es
/// ofuscación frente al alojamiento, no control de acceso.
pub fn clave_de(cifrado: &str) -> Result<[u8; 32]> {
    let bytes = STANDARD.decode(cifrado)?;
    bytes.try_into().map_err(|_| anyhow!("la clave del paquete no mide 32 bytes"))
}

pub async fn traer_y_abrir(
    http: &reqwest::Client,
    url: &str,
    sha256_esperado: &str,
    clave: &[u8; 32],
    destino: &Path,
    progreso: &crate::indices::EnCurso,
) -> Result<()> {
    use futures::StreamExt;
    use tokio::io::AsyncWriteExt;

    // El asset se escribe a disco EN STREAMING, no se junta entero en RAM
    // con `.bytes()`: un cuerpo puede pesar hasta 1.8 GB (tope real de la
    // publicación, ver spec de `.lumidx`), y ese `.bytes()` original vivía
    // en memoria a la vez que, un par de líneas más abajo, el texto claro
    // ya descifrado — dos gigabytes largos, simultáneos, sin ninguna
    // necesidad, en una máquina que puede no sobrarle ese margen. Fue justo
    // eso lo que dejó el sistema colgado y tumbó el daemon a mitad de una
    // descarga real. El buffer aquí es del tamaño de un trozo de red, no
    // del tamaño del asset.
    std::fs::create_dir_all(destino)?;
    let temporal = destino.join(format!(".{sha256_esperado}.parcial"));

    let respuesta = http.get(url).send().await?.error_for_status()?;
    if let Some(p) = progreso.lock().unwrap().as_mut() {
        p.asset_bytes_total = respuesta.content_length().unwrap_or(0);
    }

    // Sin tope: si la conexión se queda muda a mitad de transferencia (un
    // salto de red, un proxy que suelta la conexión en silencio, un borde
    // de CDN que deja de mandar bytes sin cerrar nada), `flujo.next()` se
    // queda esperando para siempre — nada en `reqwest::Client::new()` pone
    // un límite. Eso es justo "se queda atascado en este punto y no
    // vuelve": la tarea nunca falla, así que tampoco hay error que ver ni
    // forma de que la instalación se recupere sola. Cada `next()` va
    // envuelto en un timeout de inactividad: si no llega NADA en este
    // margen, se corta con un error claro en vez de colgar para siempre.
    // Es un timeout de inactividad, no de duración total — una descarga de
    // 1.65GB legítima pero lenta sigue completando mientras sigan llegando
    // bytes, por lentos que sean.
    const TIMEOUT_INACTIVIDAD: std::time::Duration = std::time::Duration::from_secs(45);

    let mut hasher = Sha256::new();
    let mut recibidos: u64 = 0;
    {
        let mut fichero = tokio::fs::File::create(&temporal).await?;
        let mut flujo = respuesta.bytes_stream();
        loop {
            let siguiente = match tokio::time::timeout(TIMEOUT_INACTIVIDAD, flujo.next()).await {
                Ok(v) => v,
                Err(_) => {
                    let _ = std::fs::remove_file(&temporal);
                    return Err(anyhow!(
                        "la descarga se quedó sin recibir datos más de {}s a los {recibidos} bytes — \
                         conexión colgada, no un fallo declarado",
                        TIMEOUT_INACTIVIDAD.as_secs()
                    ));
                }
            };
            let Some(trozo) = siguiente else { break };
            let trozo = trozo.map_err(|e| {
                let _ = std::fs::remove_file(&temporal);
                anyhow!("se cortó la descarga: {e}")
            })?;
            hasher.update(&trozo);
            if let Err(e) = fichero.write_all(&trozo).await {
                let _ = std::fs::remove_file(&temporal);
                return Err(e.into());
            }
            recibidos += trozo.len() as u64;
            if let Some(p) = progreso.lock().unwrap().as_mut() {
                p.asset_bytes_hechos = recibidos;
            }
        }
    }

    let visto = format!("{:x}", hasher.finalize());
    if visto != sha256_esperado {
        let _ = std::fs::remove_file(&temporal);
        return Err(anyhow!("el asset no coincide con su sha256: dice {sha256_esperado}, es {visto}"));
    }

    // El descifrado (AES-256-GCM, un solo golpe) sigue exigiendo el asset
    // sellado entero en memoria — la biblioteca no ofrece una variante en
    // streaming y cambiarlo tocaría el formato de cifrado que ya comparten
    // el Indexer (que firma) y este mismo lector, así que queda fuera de
    // este arreglo. `sellado` se libera en cuanto `descifrar` devuelve
    // `claro`, así que el pico de aquí en adelante es de un solo asset, no
    // de dos a la vez como antes.
    let sellado = tokio::fs::read(&temporal).await?;
    let _ = tokio::fs::remove_file(&temporal).await;
    let claro = lumi_index::cifrado::descifrar(&sellado, clave)?;
    drop(sellado);
    let destino = destino.to_path_buf();

    // Descomprimir gigabytes es CPU pura: en el hilo async bloquearía el
    // worker de tokio entero y con él las peticiones que no tienen nada que
    // ver. Misma lección que costó el "colgado" al publicar en el 8.
    tokio::task::spawn_blocking(move || -> Result<()> {
        let mut z = zip::ZipArchive::new(std::io::Cursor::new(claro))?;

        // Se suma el tamaño DESCOMPRIMIDO que el propio zip declara para cada
        // entrada antes de escribir ni un byte — un vistazo a las cabeceras,
        // no a los datos. Una bomba de descompresión (unos pocos KB que se
        // convierten en gigabytes) se corta aquí, no a mitad de escribir en
        // disco.
        let total: u64 = (0..z.len())
            .map(|i| z.by_index(i).map(|f| f.size()).unwrap_or(0))
            .sum();
        if total > MAX_DESCOMPRIMIDO {
            return Err(anyhow!(
                "el paquete descomprime a {total} bytes, por encima del tope de {MAX_DESCOMPRIMIDO}"
            ));
        }

        std::fs::create_dir_all(&destino)?;
        for i in 0..z.len() {
            let mut f = z.by_index(i)?;
            let Some(rel) = f.enclosed_name() else {
                // Un nombre que se escapa del directorio (`../`) no se abre.
                // `enclosed_name` es justo la comprobación que lo impide.
                continue;
            };
            let salida = destino.join(rel);
            if f.is_dir() {
                std::fs::create_dir_all(&salida)?;
                continue;
            }
            if let Some(p) = salida.parent() {
                std::fs::create_dir_all(p)?;
            }
            let mut w = std::fs::File::create(&salida)?;
            std::io::copy(&mut f, &mut w)?;
        }
        Ok(())
    })
    .await??;
    Ok(())
}
