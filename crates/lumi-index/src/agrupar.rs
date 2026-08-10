//! De candidatos recuperados a hipótesis.
//!
//! Se agrupa por VECINDAD DE TESELA y no por un radio en metros elegido a
//! dedo: el producto entero habla en teselas z14 desde el 7a, y dos fotos en
//! teselas contiguas están en el mismo sitio por la definición del formato. Un
//! umbral en metros sería un número más que explicar y afinar.

use std::collections::BTreeMap;

use crate::tiles::xy_de_quadkey;

#[derive(Debug, Clone)]
pub struct Candidato {
    pub lat: f64,
    pub lng: f64,
    pub quadkey: String,
    pub similitud: f64,
    pub indice: String,
    pub autor: String,
}

#[derive(Debug, Clone)]
pub struct Grupo {
    pub lat: f64,
    pub lng: f64,
    pub radio_m: f64,
    pub peso: f64,
    pub candidatos: usize,
    pub indice: String,
    pub autor: String,
}

/// Islas contiguas en el plano de teselas: dos candidatos caen en el mismo
/// grupo si sus quadkeys son iguales o vecinos, y los grupos salen de la
/// transitividad de esa relación.
pub fn en_grupos(cands: &[Candidato]) -> Vec<Grupo> {
    let xy: Vec<(i64, i64)> = cands
        .iter()
        .map(|c| {
            let (x, y) = xy_de_quadkey(&c.quadkey);
            (x as i64, y as i64)
        })
        .collect();

    let mut de_celda: BTreeMap<(i64, i64), Vec<usize>> = BTreeMap::new();
    for (i, p) in xy.iter().enumerate() {
        de_celda.entry(*p).or_default().push(i);
    }

    let mut visto = vec![false; cands.len()];
    let mut grupos = Vec::new();
    for raiz in 0..cands.len() {
        if visto[raiz] {
            continue;
        }
        let mut isla = Vec::new();
        let mut pila = vec![raiz];
        visto[raiz] = true;
        while let Some(i) = pila.pop() {
            isla.push(i);
            let (x, y) = xy[i];
            for dx in -1..=1 {
                for dy in -1..=1 {
                    for &j in de_celda.get(&(x + dx, y + dy)).map(|v| &v[..]).unwrap_or(&[]) {
                        if !visto[j] {
                            visto[j] = true;
                            pila.push(j);
                        }
                    }
                }
            }
        }
        grupos.push(resumir(cands, &isla));
    }
    grupos.sort_by(|a, b| b.peso.total_cmp(&a.peso));
    grupos
}

fn resumir(cands: &[Candidato], isla: &[usize]) -> Grupo {
    let peso: f64 = isla.iter().map(|&i| cands[i].similitud).sum();
    // Centroide ponderado: un candidato que se parece más tira más del punto.
    let lat = isla.iter().map(|&i| cands[i].lat * cands[i].similitud).sum::<f64>() / peso.max(1e-9);
    let lng = isla.iter().map(|&i| cands[i].lng * cands[i].similitud).sum::<f64>() / peso.max(1e-9);
    // El radio es la dispersión REAL de sus puntos, no una constante: un grupo
    // apretado tiene que decir que está apretado.
    let radio_m = isla
        .iter()
        .map(|&i| metros_entre(lat, lng, cands[i].lat, cands[i].lng))
        .fold(0.0_f64, f64::max)
        .max(50.0);
    // La atribución sale del candidato de más peso: si dos índices se solapan,
    // el que más aporta es el que responde.
    let mejor = isla
        .iter()
        .copied()
        .max_by(|&a, &b| cands[a].similitud.total_cmp(&cands[b].similitud))
        .unwrap_or(isla[0]);
    Grupo {
        lat,
        lng,
        radio_m,
        peso,
        candidatos: isla.len(),
        indice: cands[mejor].indice.clone(),
        autor: cands[mejor].autor.clone(),
    }
}

/// Cuánto le saca el primero al segundo. NO es la similitud del mejor
/// candidato: una similitud coseno de 0,83 no significa nada para quien lee el
/// informe y no es comparable entre modelos; «el doble que la siguiente» sí, y
/// sigue significando lo mismo cuando el 5b cambie el embebedor.
pub fn confianza(grupos: &[Grupo]) -> f64 {
    match grupos {
        [] => 0.0,
        // Sin competencia no se devuelve infinito: se topa, porque «no hay
        // segundo» puede significar tanto certeza como corpus pobre.
        [_] => 10.0,
        [a, b, ..] => (a.peso / b.peso.max(1e-9)).min(10.0),
    }
}

fn metros_entre(a_lat: f64, a_lng: f64, b_lat: f64, b_lng: f64) -> f64 {
    const R: f64 = 6_371_000.0;
    let dlat = (b_lat - a_lat).to_radians();
    let dlng = (b_lng - a_lng).to_radians();
    let h = (dlat / 2.0).sin().powi(2)
        + a_lat.to_radians().cos() * b_lat.to_radians().cos() * (dlng / 2.0).sin().powi(2);
    2.0 * R * h.sqrt().asin()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cand(qk: &str, lat: f64, lng: f64, sim: f64, indice: &str, autor: &str) -> Candidato {
        Candidato {
            lat, lng, quadkey: qk.into(), similitud: sim,
            indice: indice.into(), autor: autor.into(),
        }
    }

    fn grupo(peso: f64) -> Grupo {
        Grupo {
            lat: 0.0, lng: 0.0, radio_m: 100.0, peso,
            candidatos: 1, indice: "A".into(), autor: "@ana".into(),
        }
    }

    #[test]
    fn dos_teselas_contiguas_son_el_mismo_sitio_y_una_lejana_no() {
        let c = vec![
            cand("03131010101010", 43.36, -8.41, 0.90, "A", "@ana"),
            cand("03131010101011", 43.36, -8.40, 0.80, "A", "@ana"),
            cand("12000000000000", 10.00, 20.00, 0.70, "B", "@bea"),
        ];
        let g = en_grupos(&c);
        assert_eq!(g.len(), 2, "las dos contiguas van juntas");
        assert_eq!(g[0].candidatos, 2, "el grupo mayor va primero");
        assert!(g[0].peso > g[1].peso);
        // La atribución sale del candidato que más pesa dentro del grupo.
        assert_eq!(g[0].indice, "A");
        assert_eq!(g[0].autor, "@ana");
    }

    #[test]
    fn la_confianza_compara_los_dos_primeros_no_la_similitud() {
        // Un grupo que dobla al siguiente da 2.0, con independencia de que las
        // similitudes crudas sean 0,9 o 0,4: es lo único comparable entre modelos.
        let g = vec![grupo(4.0), grupo(2.0)];
        assert!((confianza(&g) - 2.0).abs() < 1e-9);
        // Sin competencia, la confianza no es infinita: se topa.
        assert!(confianza(&[grupo(4.0)]) >= 1.0);
    }
}
