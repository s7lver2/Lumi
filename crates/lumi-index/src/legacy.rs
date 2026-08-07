//! Leer un paquete cifrado del catálogo de datasets de la v1.
//!
//! Formato: assets `bundle.zip.enc` y `metadata.json.enc` de una release de
//! GitHub, AES-256-GCM con `iv || authTag || ciphertext` y una clave de 32
//! bytes incrustada en la aplicación.
//!
//! Esa clave es OFUSCACIÓN frente a quien navegue el repositorio sin la
//! aplicación, NO un límite de seguridad: es extraíble de un proyecto de
//! código abierto por cualquiera que mire. El límite real de confianza es la
//! validación de este módulo. Un paquete descifrado no es un paquete de
//! confianza.

use std::collections::HashMap;

use aes_gcm::aead::{Aead, KeyInit, Payload};
use aes_gcm::{Aes256Gcm, Nonce};
use anyhow::{bail, Context, Result};
use serde::Deserialize;

/// La misma clave que `apps/web/lib/datasets/shared-key.ts` de la v1. Sin ella
/// no se puede abrir nada de lo ya publicado.
pub const CLAVE_COMPARTIDA: [u8; 32] = {
    // Escrita en bytes y no decodificada en tiempo de ejecución para que un
    // fallo de base64 no sea un error de arranque.
    // base64: 8GV57JbzQxrFNF3G/yEyxJ6dsFAZ2GiIHbxe6rK216w=
    // NOTA: el plan traía 0xfe en la posición 12; decodificando el propio
    // base64 del comentario da 0xff. Es un error de transcripción del plan
    // (el test `la_clave_es_la_de_la_v1` lo confirma comparando contra el
    // mismo base64), corregido aquí para que los dos queden de acuerdo.
    [
        0xf0, 0x65, 0x79, 0xec, 0x96, 0xf3, 0x43, 0x1a, 0xc5, 0x34, 0x5d, 0xc6, 0xff, 0x21, 0x32,
        0xc4, 0x9e, 0x9d, 0xb0, 0x50, 0x19, 0xd8, 0x68, 0x88, 0x1d, 0xbc, 0x5e, 0xea, 0xb2, 0xb6,
        0xd7, 0xac,
    ]
};

/// Comprobación de que la constante de arriba es la clave de la v1. Si alguien
/// la toca, esto lo dice en el mismo `cargo test` y no en producción.
#[test]
fn la_clave_es_la_de_la_v1() {
    // El `use` va aquí dentro y no arriba: fuera de los tests nadie decodifica
    // base64, y a nivel de módulo el trait quedaba sin usar en la compilación
    // normal.
    use base64::Engine;
    let esperada = base64::engine::general_purpose::STANDARD
        .decode("8GV57JbzQxrFNF3G/yEyxJ6dsFAZ2GiIHbxe6rK216w=")
        .unwrap();
    assert_eq!(CLAVE_COMPARTIDA.to_vec(), esperada);
}

const IV_BYTES: usize = 12;
const TAG_BYTES: usize = 16;

/// `iv || authTag || ciphertext`. El authTag va SEPARADO, delante del texto
/// cifrado, que es como lo dejaba `crypto.ts` de la v1; `aes-gcm` lo espera
/// pegado al final, de ahí el reensamblado.
pub fn descifrar(bytes: &[u8]) -> Result<Vec<u8>> {
    if bytes.len() < IV_BYTES + TAG_BYTES {
        bail!("el paquete es más corto que su propia cabecera");
    }
    let iv = &bytes[..IV_BYTES];
    let tag = &bytes[IV_BYTES..IV_BYTES + TAG_BYTES];
    let ct = &bytes[IV_BYTES + TAG_BYTES..];
    let mut pegado = Vec::with_capacity(ct.len() + TAG_BYTES);
    pegado.extend_from_slice(ct);
    pegado.extend_from_slice(tag);

    let cifra = Aes256Gcm::new_from_slice(&CLAVE_COMPARTIDA)?;
    cifra
        .decrypt(Nonce::from_slice(iv), Payload { msg: &pegado, aad: b"" })
        .map_err(|_| anyhow::anyhow!("el authTag no cuadra: el paquete está corrupto o no es de Lumi"))
}

/// Todo nombre que acabe formando una ruta pasa por aquí.
///
/// No se usa una expresión regular con anticipación negativa porque el crate
/// `regex` no las soporta; la comprobación es la misma en dos pasos. El punto
/// suelto se acepta a propósito: hay panoIds reales de Google que terminan en
/// punto, y confirmado en la v1 que rechazarlos rompía paquetes publicados. Lo
/// que se rechaza es `..`, que es lo que de verdad sube por el árbol.
pub fn nombre_seguro(n: &str) -> bool {
    !n.is_empty()
        && !n.contains("..")
        && n.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.'))
}

/// Topes que se comprueban ANTES de descomprimir, sobre lo que el zip declara
/// en su directorio central. Es la defensa contra una bomba de descompresión:
/// mirarlos después ya sería tarde.
pub struct Topes {
    pub comprimido_max: u64,
    pub descomprimido_max: u64,
    pub ficheros_max: u64,
}

