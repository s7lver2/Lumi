//! De los vectores de consulta a hipótesis con dueño.
//!
//! Con varios modelos hay varias listas de vecinos, una por colección de
//! Qdrant, y se fusionan con RRF antes de agrupar. Ver `lumi_index::fusion`
//! para por qué RRF y no un promedio de similitudes.

use anyhow::Result;
use lumi_index::agrupar::{confianza, en_grupos, Candidato};
use lumi_index::fusion::{rrf, K};
use lumi_index::niveles::Nivel;
use lumi_proto::worker::Hipotesis;

use crate::store::Store;

/// Cuántos vecinos se piden POR MODELO.
const VECINOS: usize = 64;

/// Cuántos sobreviven a la fusión y llegan al verificador geométrico.
/// Verificar es caro —de 40 ms a 600 ms por par y por verificador— y la fusión
/// ya ha hecho su trabajo si algo tenía que subir.
pub const A_VERIFICAR: usize = 12;

/// Los modelos de los que hay vectores instalados. Es lo que decide qué
/// niveles se pueden correr contra este servidor.
pub fn capas_instaladas(store: &Store) -> Vec<String> {
    let c = store.conn();
    let Ok(mut q) = c.prepare(
        "SELECT DISTINCT l.modelo FROM installed_index_layers l
           JOIN installed_indices i ON i.paquete = l.paquete
          WHERE i.completo = 1",
    ) else {
        return Vec::new();
    };
    let Ok(filas) = q.query_map([], |r| r.get::<_, String>(0)) else {
        return Vec::new();
    };
    filas.flatten().collect()
}

/// Una consulta a Qdrant por modelo del nivel, fusión por rango, y traducción
/// de punto a procedencia. Lo último es la razón entera de que esto viva aquí
/// y no en Python: está en SQLite, y el trabajador no tiene SQLite.
pub async fn candidatos(
    store: &Store,
    nivel: &Nivel,
    vectores: &[(String, Vec<f32>)],
) -> Result<Vec<Candidato>> {
    let cliente = crate::qdrant::Cliente::nuevo();
    let mut similitudes: std::collections::HashMap<i64, f64> = std::collections::HashMap::new();

    // W10: antes cada (modelo, versión) era un `await` en serie -- hasta 8
    // viajes secuenciales a Qdrant en el nivel `vision`. Se reúnen aquí todas
    // las peticiones de todos los modelos/versiones (con el índice del
    // modelo al que pertenece cada una) y se lanzan juntas con
    // `join_all`, que devuelve los resultados EN EL MISMO ORDEN que las
    // peticiones que se le pasaron -- así que agrupar por `modelo_idx`
    // después reconstruye exactamente el mismo orden por lista que el
    // bucle secuencial de antes, que es lo que le importa a RRF.
    struct Peticion<'a> {
        modelo_idx: usize,
        coleccion: String,
        vector: &'a [f32],
    }
    let mut peticiones: Vec<Peticion> = Vec::new();
    let mut listas: Vec<Vec<i64>> = Vec::new();
    for modelo in &nivel.recuperacion {
        let Some((_, vector)) = vectores.iter().find(|(m, _)| m == modelo) else {
            // El trabajador no mandó este vector (falló ese modelo). Se sigue
            // con los demás: perder un modelo de ocho degrada, no rompe.
            tracing::warn!("sin vector para {modelo}, se recupera sin él");
            continue;
        };
        // Todas las versiones instaladas de ese modelo: el investigador no
        // tiene por qué saber qué hay en el servidor.
        let versiones: Vec<String> = {
            let c = store.conn();
            let mut q = c.prepare(
                "SELECT DISTINCT l.version FROM installed_index_layers l
                   JOIN installed_indices i ON i.paquete = l.paquete
                  WHERE l.modelo = ?1 AND i.completo = 1",
            )?;
            let filas = q.query_map([modelo], |r| r.get::<_, String>(0))?.collect::<Result<Vec<_>, _>>()?;
            filas
        };
        let modelo_idx = listas.len();
        listas.push(Vec::new());
        for v in versiones {
            peticiones.push(Peticion {
                modelo_idx,
                coleccion: crate::qdrant::coleccion_de(modelo, &v),
                vector,
            });
        }
    }

    let resultados = futures::future::join_all(
        peticiones
            .iter()
            .map(|p| cliente.buscar(&p.coleccion, p.vector, VECINOS)),
    )
    .await;

    for (peticion, vecinos) in peticiones.iter().zip(resultados) {
        let lista = &mut listas[peticion.modelo_idx];
        for vecino in vecinos.unwrap_or_default() {
            similitudes
                .entry(vecino.id)
                .and_modify(|s| *s = s.max(vecino.similitud as f64))
                .or_insert(vecino.similitud as f64);
            lista.push(vecino.id);
        }
    }

    let fusionados = rrf(&listas, K);
    if fusionados.is_empty() {
        return Ok(Vec::new());
    }

    // D14: antes eran 12 `query_row` (uno por candidato) con el mismo guard
    // de `conn()` sostenido durante los 12 -- en el camino crítico de cada
    // inferencia. Una sola consulta con `IN (...)` trae los 12 de una vez;
    // el orden que importa (RRF) no es el de esta consulta, así que se
    // reconstruye recorriendo `fusionados` otra vez y mirando el resultado
    // por `id` en un `HashMap`.
    let ids: Vec<i64> = fusionados.iter().take(A_VERIFICAR).map(|p| p.id).collect();
    let mut filas_por_id: std::collections::HashMap<i64, (f64, f64, String, String, String)> =
        Default::default();
    if !ids.is_empty() {
        let marcadores = ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
        let sql = format!(
            "SELECT r.id, r.lat, r.lng, r.quadkey, i.nombre, i.autor
               FROM reference_images r JOIN installed_indices i ON i.paquete = r.paquete
              WHERE r.id IN ({marcadores})"
        );
        let c = store.conn();
        let mut q = c.prepare(&sql)?;
        let mut filas = q.query(rusqlite::params_from_iter(ids.iter()))?;
        while let Some(r) = filas.next()? {
            filas_por_id.insert(
                r.get(0)?,
                (r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?),
            );
        }
    }
    let mut fuera = Vec::new();
    for p in fusionados.iter().take(A_VERIFICAR) {
        if let Some((lat, lng, quadkey, indice, autor)) = filas_por_id.get(&p.id) {
            fuera.push(Candidato {
                id: p.id,
                lat: *lat,
                lng: *lng,
                quadkey: quadkey.clone(),
                // La similitud que se arrastra es la mejor que dio cualquier
                // modelo. El orden ya lo decidió RRF; esto solo alimenta el
                // peso del grupo.
                similitud: similitudes.get(&p.id).copied().unwrap_or(0.0),
                indice: indice.clone(),
                autor: autor.clone(),
            });
        }
    }
    Ok(fuera)
}

