//! Un asset publicado: bajar, comprobar, descifrar y desplegar.
//!
//! El orden importa. El SHA-256 se comprueba ANTES de descifrar y de abrir el
//! zip: descomprimir algo que no es lo que dijo la ficha es darle de comer al
//! parseador bytes de un desconocido.
//!
//! ponytail: sin llamante hasta la Tarea 5 (`indices::instalar`), de la misma
//! tanda de este plan.
#![allow(dead_code)]

use anyhow::{anyhow, Result};
use base64::{engine::general_purpose::STANDARD, Engine};
use sha2::{Digest, Sha256};
use std::path::Path;

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
) -> Result<()> {
    let sellado = http.get(url).send().await?.error_for_status()?.bytes().await?;

    let visto = format!("{:x}", Sha256::digest(&sellado));
    if visto != sha256_esperado {
        return Err(anyhow!("el asset no coincide con su sha256: dice {sha256_esperado}, es {visto}"));
    }

    let claro = lumi_index::cifrado::descifrar(&sellado, clave)?;
    let destino = destino.to_path_buf();

    // Descomprimir gigabytes es CPU pura: en el hilo async bloquearía el
    // worker de tokio entero y con él las peticiones que no tienen nada que
    // ver. Misma lección que costó el "colgado" al publicar en el 8.
    tokio::task::spawn_blocking(move || -> Result<()> {
        let mut z = zip::ZipArchive::new(std::io::Cursor::new(claro))?;
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