impl Topes {
    pub fn por_defecto() -> Self {
        // 32 GB descomprimido es una ciudad grande con holgura; un millón de
        // ficheros, muchísimo más de lo que produce cualquier área real.
        Self { comprimido_max: 8 << 30, descomprimido_max: 32 << 30, ficheros_max: 1_000_000 }
    }

    pub fn comprueba(&self, comprimido: u64, ficheros: u64, descomprimido: u64) -> Result<()> {
        if comprimido > self.comprimido_max {
            bail!("el paquete comprimido son {comprimido} bytes, por encima del tope");
        }
        if descomprimido > self.descomprimido_max {
            bail!("descomprimido serían {descomprimido} bytes, por encima del tope");
        }
        if ficheros > self.ficheros_max {
            bail!("el paquete declara {ficheros} ficheros, por encima del tope");
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct ModeloV1 {
    pub id: String,
    pub version: String,
    #[serde(rename = "embeddingDim")]
    pub embedding_dim: u32,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ImagenV1 {
    #[serde(rename = "panoId")]
    pub pano_id: String,
    pub heading: i32,
    pub lat: f64,
    pub lng: f64,
    #[serde(rename = "streetViewDate")]
    #[serde(default)]
    pub street_view_date: Option<String>,
    #[serde(default)]
    pub embeddings: HashMap<String, Option<Vec<f32>>>,
    #[serde(rename = "hasFile")]
    #[serde(default)]
    pub has_file: bool,
}

#[derive(Debug, Clone, Deserialize)]
pub struct AreaV1 {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(rename = "geometryWkt")]
    pub geometry_wkt: String,
    pub images: Vec<ImagenV1>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ManifiestoV1 {
    pub version: u32,
    #[serde(rename = "exportedAt")]
    pub exported_at: String,
    pub models: Vec<ModeloV1>,
    pub areas: Vec<AreaV1>,
}

/// Valida el manifiesto descifrado campo a campo. La v1 hacía aquí un cast
/// suelto y por eso necesitó esta función después.
///
/// Lo que se comprueba y por qué:
/// - `models` no vacío y con dimensión positiva: sin eso no se sabe qué mide
///   ningún vector.
/// - cada clave de `embeddings` es un modelo DECLARADO: un bundle malicioso
///   podría anunciar un modelo compatible y traer datos de otro espacio.
/// - la longitud de cada vector cuadra con la dimensión declarada: si
///   coincidiera por casualidad, corrompería el índice en silencio.
/// - `panoId` pasa `nombre_seguro`: acaba siendo una ruta.
/// - lat/lng dentro de rango: un NaN o una latitud de 300 llegan hasta el mapa.
pub fn validar_manifiesto(bytes: &[u8]) -> Result<ManifiestoV1> {
    let m: ManifiestoV1 =
        serde_json::from_slice(bytes).context("el manifiesto no es un JSON con la forma esperada")?;

    if m.models.is_empty() {
        bail!("el manifiesto no declara ningún modelo");
    }
    let mut dims = HashMap::new();
    for (i, modelo) in m.models.iter().enumerate() {
        if modelo.id.is_empty() || modelo.version.is_empty() {
            bail!("models[{i}] tiene id o versión vacíos");
        }
        if modelo.embedding_dim == 0 {
            bail!("models[{i}].embeddingDim tiene que ser positivo");
        }
        dims.insert(modelo.id.clone(), modelo.embedding_dim as usize);
    }

    for (a, area) in m.areas.iter().enumerate() {
        for (i, img) in area.images.iter().enumerate() {
            if !nombre_seguro(&img.pano_id) {
                bail!("areas[{a}].images[{i}].panoId no es un nombre admisible");
            }
            if !(-90.0..=90.0).contains(&img.lat) {
                bail!("areas[{a}].images[{i}].lat no está entre -90 y 90");
            }
            if !(-180.0..=180.0).contains(&img.lng) {
                bail!("areas[{a}].images[{i}].lng no está entre -180 y 180");
            }
            for (modelo, v) in &img.embeddings {
                let Some(d) = dims.get(modelo) else {
                    bail!("areas[{a}].images[{i}] trae embedding de un modelo no declarado: {modelo}");
                };
                if let Some(v) = v {
                    if v.len() != *d {
                        bail!(
                            "areas[{a}].images[{i}].embeddings[{modelo}] mide {} y debería medir {d}",
                            v.len()
                        );
                    }
                }
            }
        }
    }
    Ok(m)
}

#[cfg(test)]
mod tests {
    use super::*;
    use aes_gcm::aead::{Aead, KeyInit, Payload};
    use aes_gcm::{Aes256Gcm, Nonce};

    /// Cifra igual que lo hacía la v1: `iv || authTag || ciphertext`, con el
    /// authTag SEPARADO del texto cifrado. `aes-gcm` lo devuelve pegado al
    /// final, así que hay que moverlo.
    fn cifrar_como_la_v1(claro: &[u8]) -> Vec<u8> {
        let cifra = Aes256Gcm::new_from_slice(&CLAVE_COMPARTIDA).unwrap();
        let iv = [7u8; 12];
        let mut ct = cifra.encrypt(Nonce::from_slice(&iv), Payload { msg: claro, aad: b"" }).unwrap();
        let tag = ct.split_off(ct.len() - 16);
        let mut fuera = iv.to_vec();
        fuera.extend_from_slice(&tag);
        fuera.extend_from_slice(&ct);
        fuera
    }

    #[test]
    fn el_paquete_legacy_se_descifra_y_su_manifiesto_no_se_traga_nada() {
        // Descifrado de ida y vuelta contra el formato real de la v1.
        let claro = br#"{"hola":"mundo"}"#;
        let vuelta = descifrar(&cifrar_como_la_v1(claro)).unwrap();
        assert_eq!(vuelta, claro);
        // Un authTag tocado tiene que fallar, no devolver basura.
        let mut roto = cifrar_como_la_v1(claro);
        roto[13] ^= 0xff;
        assert!(descifrar(&roto).is_err());

        // Nombres: la v1 tenía aquí una escritura de fichero arbitraria.
        // Confirmado en su código: hay panoIds reales que ACABAN en punto, así
        // que el punto suelto se acepta y lo que se rechaza es `..`.
        assert!(nombre_seguro("CAoSFkNJSE0wb2dLRUlDQWdJQ3N6SXI5QkE."));
        assert!(nombre_seguro("a-b_c.1"));
        assert!(!nombre_seguro("../../etc/passwd"));
        assert!(!nombre_seguro("a..b"));
        assert!(!nombre_seguro("a/b"));
        assert!(!nombre_seguro("a\\b"));
        assert!(!nombre_seguro(""));

        // Manifiesto bueno.
        let bueno = br#"{
          "version": 2, "exportedAt": "2026-07-28T11:04:00Z",
          "models": [{"id":"lumi-2","version":"1.0","embeddingDim":4}],
          "areas": [{"geometryWkt":"POLYGON((0 0,1 0,1 1,0 0))","images":[
            {"panoId":"pano1","heading":90,"lat":43.36,"lng":-8.41,
             "embeddings":{"lumi-2":[0.1,0.2,0.3,0.4]},"hasFile":true}
          ],"points":[]}]
        }"#;
        let m = validar_manifiesto(bueno).unwrap();
        assert_eq!(m.models[0].embedding_dim, 4);
        assert_eq!(m.areas[0].images[0].pano_id, "pano1");

        // Y todo lo que tiene que rechazar, uno por uno.
        for (que, json) in [
            ("panoId con traversal", &br#"{"version":2,"exportedAt":"x","models":[{"id":"m","version":"1","embeddingDim":2}],"areas":[{"geometryWkt":"P","images":[{"panoId":"../x","heading":0,"lat":0,"lng":0,"embeddings":{},"hasFile":true}],"points":[]}]}"#[..]),
            ("dimensión que no cuadra", &br#"{"version":2,"exportedAt":"x","models":[{"id":"m","version":"1","embeddingDim":2}],"areas":[{"geometryWkt":"P","images":[{"panoId":"p","heading":0,"lat":0,"lng":0,"embeddings":{"m":[1,2,3]},"hasFile":true}],"points":[]}]}"#[..]),
            ("modelo desconocido", &br#"{"version":2,"exportedAt":"x","models":[{"id":"m","version":"1","embeddingDim":2}],"areas":[{"geometryWkt":"P","images":[{"panoId":"p","heading":0,"lat":0,"lng":0,"embeddings":{"otro":[1,2]},"hasFile":true}],"points":[]}]}"#[..]),
            ("sin modelos", &br#"{"version":2,"exportedAt":"x","models":[],"areas":[]}"#[..]),
            ("latitud imposible", &br#"{"version":2,"exportedAt":"x","models":[{"id":"m","version":"1","embeddingDim":2}],"areas":[{"geometryWkt":"P","images":[{"panoId":"p","heading":0,"lat":91,"lng":0,"embeddings":{},"hasFile":true}],"points":[]}]}"#[..]),
            ("no es json", &b"esto no es json"[..]),
        ] {
            assert!(validar_manifiesto(json).is_err(), "debería rechazarse: {que}");
        }

        // Los topes se miran ANTES de descomprimir, sobre lo declarado.
        //
        // NOTA: el plan pedía `t.comprueba(4_000_000_000, 1_000, 500_000_000)`
        // para este caso, pero con `Topes::por_defecto()` (8 GB comprimido, 32
        // GB descomprimido) ninguno de esos tres números supera su tope: el
        // aserto `is_err()` no se sostenía. Se sube el descomprimido a 40 GB,
        // que es justo lo que el mensaje "descomprimido pasado" dice comprobar.
        let t = Topes::por_defecto();
        assert!(t.comprueba(4_000_000_000, 1_000, 40_000_000_000).is_err(), "descomprimido pasado");
        assert!(t.comprueba(1_000_000, 999_999_999, 500_000).is_err(), "demasiados ficheros");
        assert!(t.comprueba(1_000_000, 10, 500_000).is_ok());
    }
}
