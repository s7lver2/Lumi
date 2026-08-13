//! Un NIVEL es una composición de modelos; un MODELO es un recuperador
//! concreto. Que fueran la misma palabra es lo que hacía que un análisis real
//! devolviera cero candidatos: `analyses.model` guardaba «mini» y se buscaba
//! un índice instalado cuyo modelo fuera «mini», que no existe nunca.
//!
//! El registro es DATOS y no código, por la misma razón que el de modelos del
//! 7a: un fichero malo cuesta un nivel, nunca la lista.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Nivel {
    pub id: String,
    pub nombre: String,
    /// Los modelos de recuperación, por id. Todos tienen que estar en el
    /// índice para que el nivel se pueda correr.
    pub recuperacion: Vec<String>,
    pub geometricos: Vec<String>,
    /// Los agentes del nivel, por id. **Vacío significa «todos los del
    /// registro»**, que es como está Vision: crece al añadir un fichero, sin
    /// tocar código. Tiene un coste asumido por el propietario —dos servidores
    /// con registros distintos dan resultados distintos llamándolos igual— y
    /// se compensa guardando en cada análisis qué agentes corrieron de verdad.
    #[serde(default)]
    pub agentes: Vec<String>,
    /// A qué nivel se baja si al índice le faltan capas. `None` en el más
    /// bajo: por debajo no hay nada.
    pub cae_a: Option<String>,
}

/// El nivel que realmente se puede correr contra un índice, bajando por
/// `cae_a` hasta encontrar uno cuyos recuperadores estén todos presentes.
///
/// No se ignora una capa que falta ni se corre «vision con cuatro de ocho»:
/// el análisis se guarda con el nivel que de verdad corrió, y el cliente
/// enseña el descenso con su motivo. Es el patrón de la matriz de
/// capacidades — nada se esconde, todo lleva su causa legible.
pub fn resolver<'a>(registro: &'a [Nivel], pedido: &str, disponibles: &[String]) -> Option<&'a Nivel> {
    let mut actual = pedido.to_string();
    // Tope de vueltas por si un registro mal escrito tuviera un ciclo en
    // `cae_a`: un fichero de datos no puede colgar el daemon.
    for _ in 0..registro.len().max(1) {
        let nivel = registro.iter().find(|n| n.id == actual)?;
        if nivel.recuperacion.iter().all(|m| disponibles.contains(m)) {
            return Some(nivel);
        }
        actual = nivel.cae_a.clone()?;
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn registro() -> Vec<Nivel> {
        vec![
            Nivel {
                id: "vision".into(),
                nombre: "Lumi Vision".into(),
                recuperacion: vec!["megaloc".into(), "boq-dinov2".into(), "anyloc".into()],
                geometricos: vec!["roma".into(), "roma-v2".into()],
                agentes: Vec::new(),
                cae_a: Some("pro".into()),
            },
            Nivel {
                id: "pro".into(),
                nombre: "Lumi Pro".into(),
                recuperacion: vec!["megaloc".into(), "boq-dinov2".into()],
                geometricos: vec!["roma".into()],
                agentes: Vec::new(),
                cae_a: Some("mini".into()),
            },
            Nivel {
                id: "mini".into(),
                nombre: "Lumi Mini".into(),
                recuperacion: vec!["cosplace".into()],
                geometricos: vec!["tiny-roma".into()],
                agentes: Vec::new(),
                cae_a: None,
            },
        ]
    }

    fn ids(v: &[&str]) -> Vec<String> {
        v.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn si_estan_todas_las_capas_corre_el_nivel_pedido() {
        let d = ids(&["megaloc", "boq-dinov2", "anyloc"]);
        assert_eq!(resolver(&registro(), "vision", &d).unwrap().id, "vision");
    }

    #[test]
    fn si_falta_una_capa_cae_al_siguiente_que_quepa() {
        // El indice trae las de Pro pero no anyloc.
        let d = ids(&["megaloc", "boq-dinov2"]);
        assert_eq!(resolver(&registro(), "vision", &d).unwrap().id, "pro");
    }

    #[test]
    fn cae_mas_de_un_escalon_si_hace_falta() {
        let d = ids(&["cosplace"]);
        assert_eq!(resolver(&registro(), "vision", &d).unwrap().id, "mini");
    }

    #[test]
    fn si_no_cabe_ni_mini_no_hay_nivel() {
        // Un indice que solo trae un modelo que ningun nivel usa: sirve para
        // almacenar, no para consultar.
        let d = ids(&["lumi-inventado"]);
        assert!(resolver(&registro(), "vision", &d).is_none());
    }

    #[test]
    fn un_nivel_que_no_existe_en_el_registro_no_resuelve() {
        let d = ids(&["megaloc", "boq-dinov2"]);
        assert!(resolver(&registro(), "ultra", &d).is_none());
    }

    #[test]
    fn sin_capas_disponibles_no_hay_nivel() {
        assert!(resolver(&registro(), "mini", &[]).is_none());
    }
}
