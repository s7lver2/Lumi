//! Cifrado de los assets de un paquete publicado.

use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Key, Nonce};
use anyhow::{anyhow, Result};

/// El nonce viaja al principio del fichero. Va delante y no en la ficha
/// porque el asset tiene que poder descifrarse con la ficha y consigo mismo,
/// sin más piezas sueltas que perder.
const NONCE: usize = 12;

/// La semilla la aporta quien llama —el Indexer usa `rand`—, para que este
/// crate siga sin depender de un generador y los tests sean deterministas.
pub fn clave_nueva(semilla: [u8; 32]) -> [u8; 32] {
    semilla
}

pub fn cifrar(claro: &[u8], clave: &[u8; 32], nonce: [u8; NONCE]) -> Result<Vec<u8>> {
    let c = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(clave));
    let ct = c
        .encrypt(Nonce::from_slice(&nonce), claro)
        .map_err(|_| anyhow!("no se pudo cifrar el asset"))?;
    let mut fuera = Vec::with_capacity(NONCE + ct.len());
    fuera.extend_from_slice(&nonce);
    fuera.extend_from_slice(&ct);
    Ok(fuera)
}

pub fn descifrar(sellado: &[u8], clave: &[u8; 32]) -> Result<Vec<u8>> {
    if sellado.len() <= NONCE {
        return Err(anyhow!("el asset está truncado"));
    }
    let c = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(clave));
    c.decrypt(Nonce::from_slice(&sellado[..NONCE]), &sellado[NONCE..])
        .map_err(|_| anyhow!("el asset no se pudo abrir: clave incorrecta o fichero alterado"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lo_cifrado_vuelve_igual() {
        let clave = clave_nueva([7u8; 32]);
        let sellado = cifrar(b"unas imagenes", &clave, [1u8; 12]).unwrap();
        assert_ne!(&sellado[..], b"unas imagenes");
        assert_eq!(descifrar(&sellado, &clave).unwrap(), b"unas imagenes");
    }

    #[test]
    fn un_byte_alterado_no_se_abre() {
        let clave = clave_nueva([7u8; 32]);
        let mut sellado = cifrar(b"unas imagenes", &clave, [1u8; 12]).unwrap();
        let ultimo = sellado.len() - 1;
        sellado[ultimo] ^= 0x01;
        assert!(descifrar(&sellado, &clave).is_err());
    }

    #[test]
    fn con_otra_clave_no_se_abre() {
        let sellado = cifrar(b"unas imagenes", &clave_nueva([7u8; 32]), [1u8; 12]).unwrap();
        assert!(descifrar(&sellado, &clave_nueva([9u8; 32])).is_err());
    }
}
