//! De candidatos recuperados a hipótesis.
//!
//! Se agrupa por DISTANCIA REAL, no por vecindad de tesela z14 -- lo primero
//! que se probó, con el argumento de que el producto entero habla en teselas
//! z14 desde el 7a y dos fotos en teselas contiguas están en el mismo sitio
//! por definición del formato. Eso es cierto para la COBERTURA del formato
//! (qué corpus toca instalar), pero no para la IDENTIDAD de un lugar: una
//! tesela z14 mide 1,8 km a la latitud de León, y con vecindad-8 y
//! transitividad, cualquier conjunto de candidatos repartido por una ciudad
//! entera acababa en una sola isla. Medido en producción: doce candidatos de
//! `cosplace` sobre una foto de la catedral de León, ninguno verificado
//! geométricamente, formaron un único grupo con centroide a ~850 m de la
//! catedral real y radio de 1924 m -- literalmente la dispersión de la
//! ciudad, no un lugar.

#[derive(Debug, Clone)]
pub struct Candidato {
    /// La fila de `reference_images` en SQLite. Es lo que permite servir su
    /// foto (`GET /v1/reference-images/:id/thumb`) sin tener que volver a
    /// buscarla por quadkey+coordenada, como hacía `rutas_de_candidatos`
    /// antes de que este campo existiera.
    pub id: i64,
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
    /// La foto de referencia que representa al grupo entero: el mismo
    /// candidato de más peso que decide `indice`/`autor` arriba, no uno
    /// elegido por un criterio distinto — un grupo ya tiene un solo autor y un
    /// solo índice, y esto es la misma regla aplicada a la foto.
    pub imagen_id: i64,
    /// Id y coordenada original de cada candidato que aportó a este grupo --
    /// el centroide de arriba (`lat`/`lng`) es un promedio ponderado y casi
    /// nunca coincide con la de ninguno en concreto, así que quien necesite
    /// buscar algo asociado a UN candidato del grupo (p. ej. su respaldo
    /// geométrico, o cuál de ellos es realmente `imagen_id` una vez se sabe
    /// cuál tiene el respaldo) tiene que mirar aquí, no al centroide.
    pub miembros: Vec<(i64, f64, f64)>,
}

/// Dos candidatos caen en el mismo grupo si están a menos de esto entre sí, y
/// los grupos salen de la transitividad de esa relación (islas conexas, no
/// "todos a menos de X del centroide" -- una fachada larga fotografiada de
/// punta a punta sigue siendo un solo sitio aunque sus extremos disten más
/// que esto).
///
/// El valor: lo bastante amplio para no partir una misma fachada o plaza en
/// dos grupos (una manzana urbana típica), lo bastante estrecho para que
/// "el mismo grupo" siga significando "el mismo sitio" y no "la misma
/// ciudad". No calibrado contra pares reales todavía -- a diferencia de
/// `arbitro::UMBRAL_INLIERS`, que si lo está: es geometría de sentido común
/// (el tamaño de una manzana), no una medida de un modelo. Nombrado aparte y
/// no repartido como número mágico para que el día que haga falta afinarlo,
/// haya un único sitio que tocar.
pub const RADIO_MISMO_SITIO_M: f64 = 150.0;

