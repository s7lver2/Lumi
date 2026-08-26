//! Verificación de integridad de artefactos descargados — la única pieza
//! de este crate que es lógica pura de verdad, así que es la que lleva
//! tests (ver Global Constraints).

use sha2::{Digest, Sha256};

pub fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    format!("{:x}", hasher.finalize())
}

/// Compara sin importar mayúsculas/minúsculas — el manifiesto puede traer
/// el hash en cualquiera de las dos.
pub fn verificar_sha256(bytes: &[u8], esperado: &str) -> bool {
    sha256_hex(bytes).eq_ignore_ascii_case(esperado)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sha256_hex_de_cadena_vacia_es_el_valor_conocido() {
        assert_eq!(
            sha256_hex(b""),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
    }

    #[test]
    fn verificar_sha256_acepta_mayusculas_o_minusculas() {
        let hash = sha256_hex(b"hola");
        assert!(verificar_sha256(b"hola", &hash));
        assert!(verificar_sha256(b"hola", &hash.to_uppercase()));
    }

    #[test]
    fn verificar_sha256_rechaza_hash_distinto() {
        assert!(!verificar_sha256(b"hola", "0000000000000000000000000000000000000000000000000000000000000000"));
    }
}
