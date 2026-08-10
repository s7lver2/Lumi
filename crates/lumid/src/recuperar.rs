//! De un vector de consulta a hipótesis con dueño.

use anyhow::Result;
use lumi_index::agrupar::{confianza, en_grupos, Candidato};
use lumi_proto::worker::Hipotesis;

use crate::store::Store;

/// Cuántos vecinos se piden. Constante con nombre y no un ajuste: bastante
/// para que un grupo real se note sobre el ruido, poco para que agrupar sea
/// instantáneo. El 5b lo revisará con datos de verdad delante, que es cuando
/// se puede.
const VECINOS: usize = 64;

/// Toma `&Store` y no `&crate::App`: es todo lo que hace falta, y es todo lo
/// que la cola (que llama a esto desde dentro de `Queue`, no desde un
/// handler con `App` en la mano) puede ofrecer sin guardar una referencia
/// circular a la aplicación entera.
pub async fn hipotesis(store: &Store, modelo: &str, vector: &[f32]) -> Result<Vec<Hipotesis>> {
    // Qué versión del modelo hay instalada. Si hay varias, se consultan todas:
    // el investigador no tiene por qué saber qué hay en el servidor.
    let colecciones: Vec<String> = {
        let c = store.conn();
        let mut q = c.prepare(
            "SELECT DISTINCT version FROM installed_indices WHERE modelo = ?1 AND completo = 1",
        )?;
        let versiones = q
            .query_map([modelo], |r| r.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?;
        versiones.into_iter().map(|v| crate::qdrant::coleccion_de(modelo, &v)).collect()
    };

    let cliente = crate::qdrant::Cliente::nuevo();
    let mut vecinos = Vec::new();
    for col in &colecciones {
        vecinos.extend(cliente.buscar(col, vector, VECINOS).await.unwrap_or_default());
    }
    if vecinos.is_empty() {
        return Ok(Vec::new());
    }

    // La traducción de punto a procedencia. Es la razón entera de que la
    // recuperación viva aquí y no en Python: esto está en SQLite.
    let cands: Vec<Candidato> = {
        let c = store.conn();
        let mut fuera = Vec::new();
        for v in &vecinos {
            let fila = c.query_row(
                "SELECT r.lat, r.lng, r.quadkey, i.nombre, i.autor
                   FROM reference_images r JOIN installed_indices i ON i.paquete = r.paquete
                  WHERE r.id = ?1",
                rusqlite::params![v.id],
                |r| {
                    Ok(Candidato {
                        lat: r.get(0)?,
                        lng: r.get(1)?,
                        quadkey: r.get(2)?,
                        similitud: v.similitud as f64,
                        indice: r.get(3)?,
                        autor: r.get(4)?,
                    })
                },
            );
            if let Ok(c) = fila {
                fuera.push(c);
            }
        }
        fuera
    };

    let grupos = en_grupos(&cands);
    let conf = confianza(&grupos);
    Ok(grupos
        .into_iter()
        .enumerate()
        .map(|(i, g)| Hipotesis {
            lat: g.lat,
            lng: g.lng,
            radio_m: g.radio_m,
            // La principal lleva la confianza comparada; las alternativas, su
            // peso relativo. Son dos preguntas distintas y por eso dos números.
            peso: if i == 0 { conf } else { g.peso },
            indice: g.indice,
            autor: g.autor,
        })
        .collect())
}
