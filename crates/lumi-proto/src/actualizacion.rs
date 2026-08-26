//! Manifiesto de versiones firmado: lo que los tres binarios (cliente, lumid,
//! Indexer) comparan contra lo que tienen instalado.
//!
//! Firma Ed25519, mismo esquema que `Ficha` en `lumi-index` — un solo
//! idioma de firma en el proyecto, no dos. La cadena de confianza es
//! deliberada: la clave pública va compilada en el binario, firma el
//! manifiesto entero, y el manifiesto contiene el `sha256` de cada
//! artefacto. Ni quien aloja la lista (Vercel) ni quien aloja los bytes
//! (GitHub Releases) son de confianza — solo pueden servir algo viejo,
//! nunca algo falso.

use base64::{engine::general_purpose::STANDARD, Engine};
use ed25519_dalek::{Signature, Signer, SigningKey, Verifier, VerifyingKey};
use serde::{Deserialize, Serialize};

/// Generada una vez con `lumi actualizaciones generar-clave` (crates/lumi-cli)
/// y pegada aquí a mano — ver Task 2 de este plan.
///
/// Placeholder hasta que exista una clave real: con todo-ceros, cualquier
/// firma real falla `VerifyingKey::from_bytes` o `verify`, así que el techo
/// (comprobar() siempre False) es seguro por defecto, no silenciosamente
/// permisivo.
///
/// Rotarla exige una versión puente que sepa validar con la vieja y la
/// nueva a la vez — no está resuelto, es el techo que anota la spec
/// (docs/superpowers/specs/2026-08-26-canal-de-actualizaciones-design.md).
pub const CLAVE_PUBLICA: [u8; 32] = [0u8; 32];