/// Agrupación por vecindad de tesela y atribución. Ya no consulta Qdrant, así
/// que deja de ser `async`.
///
/// Cada hipótesis viaja con el id y las coordenadas ORIGINALES de los
/// candidatos que formaron su grupo (`Grupo::miembros`) -- el centroide
/// ponderado de arriba no coincide con la de ninguno en concreto, así que
/// `queue::mod` (que es quien tiene los veredictos del verificador y busca
/// respaldo por coordenada exacta) necesita esta lista, no solo el punto
/// final. El id es lo que permite, además, saber A QUÉ candidato pertenece
/// el respaldo encontrado -- antes solo se sabía la coordenada, y
/// `Hipotesis::imagen_id` (elegido por similitud en `agrupar::resumir`)
/// podía señalar a un candidato distinto del que de verdad se verificó.
pub fn hipotesis(cands: &[Candidato]) -> Vec<(Hipotesis, Vec<(i64, f64, f64)>)> {
    let grupos = en_grupos(cands);
    let conf = confianza(&grupos);
    grupos
        .into_iter()
        .enumerate()
        .map(|(i, g)| {
            (
                Hipotesis {
                    lat: g.lat,
                    lng: g.lng,
                    radio_m: g.radio_m,
                    // La principal lleva la confianza comparada; las
                    // alternativas, su peso relativo. Son dos preguntas
                    // distintas y por eso dos números.
                    peso: if i == 0 { conf } else { g.peso },
                    indice: g.indice,
                    autor: g.autor,
                    imagen_id: Some(g.imagen_id),
                    // El respaldo se rellena aparte, en `queue::mod`, que es
                    // quien tiene los veredictos del verificador:
                    // `agrupar::Grupo` no los conoce.
                    inliers: None,
                    verificador: None,
                    // Lo rellena `queue::mod`, que es quien tiene los veredictos.
                    motivo_agente: None,
                },
                g.miembros,
            )
        })
        .collect()
}

/// Igual que `hipotesis`, pero SIN pasar por `en_grupos`: cada candidato es
/// su propia hipótesis, nunca se funde con otro por vecindad de tesela.
///
/// Para el caso en que ningún candidato tiene verificación geométrica
/// (`queue::mod` lo llama entonces en vez de `hipotesis`): agrupar por tesela
/// asume que estar cerca en el mapa de teselas significa "el mismo sitio", y
/// esa suposición depende de que la verificación ya haya descartado el
/// ruido. Sin ella, una tesela z14 mide 1,8 km a la latitud de León -- doce
/// candidatos repartidos por una ciudad entera acababan siendo UNA isla, con
/// un centroide que no es el sitio de ninguno de los doce y un radio que es
/// literalmente la dispersión de la ciudad (medido en producción: 1924 m
/// sobre la catedral de León, con la referencia real a menos de 150 m de
/// distancia, perdida dentro del promedio). Doce candidatos sin verificar
/// son doce sitios posibles, no un círculo de dos kilómetros que no significa
/// nada -- mostrar eso es más honesto que inventar una certeza que no existe.
pub fn hipotesis_sin_agrupar(cands: &[Candidato]) -> Vec<(Hipotesis, Vec<(i64, f64, f64)>)> {
    let mut ordenados: Vec<&Candidato> = cands.iter().collect();
    // Mismo orden que `agrupar::en_grupos` ya deja (más peso primero): la
    // principal es el candidato que más se parece, aunque nadie lo verificó.
    ordenados.sort_by(|a, b| b.similitud.total_cmp(&a.similitud));
    ordenados
        .into_iter()
        .map(|c| {
            (
                Hipotesis {
                    lat: c.lat,
                    lng: c.lng,
                    // Mismo suelo que `agrupar::resumir` usa para un grupo de
                    // un único candidato: un punto solo no tiene dispersión
                    // que medir, pero tampoco es exacto a cero metros.
                    radio_m: 50.0,
                    peso: c.similitud,
                    indice: c.indice.clone(),
                    autor: c.autor.clone(),
                    imagen_id: Some(c.id),
                    inliers: None,
                    verificador: None,
                    motivo_agente: None,
                },
                vec![(c.id, c.lat, c.lng)],
            )
        })
        .collect()
}
