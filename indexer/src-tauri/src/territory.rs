//! Dibujar un área y saber qué parte de ella no hace falta indexar.
//!
//! La cobertura del territorio es planetaria y compartida. Volver a descargar y
//! reembeber una tesela que alguien ya publicó es tirar cuota del proveedor y
//! horas de GPU para llegar al mismo sitio.

use std::path::Path;

use anyhow::Result;
use lumi_index::coverage::{clasificar, repartir, Cobertura, Estado, Reparto};
use lumi_index::tiles::{teselas_de_poligono, Punto};
use serde::Serialize;

#[derive(Serialize)]
pub struct Clasificacion {
    pub teselas: Vec<(String, Estado)>,
    pub locales: usize,
    pub catalogo: usize,
    pub nuevas: usize,
    pub bytes_a_descargar: u64,
    /// Quién publicó lo que se va a heredar, para poder atribuirlo antes de
    /// empezar y no después.
    pub autores: Vec<(String, u32)>,
}

/// Lee el `cobertura.json` de cada paquete instalado. El mismo camino de código
/// sirve para lo local y para lo publicado: la única diferencia es de dónde
/// salen los bytes.
pub fn coberturas_locales(dir_paquetes: &Path) -> Vec<Cobertura> {
    let Ok(entradas) = std::fs::read_dir(dir_paquetes) else { return Vec::new() };
    entradas
        .flatten()
        .filter_map(|e| {
            let c = e.path().join("cobertura.json");
            let bytes = std::fs::read(&c).ok()?;
            match serde_json::from_slice::<Cobertura>(&bytes) {
                Ok(c) => Some(c),
                Err(err) => {
                    log::warn!("cobertura ilegible en {}: {err}", e.path().display());
                    None
                }
            }
        })
        .collect()
}

pub fn clasificar_area(
    poligono: &[Punto],
    locales: &[Cobertura],
    catalogo: &[Cobertura],
) -> Result<Clasificacion> {
    let pedidas = teselas_de_poligono(poligono);
    let teselas = clasificar(&pedidas, locales, catalogo);
    let Reparto { locales: l, catalogo: c, nuevas, bytes_a_descargar } = repartir(&teselas);

    let mut autores: std::collections::BTreeMap<String, u32> = Default::default();
    for (_, e) in &teselas {
        if let Estado::Catalogo { indice, .. } = e {
            *autores.entry(indice.clone()).or_default() += 1;
        }
    }
    let mut autores: Vec<(String, u32)> = autores.into_iter().collect();
    autores.sort_by(|a, b| b.1.cmp(&a.1));

    Ok(Clasificacion {
        teselas,
        locales: l,
        catalogo: c,
        nuevas,
        bytes_a_descargar,
        autores,
    })
}
