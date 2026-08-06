//! La clave maestra del equipo: lo que cifra la clave de Mapbox y cualquier
//! otro secreto en `ajustes.sellado`.
//!
//! Es la versión mínima de lo que hace `crates/lumid/src/master.rs`: aquí no
//! hay modo sellado ni desbloqueo remoto, porque no hay servidor que
//! desbloquear. Un fichero de 32 bytes con permisos restrictivos junto a la
//! base de datos.

use std::path::Path;

use anyhow::{bail, Result};
use chacha20poly1305::aead::{Aead, KeyInit, OsRng};
use chacha20poly1305::{AeadCore, XChaCha20Poly1305, XNonce};

pub struct Maestra(XChaCha20Poly1305);

impl Maestra {
    pub fn abrir_o_crear(dir: &Path) -> Result<Self> {
        let ruta = dir.join("maestra.key");
        let bytes = if ruta.exists() {
            std::fs::read(&ruta)?
        } else {
            use rand::RngCore;
            let mut k = [0u8; 32];
            rand::thread_rng().fill_bytes(&mut k);
            std::fs::write(&ruta, k)?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                std::fs::set_permissions(&ruta, std::fs::Permissions::from_mode(0o600))?;
            }
            k.to_vec()
        };
        if bytes.len() != 32 {
            bail!("la clave maestra no mide 32 bytes: {} ", bytes.len());
        }
        Ok(Self(XChaCha20Poly1305::new_from_slice(&bytes)?))
    }

    /// Devuelve `nonce || ciphertext`, listo para guardar en un BLOB.
    pub fn sellar(&self, claro: &[u8]) -> Result<Vec<u8>> {
        let nonce = XChaCha20Poly1305::generate_nonce(&mut OsRng);
        let ct = self
            .0
            .encrypt(&nonce, claro)
            .map_err(|_| anyhow::anyhow!("no se pudo cifrar"))?;
        let mut fuera = nonce.to_vec();
        fuera.extend_from_slice(&ct);
        Ok(fuera)
    }

    pub fn abrir(&self, sellado: &[u8]) -> Result<Vec<u8>> {
        if sellado.len() < 24 {
            bail!("el dato cifrado es más corto que su nonce");
        }
        let (nonce, ct) = sellado.split_at(24);
        self.0
            .decrypt(XNonce::from_slice(nonce), ct)
            .map_err(|_| anyhow::anyhow!("no se pudo descifrar: ¿clave maestra distinta?"))
    }
}
