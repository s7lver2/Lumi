//! Repartir las quadkeys de un paquete en trozos que quepan en un asset.

use serde::{Deserialize, Serialize};

/// Por debajo del límite de 2 GiB por asset de release de GitHub, con margen
/// para la cabecera de cifrado y para que un redondeo no tire una subida de
/// dos horas.
pub const TOPE_TROZO_BYTES: u64 = 1_800_000_000;

/// El límite DURO del proveedor: 2 GiB por asset de release en GitHub. Es
/// distinto de `TOPE_TROZO_BYTES` a propósito — aquel es el objetivo al
/// agrupar, este es la pared contra la que se estrella una subida.
pub const TOPE_ASSET_BYTES: u64 = 2 * 1024 * 1024 * 1024;

/// Los trozos que NO caben en un asset del proveedor.
///
/// `trocear` agrupa quadkeys hasta `tope`, pero una quadkey SOLA más pesada
/// que el tope no se puede partir más (media tesela no es una unidad
/// instalable), así que va sola en su trozo aunque lo desborde. Eso está
/// asumido desde el principio; lo que faltaba era DECIRLO a tiempo.
///
/// Sin esto, el desbordamiento solo se descubría subiendo: el paquete se
/// empaquetaba en memoria, se cifraba, se intentaba subir tres veces y el
/// operador acababa viendo «no se pudo subir tras tres intentos» después de
/// horas, sin ninguna pista de que la causa era el tamaño y de que reintentar
/// no iba a arreglarlo nunca. Caso real: la tesela del centro de León con
/// 2.910 imágenes pesaba 5,6 GB, casi el triple del límite.
pub fn desbordados(trozos: &[Trozo], tope_asset: u64) -> Vec<&Trozo> {
    trozos.iter().filter(|t| t.bytes > tope_asset).collect()
}

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
    // Va sola en su trozo aunque lo desborde. Que eso pase sigue siendo
    // legítimo; lo que NO puede pasar es que se descubra subiendo — para eso
    // está `desbordados`, ver el test de abajo.
    #[test]
    fn una_tesela_mas_grande_que_el_tope_va_sola() {
        let p = pesos(&[("0313101", 100), ("0313102", 5_000), ("0313103", 100)]);
        let ts = trocear(&p, 1_000);
        let gorda = ts.iter().find(|t| t.bytes == 5_000).expect("falta el trozo gordo");
        assert_eq!(gorda.quadkeys, vec!["0313102"]);
    }

    /// El caso real que costó una publicación entera: la tesela del centro de
    /// León pesaba 5,6 GB y el límite de GitHub son 2 GiB. `trocear` la deja
    /// sola (no puede hacer otra cosa) y `desbordados` es quien lo señala
    /// ANTES de empaquetar 5,6 GB en memoria y subirlos tres veces.
    #[test]
    fn una_tesela_que_no_cabe_en_un_asset_se_señala() {
        let p = pesos(&[("0313101", 100), ("0313102", 5_000), ("0313103", 100)]);
        let ts = trocear(&p, 1_000);
        let fuera = desbordados(&ts, 2_000);
        assert_eq!(fuera.len(), 1);
        assert_eq!(fuera[0].quadkeys, vec!["0313102"]);
    }

    /// Y lo que sí cabe no se señala: un trozo agrupado hasta el tope normal
    /// está por debajo del límite duro por construcción.
    #[test]
    fn lo_que_cabe_no_se_señala() {
        let p = pesos(&[("0313101", 600), ("0313102", 600), ("0313103", 600)]);
        assert!(desbordados(&trocear(&p, 1_000), 2_000).is_empty());
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
