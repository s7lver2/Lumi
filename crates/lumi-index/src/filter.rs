//! El filtro barato: lo que se puede decidir SIN abrir la imagen, con lo que el
//! propio proveedor ya dijo en su respuesta.
//!
//! Lo que cae aquí es un RESULTADO, no una avería: se anota el motivo, se salta
//! y no se reintenta nunca. Reintentar una foto de un plato de comida la
//! seguiría dejando siendo un plato de comida.
//!
//! Lo que sobrevive va a la revisión por excepción, donde una persona descarta
//! lo que una regla no puede ver.

use crate::manifest::Tipo;

/// Lo que hace falta saber de una foto para juzgarla sin abrirla.
#[derive(Debug, Clone, PartialEq)]
pub struct Candidata {
    pub ancho: u32,
    pub alto: u32,
    /// Lo que el proveedor declara sobre su geoetiqueta. `None` es «no lo dijo»
    /// y no es motivo de descarte.
    pub precision_metros: Option<f64>,
    /// Categorías o etiquetas del proveedor. Vacío en las capturas sistemáticas.
    pub categorias: Vec<String>,
    pub licencia: Option<String>,
    pub tipo: Tipo,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Veredicto {
    Pasa,
    Fuera(String),
}

/// Palabras que en Commons y en Flickr marcan un interior con bastante
/// fiabilidad. Deliberadamente cortas: una lista larga empieza a tirar material
/// bueno, y para eso ya está la revisión.
const INTERIOR: [&str; 6] = ["interior", "indoor", "inside of", "museum of", "nave of", "altar"];

pub struct Reglas {
    pub lado_minimo: u32,
    pub proporcion_maxima: f64,
    pub precision_maxima_m: f64,
}

impl Reglas {
    /// Valores conservadores: descartan lo claramente inservible y dejan pasar
    /// lo dudoso, porque lo dudoso tiene una persona detrás en la revisión y lo
    /// descartado no la tiene.
    pub fn por_defecto() -> Self {
        Self {
            // Por debajo de 640 px de lado no hay fachada que emparejar.
            lado_minimo: 640,
            // 4:1. Un panorama de calle legítimo llega a 2:1; 13:1 es un recorte.
            proporcion_maxima: 4.0,
            // 100 m es media manzana: más allá la coordenada no localiza nada.
            precision_maxima_m: 100.0,
        }
    }

    pub fn evaluar(&self, c: &Candidata) -> Veredicto {
        // La proporción se juzga ANTES que el tamaño: un recorte panorámico
        // como 4000×300 tiene un lado por debajo del mínimo, pero lo que lo
        // descarta es ser un recorte, no ser pequeño.
        if c.alto > 0 {
            let p = (c.ancho as f64 / c.alto as f64).max(c.alto as f64 / c.ancho as f64);
            if p > self.proporcion_maxima {
                return Veredicto::Fuera(format!("proporción {p:.1}:1, es un recorte"));
            }
        }
        if c.ancho < self.lado_minimo || c.alto < self.lado_minimo {
            return Veredicto::Fuera(format!(
                "demasiado pequeña: {}×{}, el mínimo es {} de lado",
                c.ancho, c.alto, self.lado_minimo
            ));
        }
        if let Some(m) = c.precision_metros {
            if m > self.precision_maxima_m {
                return Veredicto::Fuera(format!("geoetiqueta imprecisa: ±{m:.0} m"));
            }
        }
        // Las categorías solo existen en las fotos sueltas. Una panorámica de
        // calle no trae ninguna, y aplicarle esta regla no diría nada.
        if c.tipo == Tipo::Suelta {
            let texto = c.categorias.join(" ").to_lowercase();
            if let Some(p) = INTERIOR.iter().find(|p| texto.contains(**p)) {
                return Veredicto::Fuera(format!("categoría de interior: «{p}»"));
            }
        }
        if let Some(l) = &c.licencia {
            let l = l.to_ascii_uppercase();
            if l.contains("-ND") || l.contains("-NC") {
                return Veredicto::Fuera(format!("licencia que no permite publicar: {l}"));
            }
        }
        Veredicto::Pasa
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::manifest::Tipo;

    fn buena() -> Candidata {
        Candidata {
            ancho: 2048,
            alto: 1536,
            precision_metros: Some(8.0),
            categorias: vec!["Streets in Lugo".into()],
            licencia: Some("CC BY-SA 4.0".into()),
            tipo: Tipo::Suelta,
        }
    }

    #[test]
    fn una_foto_buena_pasa() {
        assert_eq!(Reglas::por_defecto().evaluar(&buena()), Veredicto::Pasa);
    }

    #[test]
    fn cada_regla_descarta_con_su_motivo_y_el_motivo_es_legible() {
        let r = Reglas::por_defecto();

        let pequena = Candidata { ancho: 320, alto: 240, ..buena() };
        let Veredicto::Fuera(m) = r.evaluar(&pequena) else { panic!("debería caer") };
        assert!(m.contains("pequeña"), "{m}");

        // 4000×300 es un panorama recortado: relación 13:1, inservible.
        let tira = Candidata { ancho: 4000, alto: 300, ..buena() };
        let Veredicto::Fuera(m) = r.evaluar(&tira) else { panic!("debería caer") };
        assert!(m.contains("proporción"), "{m}");

        let imprecisa = Candidata { precision_metros: Some(340.0), ..buena() };
        let Veredicto::Fuera(m) = r.evaluar(&imprecisa) else { panic!("debería caer") };
        assert!(m.contains("geoetiqueta"), "{m}");

        let dentro = Candidata { categorias: vec!["Interiors of churches".into()], ..buena() };
        let Veredicto::Fuera(m) = r.evaluar(&dentro) else { panic!("debería caer") };
        assert!(m.contains("interior"), "{m}");

        let nd = Candidata { licencia: Some("CC BY-ND 2.0".into()), ..buena() };
        let Veredicto::Fuera(m) = r.evaluar(&nd) else { panic!("debería caer") };
        assert!(m.contains("licencia"), "{m}");
    }

    #[test]
    fn sin_precision_declarada_no_se_descarta() {
        // Commons a menudo no dice la precisión. Descartar por lo que el
        // proveedor no dijo tiraría material bueno: eso lo juzga la persona en
        // la revisión, no una regla.
        let c = Candidata { precision_metros: None, ..buena() };
        assert_eq!(Reglas::por_defecto().evaluar(&c), Veredicto::Pasa);
    }

    #[test]
    fn a_las_capturas_sistematicas_no_se_les_aplica_lo_de_las_categorias() {
        // Una panorámica de calle no tiene categorías y su proporción es
        // legítimamente ancha. Las reglas de foto suelta no le pegan.
        let pano = Candidata {
            ancho: 4096,
            alto: 2048,
            precision_metros: None,
            categorias: vec![],
            licencia: Some("CC BY-SA 4.0".into()),
            tipo: Tipo::Calle,
        };
        assert_eq!(Reglas::por_defecto().evaluar(&pano), Veredicto::Pasa);
    }
}
