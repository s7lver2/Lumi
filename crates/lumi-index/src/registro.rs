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
    /// La URL directa del peso — no la página del proyecto, que es
    /// `pesos_url` y se conserva. Vacío significa «no se puede bajar solo»:
    /// la pantalla pasa a modo guía en vez de a un botón que fallaría.
    #[serde(default)]
    pub fichero_url: String,
    /// De dónde sale el texto de licencia que se enseña antes de aceptar.
    #[serde(default)]
    pub licencia_url: String,
    /// El texto cacheado, para que la pantalla de aceptación funcione sin
    /// red. Vacío significa «hay que ir a buscarlo» — se resuelve en la
    /// Tarea 2, antes de tocar ningún peso.
    #[serde(default)]
    pub licencia_texto: String,
    /// `None`, o `Some("token")` cuando el proveedor exige credencial propia
    /// (hoy solo RoMa v2, por DINOv3). Ningún otro valor tiene sentido hoy;
    /// se deja como `Option<String>` y no un booleano por si un proveedor
    /// futuro exige algo distinto de un token.
    #[serde(default)]
    pub puerta: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Motor {
    pub id: String,
    pub nombre: String,
    /// `vlm` | `ocr` | `profundidad` — la clave de `CLASES` en
    /// `workers/lumi_motores.py`. Debe existir ahí o el motor no carga.
    pub clase: String,
    pub licencia: String,
    #[serde(default)]
    pub fichero_url: String,
    #[serde(default)]
    pub licencia_url: String,
    #[serde(default)]
    pub licencia_texto: String,
    #[serde(default)]
    pub puerta: Option<String>,
    /// PaddleOCR no tiene un fichero, una URL: su propia librería descarga
    /// sus pesos la primera vez que se instancia. `true` aquí es la señal
    /// para que la Tarea 6 (worker de descarga) NO intente bajar nada y solo
    /// escriba la licencia — es un caso, no una excepción silenciosa.
    #[serde(default)]
    pub gestion_propia: bool,
}

pub fn cargar_motores(dir: &Path) -> Vec<Motor> {
    leer_dir::<Motor>(dir).into_iter().filter(|m| !m.id.is_empty()).collect()
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

/// Los agentes. Mismo trato que los demás registros: un fichero malo cuesta un
/// agente, nunca la lista. Se descarta además el que diga que filtra sin decir
/// por qué restricción — filtraría con la cadena vacía y no acotaría nada,
/// que es peor que no estar.
pub fn cargar_agentes(dir: &Path) -> Vec<crate::agentes::Agente> {
    leer_dir::<crate::agentes::Agente>(dir)
        .into_iter()
        .filter(|a| !a.id.is_empty() && (a.tipo != "filtra" || !a.restriccion.is_empty()))
        .collect()
}


#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn motor_sin_id_se_descarta() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("roto.json"), b"{}").unwrap();
        std::fs::write(
            dir.path().join("bueno.json"),
            br#"{"id":"x","nombre":"X","clase":"vlm","licencia":"MIT"}"#,
        )
        .unwrap();
        let motores = cargar_motores(dir.path());
        assert_eq!(motores.len(), 1);
        assert_eq!(motores[0].id, "x");
    }
}