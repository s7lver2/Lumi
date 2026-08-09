//! Repartir las quadkeys de un paquete en trozos que quepan en un asset.

use serde::{Deserialize, Serialize};

/// Por debajo del límite de 2 GiB por asset de release de GitHub, con margen
/// para la cabecera de cifrado y para que un redondeo no tire una subida de
/// dos horas.
pub const TOPE_TROZO_BYTES: u64 = 1_800_000_000;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Trozo {
    /// La quadkey más corta que contiene a todas las de dentro. Nombra el
    /// asset, y es lo que hace que un trozo se pueda describir por su zona en
    /// vez de por un número de orden que no significa nada.
    pub prefijo: String,
    pub quadkeys: Vec<String>,
    pub bytes: u64,
}

/// Las quadkeys ordenadas alfabéticamente están ordenadas espacialmente —son
/// una curva Z—, así que acumular en orden ya produce trozos vecinos entre sí
/// sin tener que calcular ninguna distancia.
pub fn trocear(pesos: &[(String, u64)], tope: u64) -> Vec<Trozo> {
    let mut ordenadas: Vec<&(String, u64)> = pesos.iter().collect();
    ordenadas.sort_by(|a, b| a.0.cmp(&b.0));

    let mut trozos: Vec<Trozo> = Vec::new();
    let mut actual: Vec<String> = Vec::new();
    let mut bytes = 0u64;

    for (qk, b) in ordenadas {
        if !actual.is_empty() && bytes + b > tope {
            trozos.push(cerrar(std::mem::take(&mut actual), bytes));
            bytes = 0;
        }
        actual.push(qk.clone());
        bytes += b;
    }
    if !actual.is_empty() {
        trozos.push(cerrar(actual, bytes));
    }
    trozos
}

fn cerrar(quadkeys: Vec<String>, bytes: u64) -> Trozo {
    Trozo { prefijo: prefijo_comun(&quadkeys), quadkeys, bytes }
}

fn prefijo_comun(qs: &[String]) -> String {
    let Some(primera) = qs.first() else { return String::new() };
    let mut largo = primera.len();
    for q in &qs[1..] {
        largo = largo.min(
            primera.chars().zip(q.chars()).take_while(|(a, b)| a == b).count(),
        );
    }
    primera[..largo].to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pesos(v: &[(&str, u64)]) -> Vec<(String, u64)> {
        v.iter().map(|(q, b)| (q.to_string(), *b)).collect()
    }

    #[test]
    fn ningun_trozo_pasa_del_tope() {
        let p = pesos(&[("0313101", 600), ("0313102", 600), ("0313103", 600), ("0313110", 600)]);
        for t in trocear(&p, 1_000) {
            assert!(t.bytes <= 1_000, "trozo de {} bytes", t.bytes);
        }
    }

    #[test]
    fn cada_quadkey_aparece_exactamente_una_vez() {
        let p = pesos(&[("0313101", 600), ("0313102", 600), ("0313103", 600)]);
        let mut vistas: Vec<String> =
            trocear(&p, 1_000).into_iter().flat_map(|t| t.quadkeys).collect();
        vistas.sort();
        assert_eq!(vistas, vec!["0313101", "0313102", "0313103"]);
    }

    // Una tesela sola más grande que el tope no se puede partir más: el
    // troceado es por geografía, y media tesela no es una unidad instalable.
    // Va sola en su trozo aunque lo desborde, y quien la suba se encontrará
    // con el límite del proveedor — que es un problema honesto y visible.
    #[test]
    fn una_tesela_mas_grande_que_el_tope_va_sola() {
        let p = pesos(&[("0313101", 100), ("0313102", 5_000), ("0313103", 100)]);
        let ts = trocear(&p, 1_000);
        let gorda = ts.iter().find(|t| t.bytes == 5_000).expect("falta el trozo gordo");
        assert_eq!(gorda.quadkeys, vec!["0313102"]);
    }

    #[test]
    fn el_prefijo_nombra_la_zona_comun() {
        let p = pesos(&[("03131010", 10), ("03131011", 10)]);
        assert_eq!(trocear(&p, 1_000)[0].prefijo, "0313101");
    }

    #[test]
    fn sin_quadkeys_no_hay_trozos() {
        assert!(trocear(&[], 1_000).is_empty());
    }
}
