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
///
/// Esta calibración es de `tiny-roma` (es lo único que corría cuando se
/// midió, el 04-09, antes de que Pro cargara `roma` de verdad el mismo día
/// por la tarde) y sigue siendo el valor por defecto para cualquier
/// verificador que no declare el suyo (`Verificador::umbral_inliers`). No
/// sirve para `roma`/`roma-v2`: el `roma` completo corre denso con
/// *upsample* a 864×864 y produce correspondencias en otro orden de
/// magnitud — medido en producción, 897 y 1742 inliers sobre candidatos que
/// NO eran el sitio correcto (12 de 12 y 10 de 12 "verificados" a más de
/// 1 km de distancia entre sí). Esos dos verificadores declaran su propio
/// umbral en su ficha de registro, puesto por ahora por encima de esos dos
/// falsos positivos con margen — mismo criterio de "por encima de lo peor
/// medido, no a medio camino" que fijó este número, pero con solo dos
/// puntos de datos (ambos negativos) en vez de 16. Repetir el proceso de
/// arriba con pares reales verificados con `roma` (no con `tiny-roma`) es
/// trabajo pendiente, igual que lo fue este número antes del commit
/// `078cae0`.
pub const UMBRAL_INLIERS: u32 = 200;

/// `None` significa «este candidato se cae»: ninguno llegó al umbral.
///
/// Compatibilidad: usa `UMBRAL_INLIERS` para todos, como si ningún
/// verificador declarara el suyo propio. Ver `arbitrar_con_umbrales` para el
/// caso real, donde cada verificador puede traer el suyo.
pub fn arbitrar(veredictos: &[Veredicto]) -> Option<Ganador> {
    arbitrar_con_umbrales(veredictos, &|_| UMBRAL_INLIERS)
}

/// Igual que `arbitrar`, pero el umbral se pregunta por nombre de
/// verificador en vez de ser el mismo número para todos.
///
/// Necesario porque `UMBRAL_INLIERS` se calibró contra `tiny-roma` (positivos
/// 126-2920, negativos 55-143) y el `roma` completo produce correspondencias
/// en otro orden de magnitud (denso, con *upsample* a 864×864): en
/// producción, `tiny-roma` dio 78 inliers sobre la catedral de León (por
/// debajo incluso de los negativos de `tiny-roma`, correctamente descartado)
/// mientras que `roma` dio 897-1742 sobre el mismo tipo de error — un solo
/// número no discrimina para los dos, y con el umbral compartido `roma`
/// aprobaba 12 de 12 candidatos repartidos por 3 km de ciudad.
pub fn arbitrar_con_umbrales(veredictos: &[Veredicto], umbral_de: &dyn Fn(&str) -> u32) -> Option<Ganador> {
    veredictos
        .iter()
        .filter(|v| v.inliers >= umbral_de(&v.verificador))
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

    #[test]
    fn cada_verificador_puede_traer_su_propio_umbral() {
        // Caso real de producción: 1742 inliers de "roma" sobre un candidato
        // que NO era el sitio correcto. Con el umbral compartido (200) eso
        // aprobaba; con el umbral propio de "roma" (más alto), se cae, y un
        // "lightglue-aliked" que sí llega a SU umbral (más bajo) puede seguir
        // ganando -- el umbral alto de uno no penaliza al otro.
        let umbral_de = |id: &str| if id == "roma" { 3000 } else { UMBRAL_INLIERS };
        assert!(
            arbitrar_con_umbrales(&[v("roma", 1742, 42.60)], &umbral_de).is_none(),
            "1742 no llega al umbral propio de roma (3000)",
        );
        let g = arbitrar_con_umbrales(&[v("roma", 1742, 42.60), v("lightglue-aliked", 250, 42.59)], &umbral_de)
            .unwrap();
        assert_eq!(g.verificador, "lightglue-aliked", "roma se cae por su propio umbral, lightglue-aliked no");
    }
}
