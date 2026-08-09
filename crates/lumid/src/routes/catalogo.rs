//! Resolver el grafo de un paquete antes de descargarlo.
//!
//! Station INSTALA; el Indexer PUBLICA. Esta es la única pieza del subsistema
//! 8 que vive fuera del Indexer.

use axum::{extract::Query, Json};
use lumi_index::ficha::Ficha;
use lumi_index::grafo::{resolver, Grafo};
use serde::Deserialize;

#[derive(Deserialize)]
pub struct Peticion {
    /// La URL de la `ficha.json` de la raíz. La ficha viaja en claro y pesa
    /// kilobytes: resolver el árbol entero no descarga ni un gigabyte.
    pub url: String,
}

/// Trae una ficha y comprueba su firma. Misma postura que el fingerprint del
/// subsistema 1: si no cuadra, se aborta y se dice cuál. No hay diálogo de
/// «instalar igualmente» — ese diálogo es la puerta de entrada.
async fn traer(cliente: &reqwest::Client, url: &str) -> anyhow::Result<Ficha> {
    let f: Ficha = cliente.get(url).send().await?.json().await?;
    f.comprobar()
        .map_err(|e| anyhow::anyhow!("firma invalida en {}: {e}", f.paquete))?;
    Ok(f)
}

pub async fn resolver_grafo(Query(p): Query<Peticion>) -> Result<Json<Grafo>, String> {
    let cliente = reqwest::Client::new();
    let raiz = traer(&cliente, &p.url).await.map_err(|e| e.to_string())?;

    // Las dependencias se traen de golpe antes de resolver: `resolver` es
    // lógica pura y no puede esperar a la red, y así el corte de ciclos y el
    // marcado de rotas siguen viviendo en un solo sitio con tests.
    let mut conocidas: std::collections::HashMap<String, Ficha> = Default::default();
    let mut por_ver: Vec<String> = raiz.dependencias.iter().map(|d| d.url.clone()).collect();
    while let Some(url) = por_ver.pop() {
        let Ok(f) = traer(&cliente, &url).await else { continue };
        if conocidas.contains_key(&f.paquete) {
            continue;
        }
        por_ver.extend(f.dependencias.iter().map(|d| d.url.clone()));
        conocidas.insert(f.paquete.clone(), f);
    }

    Ok(Json(resolver(&raiz, &|p| conocidas.get(p).cloned())))
}
