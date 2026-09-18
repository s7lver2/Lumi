//! Un agente mira la foto de consulta y dice algo sobre ella. Este módulo es
//! lo que se hace con lo que dijo.
//!
//! Ningún agente descarta un candidato: todos describen, y punto. Una
//! respuesta que contradice a un candidato le baja la confianza en vez de
//! tumbarlo — nunca cero resultados por culpa de una conjetura:
//!
//! 1. **Un candidato con `UMBRAL_INLIERS` correspondencias o más no lo penaliza
//!    ningún agente.** Cientos de puntos que RANSAC ha confirmado son mejor
//!    prueba que lo que un modelo cree ver en una foto.
//! 2. **Cada agente que contradice multiplica el factor por `1 − peso ×
//!    confianza`**, con `peso` acotado a `[0, 0.9]` (spec 2026-09-17 §2): un
//!    veredicto muy seguro de un agente con mucho peso puede penalizar hasta
//!    un 90%, pero nunca el 100% — nada desaparece del todo por una conjetura.
//!
//! Y una tercera que es de la misma familia: el que no sabe no castiga. Un
//! agente por debajo de su umbral de confianza, una opción sin países que
//! contradecir (`indeterminado`, o cualquier opción con `paises: []`), o un
//! candidato cuyo país no se pudo resolver, no mueven nada.

use crate::arbitro::UMBRAL_INLIERS;
use crate::geo::Atributos;
use serde::{Deserialize, Serialize};

/// La ficha de `registros/agentes/<id>.json`. Sin ningún `if` sobre el `id`
/// en el motor ni aquí: si hace falta uno, es que falta un campo en la ficha
/// (spec 2026-09-17 §2).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Agente {
    pub id: String,
    pub nombre: String,
    /// Nombre que el cliente resuelve contra su set de SVG dibujados a mano
    /// (`AgenteIcono.tsx`).
    pub icono: String,
    /// `"eleccion"` (conjunto cerrado, softmax sobre evidencia contrastiva) o
    /// `"transcripcion"` (generación libre, sin confianza). Es el único campo
    /// que decide el camino de ejecución -- ver `Vlm.responder`/
    /// `Vlm.transcribir` en `workers/lumi_motores.py`.
    pub modo: String,
    /// El prompt, en inglés, redactado para encadenar gramaticalmente con
    /// cada `verbalizador` (modo elección) o para pedir la transcripción
    /// (modo transcripción).
    pub pregunta: String,
    /// Confianza mínima para no abstenerse. Solo tiene sentido en
    /// `modo: eleccion`; se ignora en transcripción.
    #[serde(default)]
    pub umbral: f64,
    /// Fuerza con la que el veredicto mueve el ranking, en `[0, 0.9]`. `0`
    /// define una observación: se muestra pero nunca repondera. Se acota a
    /// 0.9 en `aplicar()`, no aquí, para que una ficha que declare un valor
    /// fuera de rango falle de forma visible en vez de en silencio.
    #[serde(default)]
    pub peso: f64,
    /// El conjunto cerrado de respuestas válidas, solo en `modo: eleccion`.
    /// Toda ficha de elección debe incluir una opción `id: "indeterminado"`
    /// con `paises: []` -- no es un caso especial del motor, es una opción
    /// más que compite en el mismo softmax.
    #[serde(default)]
    pub opciones: Vec<Opcion>,
    /// Si `false`, el agente sigue en el registro (para que el banco de
    /// pruebas lo siga evaluando) pero `GET /v1/agentes` no lo ofrece al
    /// investigador. Lo toca a mano quien corra
    /// `tools/evaluar_agentes.py` -- nunca el propio motor.
    #[serde(default = "activo_por_defecto")]
    pub activo: bool,
}

fn activo_por_defecto() -> bool {
    true
}

