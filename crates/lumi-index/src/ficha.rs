//! La ficha en claro de un paquete publicado.

use anyhow::{anyhow, Result};
use base64::{engine::general_purpose::STANDARD, Engine};
use ed25519_dalek::{Signature, Signer, SigningKey, Verifier, VerifyingKey};
use serde::{Deserialize, Serialize};

/// Una ficha caduca a los 90 días. No es una fecha de caducidad del paquete:
/// es lo que impide que un reclamo abandonado bloquee territorio para
/// siempre. Refrescarla es resubir kilobytes, no el paquete.
pub const VIGENCIA_DIAS: i64 = 90;
pub const AVISO_REFRESCO_DIAS: i64 = 15;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Asset {
    pub nombre: String,
    pub sha256: String,
    pub bytes: u64,
    pub quadkeys: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Capa {
    pub modelo: String,
    pub version: String,
    pub dims: u32,
    /// Quién la produjo, que no tiene por qué ser el autor del cuerpo.
    pub autor: String,
    pub assets: Vec<Asset>,
}

/// Una zona que este paquete NO cubre porque ya la cubría otro. Es lo único
/// que produce el reclamo por parte de quien indexa: no descarga nada, lo
/// declara.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Dependencia {
    pub quadkeys: Vec<String>,
    pub paquete: String,
    pub autor: String,
    pub url: String,
    pub sha256: String,
}

/// El valor por defecto de `Ficha::numero_version` para una ficha publicada
/// antes de que este campo existiera: sin versionado, siempre fue "la única".
fn version_uno() -> u32 {
    1
}

