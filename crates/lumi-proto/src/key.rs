//! Clave de vinculación: `lumi1_<host:puerto>_<huella>_<secreto>`.
//!
//! La huella del certificado viaja dentro de la clave, así que el canal fuera
//! de banda por el que el owner la transmite verifica la identidad del
//! servidor. Sin diálogo de "¿confías?".

use rand::RngCore;
use sha2::{Digest, Sha256};
use std::fmt;

/// 128 bits de huella. Suficiente contra un atacante que intente generar un
/// certificado que colisione; 64 bits no lo serían.
pub const FP_BYTES: usize = 16;
/// 160 bits de secreto.
pub const SECRET_BYTES: usize = 20;

const PREFIX: &str = "lumi1";

#[derive(Debug, thiserror::Error, PartialEq)]
pub enum KeyError {
    #[error("la clave no empieza por lumi1_")]
    BadPrefix,
    #[error("la clave no tiene los cuatro campos")]
    BadShape,
    #[error("huella o secreto no son base58 válido")]
    BadEncoding,
    #[error("la huella no mide {FP_BYTES} bytes")]
    BadFingerprintLen,
}

#[derive(Debug, Clone, PartialEq)]
pub struct PairKey {
    pub addr: String,
    pub fingerprint: String,
    pub secret: String,
}

/// SHA-256 del certificado DER, truncado a 128 bits, en base58.
pub fn fingerprint(cert_der: &[u8]) -> String {
    let digest = Sha256::digest(cert_der);
    bs58::encode(&digest[..FP_BYTES]).into_string()
}

impl PairKey {
    pub fn generate(addr: &str, cert_der: &[u8]) -> Self {
        let mut secret = [0u8; SECRET_BYTES];
        rand::thread_rng().fill_bytes(&mut secret);
        Self {
            addr: addr.to_string(),
            fingerprint: fingerprint(cert_der),
            secret: bs58::encode(secret).into_string(),
        }
    }

    pub fn parse(s: &str) -> Result<Self, KeyError> {
        let rest = s.trim().strip_prefix(PREFIX).ok_or(KeyError::BadPrefix)?;
        let rest = rest.strip_prefix('_').ok_or(KeyError::BadPrefix)?;
        // Desde la derecha: el campo de dirección puede llevar puntos y dos puntos.
        let mut it = rest.rsplitn(3, '_');
        let secret = it.next().ok_or(KeyError::BadShape)?;
        let fingerprint = it.next().ok_or(KeyError::BadShape)?;
        let addr = it.next().ok_or(KeyError::BadShape)?;
        if addr.is_empty() || secret.is_empty() {
            return Err(KeyError::BadShape);
        }
        let fp = bs58::decode(fingerprint)
            .into_vec()
            .map_err(|_| KeyError::BadEncoding)?;
        if fp.len() != FP_BYTES {
            return Err(KeyError::BadFingerprintLen);
        }
        bs58::decode(secret)
            .into_vec()
            .map_err(|_| KeyError::BadEncoding)?;
        Ok(Self {
            addr: addr.to_string(),
            fingerprint: fingerprint.to_string(),
            secret: secret.to_string(),
        })
    }

    /// ¿La huella de este certificado es la que anuncia la clave?
    pub fn matches_cert(&self, cert_der: &[u8]) -> bool {
        // Comparación en tiempo constante no hace falta: la huella es pública.
        fingerprint(cert_der) == self.fingerprint
    }
}

impl fmt::Display for PairKey {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{PREFIX}_{}_{}_{}", self.addr, self.fingerprint, self.secret)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip_con_ipv4_y_rechazo_de_basura() {
        let cert = b"certificado de mentira";
        let k = PairKey::generate("192.168.1.40:7717", cert);
        let s = k.to_string();
        assert_eq!(PairKey::parse(&s).unwrap(), k);
        assert_eq!(PairKey::parse(&s).unwrap().addr, "192.168.1.40:7717");
        assert!(k.matches_cert(cert));
        assert!(!k.matches_cert(b"otro certificado"));
        assert_eq!(PairKey::parse("nope").unwrap_err(), KeyError::BadPrefix);
        assert_eq!(
            PairKey::parse("lumi1_host_short_abc").unwrap_err(),
            KeyError::BadFingerprintLen
        );
    }
}
