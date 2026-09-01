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
/// generar-clave` y pegada aquí a mano — la privada vive solo en
/// `~/.lumi-indexer/desreclamos.key` de quien publica, nunca en el repo.
/// Rotarla exige una versión puente que sepa validar con la vieja y la nueva
/// a la vez — no resuelto, mismo techo que `lumi_proto::actualizacion::CLAVE_PUBLICA`.
pub const CLAVE_PUBLICA: [u8; 32] = [1, 159, 152, 114, 9, 2, 82, 149, 188, 9, 8, 75, 199, 148, 6, 131, 191, 13, 103, 160, 116, 191, 75, 115, 223, 193, 88, 141, 84, 130, 12, 82];

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
        // CLAVE_PUBLICA en este árbol es el placeholder de ceros (todavía no
        // hay clave real generada) — firmar con cualquier otra clave, real o
        // no, nunca debe pasar `comprobar()`. Es lo que demuestra que no
        // basta con firmar con CUALQUIER clave, tiene que ser la compilada.
        assert!(d.comprobar().is_err());
    }

    #[test]
    fn sin_firma_no_pasa() {
        let d = Desreclamos { lista: vec![], ..Default::default() };
        assert_eq!(d.comprobar(), Err(DesreclamosError::SinFirmar));
    }
}
