//! Fusión de las listas que devuelven varios modelos de recuperación.
//!
//! Se usa RRF (Reciprocal Rank Fusion) y no un promedio de similitudes por una
//! razón concreta: los cosenos de MegaLoc y de CosPlace NO están en la misma
//! escala, y no hay forma honesta de normalizarlos sin un conjunto de
//! calibración que no tenemos. El RANGO sí es comparable entre modelos, y RRF
//! premia justo lo que interesa aquí — que varios modelos independientes
//! señalen el mismo sitio.

use std::collections::HashMap;

/// La constante clásica de RRF. Amortigua el primer puesto lo justo para que
/// aparecer en muchas listas pueda ganarle a encabezar una sola.
pub const K: f64 = 60.0;

#[derive(Debug, Clone, PartialEq)]
pub struct Puntuado {
    pub id: i64,
    pub puntos: f64,
    /// En cuántas listas apareció. Es la señal legible: «cinco de ocho
    /// modelos lo trajeron» dice más que un número con seis decimales.
    pub apariciones: usize,
}

/// Cada candidato suma `1 / (k + rango)` por cada lista en la que aparece,
/// con el rango empezando en 1.
pub fn rrf(listas: &[Vec<i64>], k: f64) -> Vec<Puntuado> {
    let mut acc: HashMap<i64, (f64, usize)> = HashMap::new();
    for lista in listas {
        for (i, id) in lista.iter().enumerate() {
            let e = acc.entry(*id).or_insert((0.0, 0));
            e.0 += 1.0 / (k + (i + 1) as f64);
            e.1 += 1;
        }
    }
    let mut fuera: Vec<Puntuado> = acc
        .into_iter()
        .map(|(id, (puntos, apariciones))| Puntuado { id, puntos, apariciones })
        .collect();
    // El desempate por id es deliberado: dos ejecuciones idénticas tienen que
    // dar el mismo orden. `HashMap` no lo garantiza por sí solo.
    fuera.sort_by(|a, b| {
        b.puntos.partial_cmp(&a.puntos).unwrap_or(std::cmp::Ordering::Equal).then(a.id.cmp(&b.id))
    });
    fuera
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn el_consenso_gana_al_primer_puesto_solitario() {
        // 7 va tercero en cinco listas; 1 va primero en una sola. Es
        // exactamente el caso para el que existe RRF: cinco modelos
        // independientes señalando el mismo sitio pesan más que uno
        // convencidísimo.
        let listas = vec![
            vec![1, 2, 7],
            vec![2, 3, 7],
            vec![3, 4, 7],
            vec![4, 5, 7],
            vec![5, 6, 7],
        ];
        let fuera = rrf(&listas, K);
        assert_eq!(fuera[0].id, 7);
        assert_eq!(fuera[0].apariciones, 5);
    }

    #[test]
    fn ordena_de_mas_a_menos_puntos() {
        let listas = vec![vec![1, 2, 3]];
        let fuera = rrf(&listas, K);
        assert_eq!(fuera.iter().map(|p| p.id).collect::<Vec<_>>(), vec![1, 2, 3]);
        assert!(fuera[0].puntos > fuera[1].puntos);
    }

    #[test]
    fn una_lista_vacia_no_estorba() {
        let listas = vec![vec![], vec![9, 8]];
        let fuera = rrf(&listas, K);
        assert_eq!(fuera.len(), 2);
        assert_eq!(fuera[0].id, 9);
    }

    #[test]
    fn sin_listas_no_hay_nada() {
        assert!(rrf(&[], K).is_empty());
    }

    #[test]
    fn el_empate_se_rompe_por_id_y_no_al_azar() {
        // Dos candidatos con la misma puntuación tienen que salir siempre en
        // el mismo orden: un análisis que devuelve dos respuestas distintas
        // en dos ejecuciones idénticas es indefendible en un informe.
        let listas = vec![vec![5], vec![3]];
        let a = rrf(&listas, K);
        let b = rrf(&listas, K);
        assert_eq!(a[0].id, b[0].id);
        assert_eq!(a[1].id, b[1].id);
    }
}