#[derive(Debug, thiserror::Error, PartialEq)]
pub enum ActualizacionError {
    #[error("el manifiesto no está firmado")]
    SinFirmar,
    #[error("la firma no corresponde a este manifiesto")]
    FirmaInvalida,
    #[error("codificación inválida: {0}")]
    Codificacion(String),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Producto {
    Cliente,
    Lumid,
    Indexer,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Artefacto {
    pub plataforma: String,
    pub url: String,
    pub bytes: u64,
    pub sha256: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Publicacion {
    pub producto: Producto,
    pub version: String,
    pub publicado: String,
    pub notas: String,
    pub retirada: bool,
    pub artefactos: Vec<Artefacto>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Manifiesto {
    pub version: u32,
    /// Informativo, no la fuente de verdad — `comprobar()` nunca compara
    /// contra este campo, siempre contra `CLAVE_PUBLICA`.
    #[serde(default)]
    pub clave_publica: String,
    pub publicaciones: Vec<Publicacion>,
    #[serde(default)]
    pub firma: String,
}

impl Manifiesto {
    /// Lo que se firma: el documento con `firma` en cadena vacía. Mismo
    /// truco que `Ficha::canonico()` en `lumi-index`: serializar con la
    /// firma vacía en vez de borrar el campo, para que el formato no
    /// dependa del orden en que serde escriba las claves.
    pub fn canonico(&self) -> Vec<u8> {
        let mut sin = self.clone();
        sin.firma = String::new();
        serde_json::to_vec(&sin).unwrap_or_default()
    }

    pub fn firmar(&mut self, secreta: &SigningKey) {
        self.clave_publica = STANDARD.encode(secreta.verifying_key().to_bytes());
        self.firma = STANDARD.encode(secreta.sign(&self.canonico()).to_bytes());
    }

    /// Verifica contra `CLAVE_PUBLICA` — la única clave de confianza.
    pub fn comprobar(&self) -> Result<(), ActualizacionError> {
        self.verificar_contra(&CLAVE_PUBLICA)
    }

    fn verificar_contra(&self, pk_bytes: &[u8; 32]) -> Result<(), ActualizacionError> {
        if self.firma.is_empty() {
            return Err(ActualizacionError::SinFirmar);
        }
        let sig_bytes: [u8; 64] = STANDARD
            .decode(&self.firma)
            .map_err(|e| ActualizacionError::Codificacion(e.to_string()))?
            .try_into()
            .map_err(|_| ActualizacionError::FirmaInvalida)?;
        let sig = Signature::from_bytes(&sig_bytes);
        let pk = VerifyingKey::from_bytes(pk_bytes)
            .map_err(|e| ActualizacionError::Codificacion(e.to_string()))?;
        pk.verify(&self.canonico(), &sig)
            .map_err(|_| ActualizacionError::FirmaInvalida)
    }

    /// La publicación de `producto` para `plataforma` que sea más nueva que
    /// `version_actual` y no esté retirada. `None` si no hay nada que
    /// ofrecer, sea porque no existe o porque la única candidata está
    /// retirada — para ese caso concreto usa `version_retirada`.
    pub fn mas_nueva(&self, producto: Producto, version_actual: &str, plataforma: &str) -> Option<&Publicacion> {
        self.publicaciones
            .iter()
            .filter(|p| p.producto == producto && !p.retirada)
            .filter(|p| p.artefactos.iter().any(|a| a.plataforma == plataforma))
            .filter(|p| es_mas_nueva(&p.version, version_actual))
            .max_by(|a, b| comparar(&a.version, &b.version))
    }

    /// `true` si la versión instalada aparece en el manifiesto marcada como
    /// retirada. Independiente de que haya o no una más nueva que ofrecer.
    pub fn version_retirada(&self, producto: Producto, version_actual: &str) -> bool {
        self.publicaciones
            .iter()
            .any(|p| p.producto == producto && p.retirada && p.version == version_actual)
    }
}

/// Parseo a tupla de tres enteros. Ponytail: no hay sufijo de pre-release
/// (`-rc1`) — el día que exista un canal beta que lo necesite, se añade
/// entonces, no antes.
fn partes(v: &str) -> (u32, u32, u32) {
    let mut it = v.trim().splitn(3, '.').map(|p| p.parse::<u32>().unwrap_or(0));
    (it.next().unwrap_or(0), it.next().unwrap_or(0), it.next().unwrap_or(0))
}

fn comparar(a: &str, b: &str) -> std::cmp::Ordering {
    partes(a).cmp(&partes(b))
}

fn es_mas_nueva(candidata: &str, actual: &str) -> bool {
    comparar(candidata, actual) == std::cmp::Ordering::Greater
}

#[cfg(test)]
mod tests {
    use super::*;

    fn clave_prueba() -> SigningKey {
        SigningKey::from_bytes(&[7u8; 32])
    }

    fn manifiesto_de_prueba() -> Manifiesto {
        Manifiesto {
            version: 1,
            clave_publica: String::new(),
            publicaciones: vec![Publicacion {
                producto: Producto::Lumid,
                version: "2.1.0".into(),
                publicado: "2026-08-26T10:00:00Z".into(),
                notas: "cola: reintento acotado".into(),
                retirada: false,
                artefactos: vec![Artefacto {
                    plataforma: "linux-x86_64".into(),
                    url: "https://example.invalid/lumid".into(),
                    bytes: 100,
                    sha256: "abc".into(),
                }],
            }],
            firma: String::new(),
        }
    }

    #[test]
    fn firma_valida_pasa_contra_su_propia_clave() {
        let k = clave_prueba();
        let mut m = manifiesto_de_prueba();
        m.firmar(&k);
        assert!(m.verificar_contra(&k.verifying_key().to_bytes()).is_ok());
    }

    #[test]
    fn firma_no_pasa_contra_otra_clave() {
        let k = clave_prueba();
        let otra = SigningKey::from_bytes(&[9u8; 32]);
        let mut m = manifiesto_de_prueba();
        m.firmar(&k);
        assert_eq!(
            m.verificar_contra(&otra.verifying_key().to_bytes()),
            Err(ActualizacionError::FirmaInvalida)
        );
    }

    #[test]
    fn manifiesto_manipulado_tras_firmar_no_pasa() {
        let k = clave_prueba();
        let mut m = manifiesto_de_prueba();
        m.firmar(&k);
        m.publicaciones[0].version = "9.9.9".into();
        assert_eq!(
            m.verificar_contra(&k.verifying_key().to_bytes()),
            Err(ActualizacionError::FirmaInvalida)
        );
    }

    #[test]
    fn sin_firma_falla_con_su_propio_error() {
        let m = manifiesto_de_prueba();
        assert_eq!(m.verificar_contra(&[0u8; 32]), Err(ActualizacionError::SinFirmar));
    }

    #[test]
    fn mas_nueva_ignora_version_igual_o_menor() {
        let m = manifiesto_de_prueba();
        assert!(m.mas_nueva(Producto::Lumid, "2.1.0", "linux-x86_64").is_none());
        assert!(m.mas_nueva(Producto::Lumid, "2.2.0", "linux-x86_64").is_none());
        assert!(m.mas_nueva(Producto::Lumid, "2.0.0", "linux-x86_64").is_some());
    }

    #[test]
    fn mas_nueva_ignora_retirada() {
        let mut m = manifiesto_de_prueba();
        m.publicaciones[0].retirada = true;
        assert!(m.mas_nueva(Producto::Lumid, "2.0.0", "linux-x86_64").is_none());
    }

    #[test]
    fn mas_nueva_ignora_plataforma_sin_artefacto() {
        let m = manifiesto_de_prueba();
        assert!(m.mas_nueva(Producto::Lumid, "2.0.0", "windows-x86_64").is_none());
    }

    #[test]
    fn mas_nueva_ignora_otro_producto() {
        let m = manifiesto_de_prueba();
        assert!(m.mas_nueva(Producto::Cliente, "2.0.0", "linux-x86_64").is_none());
    }

    #[test]
    fn version_retirada_detecta_la_propia_y_solo_esa() {
        let mut m = manifiesto_de_prueba();
        m.publicaciones[0].retirada = true;
        assert!(m.version_retirada(Producto::Lumid, "2.1.0"));
        assert!(!m.version_retirada(Producto::Lumid, "9.9.9"));
        assert!(!m.version_retirada(Producto::Cliente, "2.1.0"));
    }
}
