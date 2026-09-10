//! Lista de desreclamos: lo único que la web (subsistema 9) puede decirle al
//! Indexer sobre el catálogo remoto. Mismo esquema de firma que `Ficha`
//! (Ed25519, clave pública compilada) y que `lumi_proto::actualizacion::Manifiesto`
//! — un solo idioma de firma en el proyecto, no tres.
//!
//! La asimetría es deliberada: esto puede QUITAR un reclamo, nunca añadir
//! uno. Si el servidor que lo sirve desaparece o miente, el techo es "sigue
//! reclamado lo que ya estaba" — nunca "ahora hay territorio de otro que no
//! lo estaba".

use base64::{engine::general_purpose::STANDARD, Engine};
use ed25519_dalek::{Signature, Signer, SigningKey, Verifier, VerifyingKey};
use serde::{Deserialize, Serialize};

/// Generada con `cargo run -p lumi-index --example firmar_desreclamos --
/// generar-clave` y pegada aquí a mano — la privada vive solo en el secreto
/// de GitHub Actions y, si el operador la conserva, en su
/// `~/.lumi-indexer/desreclamos.key`, nunca en este repo.
///
/// Rotada el 2026-09-10: la clave anterior firmó `desreclamos.json` sin que
/// su privada sobreviviera en ningún disco conocido del operador (ni Windows
/// ni WSL, comprobado antes de rotar) -- inservible para firmar nada más,
/// así que se sustituye entera en vez de mantener una versión puente que
/// valide las dos. Sin coste real: `lista` seguía vacía, no había ninguna
/// liberación real que perder. Rotar de verdad (con liberaciones ya
/// publicadas de por medio) sigue exigiendo esa versión puente — no
/// resuelto, mismo techo que `lumi_proto::actualizacion::CLAVE_PUBLICA`.
pub const CLAVE_PUBLICA: [u8; 32] = [138, 141, 110, 108, 34, 254, 243, 82, 16, 208, 153, 36, 206, 230, 219, 79, 170, 17, 56, 66, 208, 182, 235, 205, 65, 239, 156, 42, 47, 119, 147, 105];

#[derive(Debug, thiserror::Error, PartialEq)]
pub enum DesreclamosError {
    #[error("la lista de desreclamos no está firmada")]
    SinFirmar,
    #[error("la firma no corresponde a esta lista")]
    FirmaInvalida,
    #[error("codificación inválida: {0}")]
    Codificacion(String),
}

/// `(paquete, motivo)` — mismo shape que ya guarda `Almacen::desreclamos_fijar`,
/// para no tener que traducir entre dos formas de la misma lista.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Desreclamos {
    pub lista: Vec<(String, String)>,
    /// Informativo, no la fuente de verdad — `comprobar()` nunca compara
    /// contra este campo, siempre contra `CLAVE_PUBLICA`.
    #[serde(default)]
    pub clave_publica: String,
    #[serde(default)]
    pub firma: String,
}

impl Desreclamos {
    /// Lo que se firma: el documento con `firma` en cadena vacía. Mismo truco
    /// que `Ficha::canonico()`/`Manifiesto::canonico()`: serializar con la
    /// firma vacía en vez de borrar el campo, para que el formato no dependa
    /// del orden en que serde escriba las claves.
    pub fn canonico(&self) -> Vec<u8> {
        let mut sin = self.clone();
        sin.firma = String::new();
        serde_json::to_vec(&sin).unwrap_or_default()
    }

    pub fn firmar(&mut self, secreta: &SigningKey) {
        self.clave_publica = STANDARD.encode(secreta.verifying_key().to_bytes());
        self.firma = STANDARD.encode(secreta.sign(&self.canonico()).to_bytes());
    }

    /// Verifica contra `CLAVE_PUBLICA` — la única clave de confianza. Nunca
    /// contra `self.clave_publica`: eso solo probaría que el documento firma
    /// consigo mismo, no que lo firmó Lumi.
    pub fn comprobar(&self) -> Result<(), DesreclamosError> {
        if self.firma.is_empty() {
            return Err(DesreclamosError::SinFirmar);
        }
        let sig_bytes: [u8; 64] = STANDARD
            .decode(&self.firma)
            .map_err(|e| DesreclamosError::Codificacion(e.to_string()))?
            .try_into()
            .map_err(|_| DesreclamosError::FirmaInvalida)?;
        let sig = Signature::from_bytes(&sig_bytes);
        let pk = VerifyingKey::from_bytes(&CLAVE_PUBLICA)
            .map_err(|e| DesreclamosError::Codificacion(e.to_string()))?;
        pk.verify(&self.canonico(), &sig).map_err(|_| DesreclamosError::FirmaInvalida)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn firma_de_otra_clave_no_pasa_contra_la_compilada() {
        let secreta = SigningKey::generate(&mut rand::rngs::OsRng);
        let mut d = Desreclamos { lista: vec![("paquete-x".into(), "abuso".into())], ..Default::default() };
        d.firmar(&secreta);
        // Firmar con cualquier otra clave que no sea la compilada en
        // CLAVE_PUBLICA, real y generada al azar aquí mismo, nunca debe
        // pasar `comprobar()`. Es lo que demuestra que no basta con firmar
        // con CUALQUIER clave, tiene que ser la compilada.
        assert!(d.comprobar().is_err());
    }

    #[test]
    fn sin_firma_no_pasa() {
        let d = Desreclamos { lista: vec![], ..Default::default() };
        assert_eq!(d.comprobar(), Err(DesreclamosError::SinFirmar));
    }
}