/// Una opción dentro de `Agente.opciones`. Separa tres cosas que antes
/// vivían confundidas en una sola cadena: el identificador (estable, para
/// guardar el veredicto), el verbalizador (el texto exacto que se puntúa
/// contra el modelo) y la etiqueta visible (lo que lee el investigador).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Opcion {
    pub id: String,
    /// El texto exacto, en inglés, que se concatena a `Agente.pregunta` para
    /// puntuar esta opción. Empieza con el espacio/puntuación que le
    /// corresponda para encadenar gramaticalmente.
    pub verbalizador: String,
    /// Lo que lee el investigador en español.
    pub visible: String,
    /// Países (ISO3) que cumplen esta opción. Vacío = esta opción nunca
    /// contradice a ningún candidato (el caso de `indeterminado`, y el de
    /// cualquier opción sin mapa de país todavía confirmado por el banco de
    /// pruebas).
    #[serde(default)]
    pub paises: Vec<String>,
}

/// Lo que un agente contestó sobre la foto de consulta.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Veredicto {
    pub agente: String,
    pub etiqueta: String,
    /// `None` en `modo: transcripcion` -- no hay conjunto cerrado sobre el
    /// que normalizar, y cualquier número ahí sería inventado (spec
    /// 2026-09-17 §5). En `modo: eleccion`, la probabilidad softmax de la
    /// opción ganadora.
    #[serde(default)]
    pub confianza: Option<f64>,
    /// La distribución completa sobre las opciones, ordenada. Vacía en modo
    /// transcripción.
    #[serde(default)]
    pub alternativas: Vec<(String, f64)>,
    /// Cuánto sube la imagen la evidencia de la opción ganadora frente a no
    /// verla -- `logP(verbalizador|imagen,pregunta) −
    /// logP(verbalizador|pregunta)` de la opción que ganó, sin normalizar
    /// (spec 2026-09-17 §4: "cuánto la apoya la fotografía" es una lectura
    /// aparte de la confianza, no la misma cifra con otro nombre). `None` en
    /// modo transcripción.
    #[serde(default)]
    pub apoyo_visual: Option<f64>,
    /// El texto/JSON exacto que devolvió el motor antes de interpretarlo,
    /// solo con `modo_calibracion` activo en el momento del análisis.
    #[serde(default)]
    pub respuesta_cruda: Option<String>,
}