/// `#[serde(default)]` arregla DESERIALIZAR una ficha antigua sin este campo,
/// pero `canonico()` reserializa la ficha entera para comprobar la firma —
/// sin esto, esa reserialización metería `"numero_version":1` donde el
/// fichero original nunca lo tuvo, y la firma de CUALQUIER ficha publicada
/// antes de este campo dejaría de verificar para siempre. Omitir el campo
/// cuando vale 1 reproduce byte a byte el formato antiguo.
fn es_version_uno(v: &u32) -> bool {
    *v == 1
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Ficha {
    pub version: u32,
    pub paquete: String,
    pub nombre: String,
    pub autor: String,
    /// Versión de CONTENIDO del índice — "Crear versión nueva" en el Indexer,
    /// no la versión de FORMATO de la ficha (`version`, arriba). `1` para
    /// cualquier ficha publicada antes de que esto existiera.
    #[serde(default = "version_uno", skip_serializing_if = "es_version_uno")]
    pub numero_version: u32,
    /// "github" o "huggingface". La firma no depende de esto, pero saber de
    /// dónde vino sirve para volver a pedirlo.
    pub alojamiento: String,
    pub clave_publica: String,
    pub publicada_en: String,
    pub vigente_hasta: String,
    /// La clave AES en base64. Viaja aquí a propósito: esto es ofuscación
    /// frente al alojamiento, no control de acceso.
    pub cifrado: String,
    pub no_redistribuible: Vec<String>,
    pub fuentes_por_quadkey: Vec<(String, Vec<String>)>,
    pub cuerpos: Vec<Asset>,
    pub capas: Vec<Capa>,
    pub dependencias: Vec<Dependencia>,
    pub firma: String,
}

impl Ficha {
    /// Lo que se firma: la ficha entera menos la firma. Se serializa con la
    /// firma vacía en vez de borrar el campo para que el formato no dependa
    /// del orden en que serde escriba las claves.
    pub fn canonico(&self) -> Vec<u8> {
        let mut sin = self.clone();
        sin.firma = String::new();
        serde_json::to_vec(&sin).unwrap_or_default()
    }

    pub fn firmar(&mut self, secreta: &[u8; 32]) -> Result<()> {
        let k = SigningKey::from_bytes(secreta);
        self.clave_publica = STANDARD.encode(k.verifying_key().to_bytes());
        self.firma = STANDARD.encode(k.sign(&self.canonico()).to_bytes());
        Ok(())
    }

    pub fn comprobar(&self) -> Result<()> {
        if self.firma.is_empty() || self.clave_publica.is_empty() {
            return Err(anyhow!("la ficha no está firmada"));
        }
        let pk: [u8; 32] = STANDARD
            .decode(&self.clave_publica)?
            .try_into()
            .map_err(|_| anyhow!("la clave pública no mide 32 bytes"))?;
        let sig: [u8; 64] = STANDARD
            .decode(&self.firma)?
            .try_into()
            .map_err(|_| anyhow!("la firma no mide 64 bytes"))?;
        VerifyingKey::from_bytes(&pk)?
            .verify(&self.canonico(), &Signature::from_bytes(&sig))
            .map_err(|_| anyhow!("la firma no corresponde a esta ficha"))
    }

    pub fn fuentes_de(&self, quadkey: &str) -> Vec<String> {
        self.fuentes_por_quadkey
            .iter()
            .find(|(q, _)| q == quadkey)
            .map(|(_, f)| f.clone())
            .unwrap_or_default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn secreta() -> [u8; 32] { [42u8; 32] }

    fn ficha_de_prueba() -> Ficha {
        Ficha {
            version: 1,
            paquete: "sevilla-norte".into(),
            nombre: "Sevilla norte".into(),
            numero_version: 1,
            autor: "nickespro130".into(),
            alojamiento: "github".into(),
            clave_publica: String::new(),
            publicada_en: "2026-08-09T18:00:00Z".into(),
            vigente_hasta: "2026-11-07T18:00:00Z".into(),
            cifrado: "aa==".into(),
            no_redistribuible: vec!["google".into()],
            fuentes_por_quadkey: vec![("0313101".into(), vec!["mapillary".into()])],
            cuerpos: vec![],
            capas: vec![],
            dependencias: vec![],
            firma: String::new(),
        }
    }

    #[test]
    fn lo_firmado_se_comprueba() {
        let mut f = ficha_de_prueba();
        f.firmar(&secreta()).unwrap();
        assert!(!f.firma.is_empty());
        assert!(!f.clave_publica.is_empty());
        f.comprobar().unwrap();
    }

    #[test]
    fn una_ficha_alterada_no_pasa() {
        let mut f = ficha_de_prueba();
        f.firmar(&secreta()).unwrap();
        f.nombre = "Sevilla sur".into();
        assert!(f.comprobar().is_err());
    }

    // Sin esto, publicar sin firmar y publicar firmado serían indistinguibles
    // para quien instala, que es justo lo que la firma existe para evitar.
    #[test]
    fn una_ficha_sin_firma_no_pasa() {
        assert!(ficha_de_prueba().comprobar().is_err());
    }

    #[test]
    fn la_firma_no_se_firma_a_si_misma() {
        let mut f = ficha_de_prueba();
        f.firmar(&secreta()).unwrap();
        let antes = f.canonico();
        f.firma = "otra cosa".into();
        assert_eq!(antes, f.canonico(), "el canónico no puede incluir la firma");
    }

    #[test]
    fn las_fuentes_de_una_quadkey_salen_de_la_ficha() {
        let f = ficha_de_prueba();
        assert_eq!(f.fuentes_de("0313101"), vec!["mapillary".to_string()]);
        assert!(f.fuentes_de("9999999").is_empty());
    }

    // Una ficha publicada antes del 8s (versiones de índice) no trae
    // `numero_version` en su JSON. Sin `#[serde(default)]` eso sería un campo
    // que ya no deserializa, y fichas publicadas dejarían de leerse de golpe.
    #[test]
    fn una_ficha_sin_numero_version_deserializa_como_la_uno() {
        let mut j: serde_json::Value = serde_json::to_value(ficha_de_prueba()).unwrap();
        j.as_object_mut().unwrap().remove("numero_version");
        let f: Ficha = serde_json::from_value(j).unwrap();
        assert_eq!(f.numero_version, 1);
    }

    // El caso real que rompía: una ficha firmada ANTES de que existiera
    // numero_version se reserializaba con el campo de vuelta (valor 1,
    // relleno por el default) y la firma dejaba de corresponder — la ficha
    // no cambió, la comprobación sí. `skip_serializing_if` reproduce el
    // formato antiguo byte a byte cuando el valor es 1.
    #[test]
    fn una_ficha_de_version_uno_firmada_antes_del_campo_sigue_verificando() {
        let secreta = [7u8; 32];
        let mut f = ficha_de_prueba();
        f.firmar(&secreta).unwrap();
        assert!(!serde_json::to_string(&f).unwrap().contains("numero_version"));

        let j = serde_json::to_string(&f).unwrap();
        let recibida: Ficha = serde_json::from_str(&j).unwrap();
        assert!(recibida.comprobar().is_ok());
    }
}
