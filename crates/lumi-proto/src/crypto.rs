//! Contraseñas, secretos y envelope encryption.
//!
//! No hay cifrado extremo a extremo de imágenes y no se afirma que lo haya:
//! el servidor necesita el píxel en claro para inferir. Esto protege contra
//! disco robado, copia filtrada e instantánea de VM. No contra root en
//! caliente.

use argon2::password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString};
use argon2::Argon2;
use chacha20poly1305::aead::{Aead, KeyInit};
use chacha20poly1305::{XChaCha20Poly1305, XNonce};
use rand::RngCore;

const NONCE_BYTES: usize = 24;

#[derive(Debug, thiserror::Error)]
pub enum CryptoError {
    #[error("argon2: {0}")]
    Argon2(String),
    #[error("no se pudo descifrar: clave incorrecta o dato manipulado")]
    Open,
    #[error("dato sellado demasiado corto")]
    TooShort,
}

pub fn hash_password(pw: &str) -> Result<String, CryptoError> {
    let salt = SaltString::generate(&mut rand::thread_rng());
    Argon2::default()
        .hash_password(pw.as_bytes(), &salt)
        .map(|h| h.to_string())
        .map_err(|e| CryptoError::Argon2(e.to_string()))
}

pub fn verify_password(pw: &str, phc: &str) -> bool {
    PasswordHash::new(phc)
        .map(|h| Argon2::default().verify_password(pw.as_bytes(), &h).is_ok())
        .unwrap_or(false)
}

#[derive(Clone)]
pub struct MasterKey([u8; 32]);

impl MasterKey {
    pub fn random() -> Self {
        let mut k = [0u8; 32];
        rand::thread_rng().fill_bytes(&mut k);
        Self(k)
    }
    pub fn from_bytes(b: [u8; 32]) -> Self {
        Self(b)
    }
    pub fn as_bytes(&self) -> &[u8; 32] {
        &self.0
    }
    /// Modo sellado: la maestra se deriva de la frase del owner.
    pub fn derive(passphrase: &str, salt: &[u8]) -> Result<Self, CryptoError> {
        let mut k = [0u8; 32];
        Argon2::default()
            .hash_password_into(passphrase.as_bytes(), salt, &mut k)
            .map_err(|e| CryptoError::Argon2(e.to_string()))?;
        Ok(Self(k))
    }
}

impl std::fmt::Debug for MasterKey {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("MasterKey(oculta)")
    }
}

/// Nonce aleatorio por delante del ciphertext. Formato: `nonce || ct`.
pub fn seal(mk: &MasterKey, plain: &[u8]) -> Vec<u8> {
    let mut nonce = [0u8; NONCE_BYTES];
    rand::thread_rng().fill_bytes(&mut nonce);
    let ct = XChaCha20Poly1305::new(mk.as_bytes().into())
        .encrypt(XNonce::from_slice(&nonce), plain)
        .expect("xchacha no falla con nonce e input válidos");
    [nonce.as_slice(), &ct].concat()
}

pub fn open(mk: &MasterKey, sealed: &[u8]) -> Result<Vec<u8>, CryptoError> {
    if sealed.len() <= NONCE_BYTES {
        return Err(CryptoError::TooShort);
    }
    let (nonce, ct) = sealed.split_at(NONCE_BYTES);
    XChaCha20Poly1305::new(mk.as_bytes().into())
        .decrypt(XNonce::from_slice(nonce), ct)
        .map_err(|_| CryptoError::Open)
}

/// Clave de datos por proyecto. Se guarda envuelta con `seal`.
pub fn new_dek() -> [u8; 32] {
    let mut k = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut k);
    k
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn contrasenas_y_envelope() {
        let phc = hash_password("correcto caballo").unwrap();
        assert!(verify_password("correcto caballo", &phc));
        assert!(!verify_password("otra cosa", &phc));

        let mk = MasterKey::random();
        let dek = new_dek();
        let envuelta = seal(&mk, &dek);
        assert_eq!(open(&mk, &envuelta).unwrap(), dek);
        assert!(open(&MasterKey::random(), &envuelta).is_err());

        // manipular un byte del ciphertext tiene que fallar, no devolver basura
        let mut roto = envuelta.clone();
        *roto.last_mut().unwrap() ^= 1;
        assert!(open(&mk, &roto).is_err());

        // la misma frase con la misma sal da la misma maestra
        let a = MasterKey::derive("frase larga del owner", b"sal de 16 bytes!").unwrap();
        let b = MasterKey::derive("frase larga del owner", b"sal de 16 bytes!").unwrap();
        assert_eq!(a.as_bytes(), b.as_bytes());
    }
}
