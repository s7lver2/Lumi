//! Un agente mira la foto de consulta y dice algo sobre ella. Este módulo es
//! lo que se hace con lo que dijo.
//!
//! Ningún agente descarta un candidato: todos describen, y punto. Una
//! descripción que contradice a un candidato le baja la confianza en vez de
//! tumbarlo — nunca cero resultados por culpa de una conjetura:
//!
//! 1. **Un candidato con `UMBRAL_INLIERS` correspondencias o más no lo penaliza
//!    ningún agente.** Cientos de puntos que RANSAC ha confirmado son mejor
//!    prueba que lo que un modelo cree leer en un cartel. Sobre los que la
//!    geometría NO confirmó, el agente sí pesa: ahí es la única señal que hay.
//! 2. **Cada agente que contradice multiplica el factor por `PENALIZACION`**,
//!    así que dos contradicciones pesan más que una — con un suelo
//!    (`FACTOR_MINIMO`) para que la compuesta nunca llegue a cero: nada
//!    desaparece del todo por una conjetura, ni por redondeo.
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
    /// Metadato informativo — hoy siempre `describe`, ningún agente filtra.
    /// Se conserva el campo (JSON, proto, columna) porque quitarlo es una
    /// migración que nadie pidió; el código ya no rama sobre él.
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
    /// La distribución completa, cuando el motor la calcula de verdad. Vacía
    /// si no — ver `lumi_proto::worker::Msg::Agente::alternativas`, de donde
    /// sale esto tal cual.
    #[serde(default)]
    pub alternativas: Vec<(String, f64)>,
    /// Ver `lumi_proto::worker::Msg::Agente::rasgos`. `None` es un estado
    /// legítimo (VLM, o el motor real que no tuvo nada que enseñar), no una
    /// ausencia que haya que rellenar.
    #[serde(default)]
    pub rasgos: Option<lumi_proto::worker::Rasgos>,
}

/// Cuánto pesa un mismatch con un agente. Compuesto (mismatches múltiples se
/// multiplican) nunca cae por debajo de `FACTOR_MINIMO`: es un castigo fuerte,
/// no un borrado.
const PENALIZACION: f64 = 0.1;

/// Suelo del factor compuesto. Existe para que ningún candidato desaparezca
/// funcionalmente por redondeo de punto flotante o por pantalla (un "0%" se
/// lee como descartado aunque el candidato siga en la lista) — nada se filtra
/// de verdad, así que nada debería parecer que se filtró.
const FACTOR_MINIMO: f64 = 0.01;

/// Qué le pasa a un candidato. `factor` es multiplicativo sobre su peso —
/// nunca `0.0`, porque ningún agente descarta— y `motivo` trae la frase que
/// el investigador va a leer cuando `factor < 1.0`.
#[derive(Debug, Clone, PartialEq)]
pub struct Ajuste {
    pub factor: f64,
    pub motivo: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Resultado {
    /// Uno por candidato, en el mismo orden en que entraron.
    pub ajustes: Vec<Ajuste>,
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
            // Compuesto: cada contradicción independiente multiplica, con
            // suelo para que nunca llegue a "0%" aunque nada se descarte.
            let factor = PENALIZACION.powi(motivos.len() as i32).max(FACTOR_MINIMO);
            ajustes.push(Ajuste { factor, motivo: Some(motivos.join("; ")) });
        }
    }

    Resultado { ajustes }
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
            tipo: "describe".into(),
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
            tipo: "describe".into(),
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
        Veredicto {
            agente: agente.into(),
            etiqueta: etiqueta.into(),
            confianza,
            alternativas: Vec::new(),
            rasgos: None,
        }
    }

    #[test]
    fn sin_veredictos_no_se_toca_nada() {
        let r = aplicar(&[idioma()], &[], &[(en("NOR"), None), (en("GRC"), None)]);
        assert!(r.ajustes.iter().all(|a| a.factor == 1.0 && a.motivo.is_none()));
    }

    #[test]
    fn el_que_incumple_y_no_tiene_geometria_se_penaliza_sin_caerse() {
        let r = aplicar(
            &[idioma()],
            &[dice("idioma", "griego", 0.9)],
            &[(en("GRC"), None), (en("NOR"), None)],
        );
        assert_eq!(r.ajustes[0].factor, 1.0);
        assert_eq!(r.ajustes[1].factor, PENALIZACION);
        assert!(r.ajustes[1].motivo.as_deref().unwrap().contains("griego"));
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
    fn un_agente_sin_restriccion_nunca_penaliza() {
        // "hora" describe pero no restringe nada (restriccion/mapa vacíos):
        // no tiene con qué contradecir a un candidato.
        let r = aplicar(&[hora()], &[dice("hora", "mediodía", 1.0)], &[(en("NOR"), None)]);
        assert_eq!(r.ajustes[0].factor, 1.0);
    }

    #[test]
    fn si_incumplen_todos_no_se_resetea_a_uno() {
        // Ya no hay "regla 2": al no filtrarse nunca de verdad, no hace falta
        // una vía de escape para cero resultados — cada uno se queda con su
        // penalización.
        let r = aplicar(
            &[idioma()],
            &[dice("idioma", "griego", 0.9)],
            &[(en("NOR"), None), (en("SWE"), None)],
        );
        assert!(r.ajustes.iter().all(|a| a.factor == PENALIZACION));
    }

    #[test]
    fn dos_contradicciones_independientes_componen_multiplicativamente() {
        // Grecia cumple las dos; España cumple la matrícula y no el idioma
        // (una contradicción); Noruega no cumple ninguna (dos contradicciones
        // independientes, que pesan más que una sola).
        let r = aplicar(
            &[idioma(), matricula()],
            &[dice("idioma", "griego", 0.9), dice("matricula", "banda azul UE", 0.9)],
            &[(en("GRC"), None), (en("ESP"), None), (en("NOR"), None)],
        );
        assert_eq!(r.ajustes[0].factor, 1.0);
        assert_eq!(r.ajustes[1].factor, PENALIZACION);
        assert_eq!(r.ajustes[2].factor, PENALIZACION * PENALIZACION);
    }

    #[test]
    fn el_suelo_evita_que_muchas_contradicciones_lleguen_a_cero() {
        let muchos: Vec<Agente> = (0..5)
            .map(|i| Agente { id: format!("a{i}"), ..idioma() })
            .collect();
        let veredictos: Vec<Veredicto> =
            muchos.iter().map(|a| dice(&a.id, "griego", 0.9)).collect();
        let r = aplicar(&muchos, &veredictos, &[(en("NOR"), None)]);
        assert_eq!(r.ajustes[0].factor, FACTOR_MINIMO);
        assert!(r.ajustes[0].factor > 0.0);
    }

    #[test]
    fn no_saber_donde_cae_un_candidato_no_lo_castiga() {
        // Sin `paises.json` puesto, `pais` es None para todos. Nadie se cae.
        let sin = Atributos::default();
        let r = aplicar(&[idioma()], &[dice("idioma", "griego", 0.9)], &[(sin, None)]);
        assert_eq!(r.ajustes[0].factor, 1.0);
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
