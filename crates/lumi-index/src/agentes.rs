//! Un agente mira la foto de consulta y dice algo sobre ella. Este módulo es
//! lo que se hace con lo que dijo.
//!
//! Dos reglas que no se negocian, y las dos dicen lo mismo —nunca cero
//! resultados por culpa de una conjetura:
//!
//! 1. **Un candidato con `UMBRAL_INLIERS` correspondencias o más no lo tumba
//!    ningún agente.** Cientos de puntos que RANSAC ha confirmado son mejor
//!    prueba que lo que un modelo cree leer en un cartel. Sobre los que la
//!    geometría NO confirmó, el agente sí decide: ahí es la única señal que hay.
//! 2. **Si las restricciones vacían la lista, se devuelve sin filtrar y se
//!    dice.** Es la postura que el 5b tomó cuando ningún verificador llegaba al
//!    umbral.
//!
//! Y una tercera que es de la misma familia: el que no sabe no castiga. Un
//! agente por debajo de su umbral de confianza, una etiqueta que no está en su
//! mapa, o un candidato cuya coordenada no se pudo resolver, no mueven nada.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use crate::arbitro::UMBRAL_INLIERS;
use crate::geo::Atributos;

/// La ficha de `registros/agentes/<id>.json`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Agente {
    pub id: String,
    pub nombre: String,
    /// `vlm`, `ocr` o `profundidad`. Decide qué motor lo atiende dentro del
    /// trabajador; en Rust solo se arrastra.
    pub motor: String,
    /// Lo que se le pregunta al VLM. Vacío en `ocr` y `profundidad`, que no
    /// preguntan nada: miran.
    #[serde(default)]
    pub pregunta: String,
    /// El conjunto cerrado de respuestas válidas.
    pub etiquetas: Vec<String>,
    /// `filtra` o `describe`.
    pub tipo: String,
    /// `pais`, `lado_conduccion` o `clima_koppen`. Vacío en los descriptivos.
    #[serde(default)]
    pub restriccion: String,
    /// Etiqueta → valores del atributo que la cumplen. Vive en el JSON y no en
    /// el código porque «qué países escriben en griego» es un dato que se
    /// corrige editando un fichero, no recompilando un daemon.
    #[serde(default)]
    pub mapa: HashMap<String, Vec<String>>,
    pub umbral_confianza: f64,
}

/// Lo que un agente contestó sobre la foto de consulta.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Veredicto {
    pub agente: String,
    pub etiqueta: String,
    pub confianza: f64,
}

