//! Los tres registros, que son DATOS y no código: modelos de recuperación,
//! verificadores geométricos y niveles.
//!
//! La v1 aprendió esto por las malas — registrar un modelo significaba editar
//! un módulo compartido, y así se perdió una entrada entera en un release.
//! Aquí es un directorio de ficheros JSON. **Un fichero malo cuesta una
//! entrada, nunca la lista.**
//!
//! Vive en `lumi-index` y no en el daemon porque el Indexer y Station tienen
//! que leer exactamente el mismo registro: un vector ES el modelo, y si los
//! dos lados no coinciden en qué es «lumi-2», los vectores dejan de ser
//! comparables sin que nada falle al compilar.

use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::niveles::Nivel;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Modelo {
    pub id: String,
    pub nombre: String,
    pub base: String,
    pub version: String,
    pub dims: u32,
    /// `foundation` o `cnn`. No es adorno: es lo que permite avisar de que un
    /// nivel se ha quedado con cuatro modelos de la misma familia y que su
    /// ensemble ya no aporta diversidad.
    pub familia: String,
    pub licencia: String,
    pub pesos_url: String,
    /// Vacío significa «sin verificar todavía», y cargar un modelo así falla
    /// con un motivo legible. Rellenarlo es trabajo manual del propietario:
    /// descargar el peso y calcular el hash, como se hizo con el binario de
    /// Qdrant en el subsistema 1. Nunca se inventa.
    #[serde(default)]
    pub sha256: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Verificador {
    pub id: String,
    pub nombre: String,
    pub tipo: String,
    pub licencia: String,
    pub pesos_url: String,
    #[serde(default)]
    pub sha256: String,
}

fn leer_dir<T: serde::de::DeserializeOwned>(dir: &Path) -> Vec<T> {
    let Ok(entradas) = std::fs::read_dir(dir) else {
        log::warn!("no hay registro en {}", dir.display());
        return Vec::new();
    };
    let mut rutas: Vec<_> = entradas.flatten().map(|e| e.path()).collect();
    rutas.sort();
    let mut fuera = Vec::new();
    for ruta in rutas {
        if ruta.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        match std::fs::read(&ruta)
            .map_err(anyhow::Error::from)
            .and_then(|b| serde_json::from_slice::<T>(&b).map_err(anyhow::Error::from))
        {
            Ok(v) => fuera.push(v),
            Err(e) => log::warn!("entrada de registro descartada, {}: {e}", ruta.display()),
        }
    }
    fuera
}

pub fn cargar_modelos(dir: &Path) -> Vec<Modelo> {
    leer_dir::<Modelo>(dir).into_iter().filter(|m| m.dims > 0 && !m.id.is_empty()).collect()
}

pub fn cargar_verificadores(dir: &Path) -> Vec<Verificador> {
    leer_dir::<Verificador>(dir).into_iter().filter(|v| !v.id.is_empty()).collect()
}

pub fn cargar_niveles(dir: &Path) -> Vec<Nivel> {
    leer_dir::<Nivel>(dir).into_iter().filter(|n| !n.id.is_empty()).collect()
}
