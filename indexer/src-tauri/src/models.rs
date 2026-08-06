//! El registro de modelos, que es DATOS y no código.
//!
//! La v1 aprendió esto por las malas: registrar un modelo significaba editar un
//! módulo compartido, y así se perdió una entrada entera en un release. Aquí es
//! un directorio de ficheros JSON, uno por modelo. Un fichero malo cuesta un
//! modelo, nunca la lista.
//!
//! Arranca con `lumi-preview` y `lumi-2` no por nostalgia: son los que llevan
//! dentro los paquetes legacy de la v1, y no soportarlos dejaría huérfano todo
//! lo ya publicado.

use std::path::Path;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Modelo {
    pub id: String,
    pub nombre: String,
    pub base: String,
    pub version: String,
    pub dims: u32,
    pub pesos_url: String,
}

/// Lee todos los `.json` del directorio. Un fichero ilegible o incompleto se
/// registra y se ignora; no tumba el resto de la lista.
pub fn cargar_registro(dir: &Path) -> Vec<Modelo> {
    let Ok(entradas) = std::fs::read_dir(dir) else {
        log::warn!("no hay directorio de modelos en {}", dir.display());
        return Vec::new();
    };
    let mut fuera = Vec::new();
    let mut rutas: Vec<_> = entradas.flatten().map(|e| e.path()).collect();
    rutas.sort();
    for ruta in rutas {
        if ruta.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        match std::fs::read(&ruta).map_err(anyhow::Error::from).and_then(|b| {
            serde_json::from_slice::<Modelo>(&b).map_err(anyhow::Error::from)
        }) {
            Ok(m) if m.dims > 0 && !m.id.is_empty() => fuera.push(m),
            Ok(m) => log::warn!("modelo descartado, id o dims vacíos: {}", m.id),
            Err(e) => log::warn!("modelo descartado, {}: {e}", ruta.display()),
        }
    }
    fuera
}