/// Qué le pasa a un candidato. `factor` es multiplicativo sobre su peso; `0.0`
/// significa que se cae, y entonces `motivo` trae la frase que el investigador
/// va a leer.
#[derive(Debug, Clone, PartialEq)]
pub struct Ajuste {
    pub factor: f64,
    pub motivo: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Resultado {
    /// Uno por candidato, en el mismo orden en que entraron.
    pub ajustes: Vec<Ajuste>,
    /// Saltó la regla 2: todo se caía, así que no se filtró nada. El cliente
    /// lo dice en la cabecera del panel.
    pub sin_filtrar: bool,
}

/// Los motores que hacen falta para que estos agentes puedan correr de
/// verdad — deduplicados por CLASE de motor (`vlm`/`ocr`/`profundidad`), no
/// por agente: dos agentes que comparten motor (p. ej. `clima-aparente` y
/// `hora-sombras`, ambos `vlm`) comparten una sola instalación, no dos.
///
/// Existe porque "Lumi Mini instalado" solo comprobaba `recuperacion` y
/// `geometricos` — un nivel podía marcarse `listo` con sus cuatro agentes
/// mudos porque a ninguno de sus motores le llegó nunca a faltar en esa
/// cuenta. El id que se devuelve es el del PRIMER motor de esa clase que
/// exista en el registro: hoy hay uno por clase, y si algún día hay más,
/// cualquiera de ellos basta para que el agente deje de callar.
pub fn motores_de_agentes(
    ids_agentes: &[String],
    agentes: &[crate::agentes::Agente],
    motores: &[crate::registro::Motor],
) -> Vec<String> {
    let clases: std::collections::HashSet<&str> = ids_agentes
        .iter()
        .filter_map(|id| agentes.iter().find(|a| &a.id == id))
        .map(|a| a.motor.as_str())
        .collect();
    let mut fuera = Vec::new();
    for clase in clases {
        if let Some(m) = motores.iter().find(|m| m.clase == clase) {
            fuera.push(m.id.clone());
        }
    }
    fuera.sort();
    fuera
}

pub fn aplicar(
    agentes: &[Agente],
    veredictos: &[Veredicto],
    candidatos: &[(Atributos, Option<u32>)],
) -> Resultado {
    let mut ajustes: Vec<Ajuste> = Vec::with_capacity(candidatos.len());

    for (atributos, inliers) in candidatos {
        let mut motivos: Vec<String> = Vec::new();

        for v in veredictos {
            let Some(a) = agentes.iter().find(|a| a.id == v.agente) else { continue };
            if a.tipo != "filtra" {
                continue;
            }
            if v.confianza < a.umbral_confianza {
                continue; // se abstiene
            }
            let Some(permitidos) = a.mapa.get(&v.etiqueta) else { continue };
            let Some(valor) = atributos.de(&a.restriccion) else { continue };
            if permitidos.iter().any(|p| p == valor) {
                continue; // cumple
            }
            motivos.push(format!("{} dice «{}», y este candidato es {valor}", a.nombre, v.etiqueta));
        }

        // Regla 1: la geometría gana. Se comprueba DESPUÉS de recorrer los
        // agentes y no antes, para que el bucle siga siendo el mismo y la
        // excepción esté escrita en un solo sitio.
        let protegido = inliers.is_some_and(|n| n >= UMBRAL_INLIERS);
        if motivos.is_empty() || protegido {
            ajustes.push(Ajuste { factor: 1.0, motivo: None });
        } else {
            ajustes.push(Ajuste { factor: 0.0, motivo: Some(motivos.join("; ")) });
        }
    }

    // Regla 2.
    let sin_filtrar = !ajustes.is_empty() && ajustes.iter().all(|a| a.factor == 0.0);
    if sin_filtrar {
        for a in &mut ajustes {
            a.factor = 1.0;
            a.motivo = None;
        }
    }

    Resultado { ajustes, sin_filtrar }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn idioma() -> Agente {
        Agente {
            id: "idioma".into(),
            nombre: "Idioma del cartel".into(),
            motor: "ocr".into(),
            pregunta: String::new(),
            etiquetas: vec!["griego".into(), "latino".into()],
            tipo: "filtra".into(),
            restriccion: "pais".into(),
            mapa: [("griego".to_string(), vec!["GRC".to_string(), "CYP".to_string()])]
                .into_iter()
                .collect(),
            umbral_confianza: 0.6,
        }
    }

    fn matricula() -> Agente {
        Agente {
            id: "matricula".into(),
            nombre: "Matrícula".into(),
            motor: "vlm".into(),
            pregunta: "…".into(),
            etiquetas: vec!["banda azul UE".into()],
            tipo: "filtra".into(),
            restriccion: "pais".into(),
            mapa: [("banda azul UE".to_string(), vec!["GRC".to_string(), "ESP".to_string()])]
                .into_iter()
                .collect(),
            umbral_confianza: 0.6,
        }
    }

    fn hora() -> Agente {
        Agente {
            id: "hora".into(),
            nombre: "Hora aparente".into(),
            motor: "vlm".into(),
            pregunta: "…".into(),
            etiquetas: vec!["mediodía".into()],
            tipo: "describe".into(),
            restriccion: String::new(),
            mapa: Default::default(),
            umbral_confianza: 0.5,
        }
    }

    fn en(iso: &str) -> Atributos {
        Atributos { pais: Some(iso.into()), lado: None, koppen: None }
    }

    fn dice(agente: &str, etiqueta: &str, confianza: f64) -> Veredicto {
        Veredicto { agente: agente.into(), etiqueta: etiqueta.into(), confianza }
    }

    #[test]
    fn sin_veredictos_no_se_toca_nada() {
        let r = aplicar(&[idioma()], &[], &[(en("NOR"), None), (en("GRC"), None)]);
        assert!(r.ajustes.iter().all(|a| a.factor == 1.0 && a.motivo.is_none()));
        assert!(!r.sin_filtrar);
    }

    #[test]
    fn el_que_incumple_y_no_tiene_geometria_se_cae() {
        let r = aplicar(
            &[idioma()],
            &[dice("idioma", "griego", 0.9)],
            &[(en("GRC"), None), (en("NOR"), None)],
        );
        assert_eq!(r.ajustes[0].factor, 1.0);
        assert_eq!(r.ajustes[1].factor, 0.0);
        assert!(r.ajustes[1].motivo.as_deref().unwrap().contains("griego"));
        assert!(!r.sin_filtrar);
    }

    #[test]
    fn con_inliers_de_sobra_la_geometria_gana_y_el_agente_calla() {
        // Cuatrocientas correspondencias confirmadas por RANSAC contra la
        // conjetura de un OCR sobre un cartel: gana la geometría.
        let r = aplicar(
            &[idioma()],
            &[dice("idioma", "griego", 0.9)],
            &[(en("NOR"), Some(400))],
        );
        assert_eq!(r.ajustes[0].factor, 1.0);
        assert!(r.ajustes[0].motivo.is_none());
    }

    #[test]
    fn justo_en_el_umbral_ya_protege() {
        let r = aplicar(
            &[idioma()],
            &[dice("idioma", "griego", 0.9)],
            &[(en("NOR"), Some(crate::arbitro::UMBRAL_INLIERS))],
        );
        assert_eq!(r.ajustes[0].factor, 1.0);
    }

    #[test]
    fn una_abstencion_no_repondera_nada() {
        // 0,4 está por debajo del umbral de 0,6 del agente.
        let r = aplicar(
            &[idioma()],
            &[dice("idioma", "griego", 0.4)],
            &[(en("NOR"), None)],
        );
        assert_eq!(r.ajustes[0].factor, 1.0);
        assert!(r.ajustes[0].motivo.is_none());
    }

    #[test]
    fn un_agente_descriptivo_nunca_filtra() {
        let r = aplicar(&[hora()], &[dice("hora", "mediodía", 1.0)], &[(en("NOR"), None)]);
        assert_eq!(r.ajustes[0].factor, 1.0);
    }

    #[test]
    fn si_se_caen_todos_se_devuelve_sin_filtrar_y_se_dice() {
        let r = aplicar(
            &[idioma()],
            &[dice("idioma", "griego", 0.9)],
            &[(en("NOR"), None), (en("SWE"), None)],
        );
        assert!(r.sin_filtrar);
        assert!(r.ajustes.iter().all(|a| a.factor == 1.0));
    }

    #[test]
    fn dos_restricciones_de_pais_se_intersecan_y_no_se_promedian() {
        // Grecia cumple las dos; España cumple la matrícula y no el idioma, y
        // eso basta para caerse: no hay media entre «sí» y «no».
        let r = aplicar(
            &[idioma(), matricula()],
            &[dice("idioma", "griego", 0.9), dice("matricula", "banda azul UE", 0.9)],
            &[(en("GRC"), None), (en("ESP"), None)],
        );
        assert_eq!(r.ajustes[0].factor, 1.0);
        assert_eq!(r.ajustes[1].factor, 0.0);
    }

    #[test]
    fn no_saber_donde_cae_un_candidato_no_lo_castiga() {
        // Sin `paises.json` puesto, `pais` es None para todos. Nadie se cae.
        let sin = Atributos::default();
        let r = aplicar(&[idioma()], &[dice("idioma", "griego", 0.9)], &[(sin, None)]);
        assert_eq!(r.ajustes[0].factor, 1.0);
        assert!(!r.sin_filtrar);
    }

    #[test]
    fn una_etiqueta_que_no_esta_en_el_mapa_no_hace_nada() {
        // Un VLM que contesta algo que no se le ofreció: es una abstención,
        // no un error que tumbe el análisis.
        let r = aplicar(&[idioma()], &[dice("idioma", "klingon", 0.99)], &[(en("NOR"), None)]);
        assert_eq!(r.ajustes[0].factor, 1.0);
    }

    fn motor(id: &str, clase: &str) -> crate::registro::Motor {
        crate::registro::Motor {
            id: id.into(), nombre: id.into(), clase: clase.into(), licencia: "Apache-2.0".into(),
            fichero_url: String::new(), licencia_url: String::new(), licencia_texto: String::new(),
            puerta: None, gestion_propia: false, hf_repo: String::new(),
        }
    }

    #[test]
    fn dos_agentes_del_mismo_motor_piden_una_sola_instalacion() {
        // clima-aparente y hora-sombras son los dos "vlm" del registro real.
        let vlm1 = Agente { id: "clima".into(), motor: "vlm".into(), ..idioma() };
        let vlm2 = Agente { id: "hora".into(), motor: "vlm".into(), ..idioma() };
        let necesarios = motores_de_agentes(
            &["clima".into(), "hora".into()],
            &[vlm1, vlm2],
            &[motor("qwen3-vl", "vlm")],
        );
        assert_eq!(necesarios, vec!["qwen3-vl".to_string()]);
    }

    #[test]
    fn motores_de_clases_distintas_se_piden_todos() {
        let necesarios = motores_de_agentes(
            &["idioma".into(), "clima".into()],
            &[idioma(), Agente { id: "clima".into(), motor: "vlm".into(), ..idioma() }],
            &[motor("paddleocr", "ocr"), motor("qwen3-vl", "vlm")],
        );
        assert_eq!(necesarios, vec!["paddleocr".to_string(), "qwen3-vl".to_string()]);
    }

    #[test]
    fn un_agente_sin_motor_registrado_no_pide_nada_que_no_exista() {
        // Si el registro de motores no trae la clase que un agente necesita,
        // no se inventa un id — la cuenta simplemente no la incluye, y por
        // tanto tampoco puede marcarse "instalada" nunca.
        let necesarios = motores_de_agentes(&["idioma".into()], &[idioma()], &[motor("qwen3-vl", "vlm")]);
        assert!(necesarios.is_empty());
    }
}