/// Islas conexas por distancia real: dos candidatos caen en el mismo grupo si
/// hay una cadena entre ellos donde cada salto mide menos de
/// `RADIO_MISMO_SITIO_M`. `O(n²)` a propósito -- `n` es como mucho
/// `recuperar::A_VERIFICAR` (12), nunca el corpus entero, así que una
/// tabla espacial sería complejidad sin causa.
pub fn en_grupos(cands: &[Candidato]) -> Vec<Grupo> {
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
            for j in 0..cands.len() {
                if !visto[j] && metros_entre(cands[i].lat, cands[i].lng, cands[j].lat, cands[j].lng) < RADIO_MISMO_SITIO_M {
                    visto[j] = true;
                    pila.push(j);
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
        // `imagen_id` sale del mismo candidato de más similitud que decide
        // `indice`/`autor` arriba -- el criterio POR DEFECTO, para cuando
        // nadie tiene respaldo geométrico. Cuando sí lo hay, `queue::mod` lo
        // sobrescribe con el candidato de más inliers usando `miembros` de
        // abajo: son dos preguntas distintas ("¿quién se parece más?" vs
        // "¿a quién de verdad se puede verificar?"), y mostrar la foto del
        // primero con el respaldo del segundo era enseñar la prueba
        // equivocada etiquetada con el respaldo de otra.
        imagen_id: cands[mejor].id,
        miembros: isla.iter().map(|&i| (cands[i].id, cands[i].lat, cands[i].lng)).collect(),
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

    fn cand(id: i64, qk: &str, lat: f64, lng: f64, sim: f64, indice: &str, autor: &str) -> Candidato {
        Candidato {
            id, lat, lng, quadkey: qk.into(), similitud: sim,
            indice: indice.into(), autor: autor.into(),
        }
    }

    fn grupo(peso: f64) -> Grupo {
        Grupo {
            lat: 0.0, lng: 0.0, radio_m: 100.0, peso,
            candidatos: 1, indice: "A".into(), autor: "@ana".into(), imagen_id: 1,
            miembros: vec![(1, 0.0, 0.0)],
        }
    }

    #[test]
    fn cerca_de_verdad_es_el_mismo_sitio_y_cerca_de_tesela_no_basta() {
        // 1 y 2 están a ~24 m -- la misma fachada. 3 está a ~810 m de 1: LA
        // MISMA CIUDAD (y, con el viejo criterio de vecindad de tesela z14,
        // habría podido caer en una tesela contigua a la de 1 o 2 -- una
        // tesela z14 mide 1,8 km a esta latitud) pero NO el mismo sitio. Este
        // es justo el caso que rompía antes de este cambio: "cerca en el
        // mapa de teselas" no es "el mismo lugar".
        let c = vec![
            cand(1, "03131010101010", 43.36000, -8.41000, 0.90, "A", "@ana"),
            cand(2, "03131010101011", 43.36000, -8.40970, 0.80, "A", "@ana"),
            cand(3, "03131010101011", 43.36000, -8.40000, 0.70, "B", "@bea"),
        ];
        let g = en_grupos(&c);
        assert_eq!(g.len(), 2, "1 y 2 van juntos; 3 es un sitio distinto pese a compartir quadkey");
        assert_eq!(g[0].candidatos, 2, "el grupo mayor va primero");
        assert!(g[0].peso > g[1].peso);
        // La atribución sale del candidato que más pesa dentro del grupo.
        assert_eq!(g[0].indice, "A");
        assert_eq!(g[0].autor, "@ana");
        // Y su foto es la de ESE mismo candidato, no la de cualquiera del grupo.
        assert_eq!(g[0].imagen_id, 1);
    }

    #[test]
    fn una_cadena_de_saltos_cortos_sigue_siendo_un_grupo_aunque_los_extremos_disten_mas() {
        // Islas CONEXAS, no "todos a menos de X del centroide": una fachada
        // larga fotografiada de punta a punta no se debe partir en dos solo
        // porque el primer y el último punto disten más que el radio.
        let c = vec![
            cand(1, "q", 43.36000, -8.41000, 0.90, "A", "@ana"),
            cand(2, "q", 43.36000, -8.40880, 0.80, "A", "@ana"), // ~97 m de 1
            cand(3, "q", 43.36000, -8.40760, 0.70, "A", "@ana"), // ~97 m de 2, ~194 m de 1
        ];
        let g = en_grupos(&c);
        assert_eq!(g.len(), 1, "la cadena entera es un solo grupo aunque 1 y 3 disten >150 m");
        assert_eq!(g[0].candidatos, 3);
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
