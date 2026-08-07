//! Muestrear puntos a lo largo de unas calles. Puro: quién trae las calles es
//! asunto del adaptador que llame.
//!
//! Existe porque tres de los seis orígenes no tienen cobertura por tesela y hay
//! que preguntarles punto a punto. Es un ayudante de esos tres y no un concepto
//! del sistema: el cenital y las fotos sueltas no muestrean nada.

use crate::tiles::Punto;

/// Radio medio de la Tierra, en metros.
const R: f64 = 6_371_008.8;

pub fn haversine_m(a: Punto, b: Punto) -> f64 {
    let (la1, la2) = (a.lat.to_radians(), b.lat.to_radians());
    let dla = la2 - la1;
    let dlo = (b.lng - a.lng).to_radians();
    let h = (dla / 2.0).sin().powi(2) + la1.cos() * la2.cos() * (dlo / 2.0).sin().powi(2);
    2.0 * R * h.sqrt().asin()
}

/// Interpolación lineal en grados. A escala de una manzana el error de tratar
/// grados como plano es de centímetros, y al muestreo le basta con caer
/// *sobre* la calle.
fn entre(a: Punto, b: Punto, t: f64) -> Punto {
    Punto { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t }
}

/// Un punto cada `cada_m` metros a lo largo de cada polilínea.
///
/// Los duplicados se colapsan a ~1 m, y una calle más corta que el paso deja
/// **un** punto y no cero. Las dos cosas están razonadas en los tests.
pub fn muestrear(lineas: &[Vec<Punto>], cada_m: f64) -> Vec<Punto> {
    let cada_m = cada_m.max(1.0);
    let mut fuera: Vec<Punto> = Vec::new();
    fn mete(p: Punto, fuera: &mut Vec<Punto>) {
        if !fuera.iter().any(|q| haversine_m(*q, p) < 1.0) {
            fuera.push(p);
        }
    }

    for linea in lineas {
        let Some(primero) = linea.first() else { continue };
        mete(*primero, &mut fuera);
        // `sobrante` es lo ya recorrido desde el último punto emitido, para que
        // el paso sea continuo entre segmentos y no se reinicie en cada vértice.
        let mut sobrante = 0.0;
        for par in linea.windows(2) {
            let (a, b) = (par[0], par[1]);
            let largo = haversine_m(a, b);
            if largo <= f64::EPSILON {
                continue;
            }
            let mut avance = cada_m - sobrante;
            while avance <= largo {
                mete(entre(a, b, avance / largo), &mut fuera);
                avance += cada_m;
            }
            sobrante = (sobrante + largo) % cada_m;
        }
    }
    fuera
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn la_distancia_es_haversine_de_verdad() {
        // Un grado de latitud son ~111,2 km en cualquier meridiano.
        let d = haversine_m(Punto { lat: 43.0, lng: -8.0 }, Punto { lat: 44.0, lng: -8.0 });
        assert!((d - 111_195.0).abs() < 500.0, "{d}");
        assert_eq!(haversine_m(Punto { lat: 1.0, lng: 1.0 }, Punto { lat: 1.0, lng: 1.0 }), 0.0);
    }

    #[test]
    fn se_muestrea_cada_n_metros_y_el_primer_vertice_siempre_entra() {
        // Una recta de ~1112 m, muestreada cada 100 m.
        let linea = vec![Punto { lat: 43.0, lng: -8.0 }, Punto { lat: 43.01, lng: -8.0 }];
        let p = muestrear(&[linea], 100.0);
        assert!(p.len() >= 11 && p.len() <= 13, "salieron {}", p.len());
        assert_eq!(p[0], Punto { lat: 43.0, lng: -8.0 });
        for v in p.windows(2) {
            let d = haversine_m(v[0], v[1]);
            assert!(d > 80.0 && d < 120.0, "separación de {d} m");
        }
    }

    #[test]
    fn una_calle_mas_corta_que_el_paso_deja_un_punto_y_no_cero() {
        // Si no, un callejón de 20 m no se sondearía nunca y su tesela saldría
        // vacía por un artefacto del muestreo, no por falta de cobertura.
        let corta = vec![Punto { lat: 43.0, lng: -8.0 }, Punto { lat: 43.0001, lng: -8.0 }];
        assert_eq!(muestrear(&[corta], 100.0).len(), 1);
    }

    #[test]
    fn la_esquina_que_comparten_dos_calles_sale_una_sola_vez() {
        // Overpass devuelve la geometría entera de cada vía, y dos vías que se
        // cruzan traen el mismo nodo. Preguntar dos veces por el mismo punto es
        // pagar dos veces en Google.
        let a = vec![Punto { lat: 43.0, lng: -8.0 }, Punto { lat: 43.01, lng: -8.0 }];
        let b = vec![Punto { lat: 43.0, lng: -8.0 }, Punto { lat: 43.0, lng: -7.99 }];
        let p = muestrear(&[a, b], 100.0);
        let n = p.iter().filter(|q| haversine_m(**q, Punto { lat: 43.0, lng: -8.0 }) < 1.0).count();
        assert_eq!(n, 1);
    }
}
