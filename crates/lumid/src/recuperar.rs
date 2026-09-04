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
    let mut listas: Vec<Vec<i64>> = Vec::new();
    let mut similitudes: std::collections::HashMap<i64, f64> = std::collections::HashMap::new();

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
        let mut lista = Vec::new();
        for v in versiones {
            let col = crate::qdrant::coleccion_de(modelo, &v);
            for vecino in cliente.buscar(&col, vector, VECINOS).await.unwrap_or_default() {
                similitudes
                    .entry(vecino.id)
                    .and_modify(|s| *s = s.max(vecino.similitud as f64))
                    .or_insert(vecino.similitud as f64);
                lista.push(vecino.id);
            }
        }
        listas.push(lista);
    }

    let fusionados = rrf(&listas, K);
    if fusionados.is_empty() {
        return Ok(Vec::new());
    }

    let c = store.conn();
    let mut fuera = Vec::new();
    for p in fusionados.iter().take(A_VERIFICAR) {
        let fila = c.query_row(
            "SELECT r.lat, r.lng, r.quadkey, i.nombre, i.autor
               FROM reference_images r JOIN installed_indices i ON i.paquete = r.paquete
              WHERE r.id = ?1",
            rusqlite::params![p.id],
            |r| {
                Ok(Candidato {
                    lat: r.get(0)?,
                    lng: r.get(1)?,
                    quadkey: r.get(2)?,
                    // La similitud que se arrastra es la mejor que dio
                    // cualquier modelo. El orden ya lo decidió RRF; esto solo
                    // alimenta el peso del grupo.
                    similitud: similitudes.get(&p.id).copied().unwrap_or(0.0),
                    indice: r.get(3)?,
                    autor: r.get(4)?,
                })
            },
        );
        if let Ok(cand) = fila {
            fuera.push(cand);
        }
    }
    Ok(fuera)
}

/// Agrupación por vecindad de tesela y atribución. Ya no consulta Qdrant, así
/// que deja de ser `async`.
///
/// Cada hipótesis viaja con las coordenadas ORIGINALES de los candidatos que
/// formaron su grupo (`Grupo::miembros`) -- el centroide ponderado de arriba
/// no coincide con la de ninguno en concreto, así que `queue::mod` (que es
/// quien tiene los veredictos del verificador y busca respaldo por
/// coordenada exacta) necesita esta lista, no solo el punto final.
pub fn hipotesis(cands: &[Candidato]) -> Vec<(Hipotesis, Vec<(f64, f64)>)> {
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
