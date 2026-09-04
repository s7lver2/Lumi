//! Quién gana cuando varios verificadores geométricos miran el mismo candidato.
//!
//! El árbitro NO es un peso aprendido: es el número de correspondencias que
//! sobreviven a RANSAC. Se elige así porque es la única señal que no hay que
//! entrenar, que significa lo mismo para un matcher denso y para uno disperso,
//! y que un investigador puede entender sin creerse un número mágico.
//!
//! No se promedian coordenadas. Promediar una respuesta buena con una mala da
//! una tercera que no es ninguna de las dos.

/// Lo que contesta un verificador sobre un candidato.
#[derive(Debug, Clone, PartialEq)]
pub struct Veredicto {
    pub verificador: String,
    pub inliers: u32,
    pub lat: f64,
    pub lng: f64,
}

/// El verificador que se lleva el candidato, con su respaldo.
#[derive(Debug, Clone, PartialEq)]
pub struct Ganador {
    pub verificador: String,
    pub inliers: u32,
    pub lat: f64,
    pub lng: f64,
}

/// Calibrado contra 16 pares reales del corpus de prueba (verificados con
/// `USAC_MAGSAC`, ver `workers/lumi_verify.py::_inliers`), emparejados por
/// distancia GPS: 8 pares a <7 m (casi con toda seguridad la misma fachada)
/// y 8 a >500 m (sitios distintos). Positivos: 126-2920 inliers. Negativos:
/// 55-143. Un solo caso raro solapa (un par a más de 1 km dio 143) -- el
/// umbral se pone con margen POR ENCIMA de todos los negativos medidos, no a
/// medio camino: en una herramienta forense fallar hacia «no verificado» es
/// seguro (`Hipotesis::inliers` en `None` no inventa nada), fallar hacia un
/// falso positivo no lo es. Con esto se pierde el positivo más débil de los
/// 16 (126, a 1.9 m) pero se rechazan los 8 negativos sin excepción. Un
/// primer intento con 4 fotos turísticas de `Parskatt/RoMa` (25→130) ya
/// mejoraba mucho el valor a ciegas anterior (25), pero con datos reales del
/// propio corpus el margen sano está más alto. Sigue sin ser un conjunto de
/// validación real: el 5c lo revisará con métricas delante. Va como
/// constante con nombre y NO como ajuste de configuración — un ajuste invita
/// a que cada instalación tenga el suyo y a que dos servidores den
/// respuestas distintas al mismo caso, que en una herramienta forense es lo
/// último que se quiere.
pub const UMBRAL_INLIERS: u32 = 200;

/// `None` significa «este candidato se cae»: ninguno llegó al umbral.
pub fn arbitrar(veredictos: &[Veredicto]) -> Option<Ganador> {
    veredictos
        .iter()
        .filter(|v| v.inliers >= UMBRAL_INLIERS)
        // El desempate por nombre es deliberado: el orden en que lleguen los
        // veredictos no puede decidir la respuesta de un informe.
        .max_by(|a, b| a.inliers.cmp(&b.inliers).then(b.verificador.cmp(&a.verificador)))
        .map(|v| Ganador {
            verificador: v.verificador.clone(),
            inliers: v.inliers,
            lat: v.lat,
            lng: v.lng,
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn v(nombre: &str, inliers: u32, lat: f64) -> Veredicto {
        Veredicto { verificador: nombre.into(), inliers, lat, lng: 100.5 }
    }

    #[test]
    fn gana_el_de_mas_inliers_y_no_se_promedia_nada() {
        // El disperso saca 9 donde el denso saca 412. Promediar las dos
        // coordenadas daria una tercera que no es ninguna de las dos.
        let ganador = arbitrar(&[
            v("lightglue-aliked", 9, 40.0),
            v("roma-v2", 412, 13.75),
            v("roma", 338, 13.76),
        ])
        .unwrap();
        assert_eq!(ganador.verificador, "roma-v2");
        assert_eq!(ganador.inliers, 412);
        assert_eq!(ganador.lat, 13.75, "la coordenada es la del ganador, tal cual");
    }

    #[test]
    fn si_ninguno_llega_al_umbral_el_candidato_se_cae() {
        assert!(arbitrar(&[v("roma-v2", 17, 3.0), v("roma", 12, 3.0)]).is_none());
    }

    #[test]
    fn justo_en_el_umbral_cuenta() {
        let g = arbitrar(&[v("roma", UMBRAL_INLIERS, 3.0)]).unwrap();
        assert_eq!(g.inliers, UMBRAL_INLIERS);
    }

    #[test]
    fn sin_veredictos_no_hay_ganador() {
        assert!(arbitrar(&[]).is_none());
    }

    #[test]
    fn el_empate_se_rompe_por_nombre_y_no_al_azar() {
        let a = arbitrar(&[v("roma", UMBRAL_INLIERS, 1.0), v("efficient-loftr", UMBRAL_INLIERS, 2.0)]).unwrap();
        let b = arbitrar(&[v("efficient-loftr", UMBRAL_INLIERS, 2.0), v("roma", UMBRAL_INLIERS, 1.0)]).unwrap();
        assert_eq!(a.verificador, b.verificador, "el orden de entrada no puede decidir");
    }
}