/// Suelo/techo del peso declarado en una ficha -- una ficha que declare más
/// de 0.9 no penaliza más que 0.9 de todos modos, así que ni vale la pena
/// que `registro.rs` la rechace: se acota aquí, en el único sitio que lo usa.
const PESO_MAXIMO: f64 = 0.9;

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
/// verdad. Con un único motor (`vlm`) en el catálogo, esto casi siempre
/// devuelve como mucho un id -- se conserva la deduplicación por si algún
/// día vuelve a haber más de una clase de motor.
pub fn motores_de_agentes(
    ids_agentes: &[String],
    agentes: &[Agente],
    motores: &[crate::registro::Motor],
) -> Vec<String> {
    let clases: std::collections::HashSet<&str> = ids_agentes
        .iter()
        .filter_map(|id| agentes.iter().find(|a| &a.id == id))
        .map(|_| "vlm")
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
        let mut factor = 1.0_f64;
        let mut motivos: Vec<String> = Vec::new();

        for v in veredictos {
            let Some(a) = agentes.iter().find(|a| a.id == v.agente) else { continue };
            let Some(confianza) = v.confianza else { continue }; // transcripción no repondera
            if a.peso <= 0.0 || confianza < a.umbral {
                continue; // observación, o se abstiene
            }
            let Some(opcion) = a.opciones.iter().find(|o| o.id == v.etiqueta) else { continue };
            if opcion.paises.is_empty() {
                continue; // "indeterminado", o sin mapa de país confirmado: no contradice a nadie
            }
            let Some(pais) = atributos.pais.as_deref() else { continue }; // no sabemos dónde cae: no castiga
            if opcion.paises.iter().any(|p| p == pais) {
                continue; // cumple
            }
            factor *= 1.0 - a.peso.min(PESO_MAXIMO) * confianza;
            motivos.push(format!("{} dice «{}», y este candidato es {pais}", a.nombre, v.etiqueta));
        }

        // Regla 1: la geometría gana. Se comprueba DESPUÉS de recorrer los
        // agentes y no antes, para que el bucle siga siendo el mismo y la
        // excepción esté escrita en un solo sitio.
        let protegido = inliers.is_some_and(|n| n >= UMBRAL_INLIERS);
        if motivos.is_empty() || protegido {
            ajustes.push(Ajuste { factor: 1.0, motivo: None });
        } else {
            ajustes.push(Ajuste { factor, motivo: Some(motivos.join("; ")) });
        }
    }

    Resultado { ajustes }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn opcion(id: &str, paises: &[&str]) -> Opcion {
        Opcion {
            id: id.into(),
            verbalizador: format!(" {id}."),
            visible: id.into(),
            paises: paises.iter().map(|s| s.to_string()).collect(),
        }
    }

    fn escritura() -> Agente {
        Agente {
            id: "escritura".into(),
            nombre: "Escritura del texto".into(),
            icono: "escritura".into(),
            modo: "eleccion".into(),
            pregunta: "…".into(),
            umbral: 0.6,
            peso: 0.5,
            activo: true,
            opciones: vec![
                opcion("griego", &["GRC", "CYP"]),
                opcion("latino", &[]),
                opcion("indeterminado", &[]),
            ],
        }
    }

    fn matricula() -> Agente {
        Agente {
            id: "matricula".into(),
            nombre: "Matrícula".into(),
            icono: "matricula".into(),
            modo: "eleccion".into(),
            pregunta: "…".into(),
            umbral: 0.6,
            peso: 0.5,
            activo: true,
            opciones: vec![opcion("banda-azul-ue", &["GRC", "ESP"]), opcion("indeterminado", &[])],
        }
    }

    fn hora() -> Agente {
        Agente {
            id: "hora-solar".into(),
            nombre: "Hora aparente".into(),
            icono: "hora-solar".into(),
            modo: "eleccion".into(),
            pregunta: "…".into(),
            umbral: 0.5,
            peso: 0.0,
            activo: true,
            opciones: vec![opcion("mediodia", &[])],
        }
    }

    fn en(iso: &str) -> Atributos {
        Atributos { pais: Some(iso.into()) }
    }

    fn dice(agente: &str, etiqueta: &str, confianza: f64) -> Veredicto {
        Veredicto {
            agente: agente.into(),
            etiqueta: etiqueta.into(),
            confianza: Some(confianza),
            alternativas: Vec::new(),
            apoyo_visual: Some(1.0),
            respuesta_cruda: None,
        }
    }

    #[test]
    fn sin_veredictos_no_se_toca_nada() {
        let r = aplicar(&[escritura()], &[], &[(en("NOR"), None), (en("GRC"), None)]);
        assert!(r.ajustes.iter().all(|a| a.factor == 1.0 && a.motivo.is_none()));
    }

    #[test]
    fn el_que_incumple_y_no_tiene_geometria_se_penaliza_segun_peso_y_confianza() {
        let r = aplicar(
            &[escritura()],
            &[dice("escritura", "griego", 0.9)],
            &[(en("GRC"), None), (en("NOR"), None)],
        );
        assert_eq!(r.ajustes[0].factor, 1.0);
        assert!((r.ajustes[1].factor - (1.0 - 0.5 * 0.9)).abs() < 1e-9);
        assert!(r.ajustes[1].motivo.as_deref().unwrap().contains("griego"));
    }

    #[test]
    fn con_inliers_de_sobra_la_geometria_gana_y_el_agente_calla() {
        let r = aplicar(
            &[escritura()],
            &[dice("escritura", "griego", 0.9)],
            &[(en("NOR"), Some(400))],
        );
        assert_eq!(r.ajustes[0].factor, 1.0);
        assert!(r.ajustes[0].motivo.is_none());
    }

    #[test]
    fn justo_en_el_umbral_de_inliers_ya_protege() {
        let r = aplicar(
            &[escritura()],
            &[dice("escritura", "griego", 0.9)],
            &[(en("NOR"), Some(crate::arbitro::UMBRAL_INLIERS))],
        );
        assert_eq!(r.ajustes[0].factor, 1.0);
    }

    #[test]
    fn una_abstencion_no_repondera_nada() {
        let mut a = escritura();
        a.umbral = 0.6;
        let r = aplicar(&[a], &[dice("escritura", "griego", 0.4)], &[(en("NOR"), None)]);
        assert_eq!(r.ajustes[0].factor, 1.0);
        assert!(r.ajustes[0].motivo.is_none());
    }

    #[test]
    fn una_opcion_indeterminado_nunca_penaliza() {
        let r = aplicar(&[escritura()], &[dice("escritura", "indeterminado", 0.9)], &[(en("NOR"), None)]);
        assert_eq!(r.ajustes[0].factor, 1.0);
    }

    #[test]
    fn un_agente_de_peso_cero_nunca_penaliza() {
        let r = aplicar(&[hora()], &[dice("hora-solar", "mediodia", 1.0)], &[(en("NOR"), None)]);
        assert_eq!(r.ajustes[0].factor, 1.0);
    }

    #[test]
    fn una_transcripcion_sin_confianza_no_repondera() {
        let v = Veredicto {
            agente: "toponimos".into(), etiqueta: "Calle Mayor".into(), confianza: None,
            alternativas: Vec::new(), apoyo_visual: None, respuesta_cruda: None,
        };
        let r = aplicar(&[escritura()], &[v], &[(en("NOR"), None)]);
        assert_eq!(r.ajustes[0].factor, 1.0);
    }

    #[test]
    fn dos_contradicciones_independientes_componen_multiplicativamente() {
        let r = aplicar(
            &[escritura(), matricula()],
            &[dice("escritura", "griego", 0.9), dice("matricula", "banda-azul-ue", 0.9)],
            &[(en("GRC"), None), (en("ESP"), None), (en("NOR"), None)],
        );
        assert_eq!(r.ajustes[0].factor, 1.0);
        assert!((r.ajustes[1].factor - (1.0 - 0.5 * 0.9)).abs() < 1e-9);
        let esperado_noruega = (1.0 - 0.5 * 0.9) * (1.0 - 0.5 * 0.9);
        assert!((r.ajustes[2].factor - esperado_noruega).abs() < 1e-9);
    }

    #[test]
    fn el_peso_se_acota_a_09_aunque_la_ficha_declare_mas() {
        let mut a = escritura();
        a.peso = 5.0;
        let r = aplicar(&[a], &[dice("escritura", "griego", 1.0)], &[(en("NOR"), None)]);
        assert!((r.ajustes[0].factor - 0.1).abs() < 1e-9);
    }

    #[test]
    fn no_saber_donde_cae_un_candidato_no_lo_castiga() {
        let sin = Atributos::default();
        let r = aplicar(&[escritura()], &[dice("escritura", "griego", 0.9)], &[(sin, None)]);
        assert_eq!(r.ajustes[0].factor, 1.0);
    }

    #[test]
    fn una_etiqueta_que_no_esta_entre_las_opciones_no_hace_nada() {
        let r = aplicar(&[escritura()], &[dice("escritura", "klingon", 0.99)], &[(en("NOR"), None)]);
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
    fn dos_agentes_comparten_una_sola_instalacion_de_motor() {
        let a1 = Agente { id: "a1".into(), ..escritura() };
        let a2 = Agente { id: "a2".into(), ..escritura() };
        let necesarios = motores_de_agentes(
            &["a1".into(), "a2".into()], &[a1, a2], &[motor("qwen3-vl-8b", "vlm")],
        );
        assert_eq!(necesarios, vec!["qwen3-vl-8b".to_string()]);
    }

    #[test]
    fn un_agente_sin_motor_registrado_no_pide_nada_que_no_exista() {
        let necesarios = motores_de_agentes(&["escritura".into()], &[escritura()], &[]);
        assert!(necesarios.is_empty());
    }
}
