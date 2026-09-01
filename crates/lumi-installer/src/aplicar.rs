//! Descarga+verifica+copia el ejecutable de un producto. No crea accesos
//! directos ni entrada de registro — eso solo hace falta en la primera
//! instalación interactiva (`installer/src-tauri`, Task 7), no en cada
//! actualización silenciosa donde ya existen.

use std::fs;
use std::path::Path;

use lumi_proto::actualizacion::Publicacion;

use crate::error::InstaladorError;
use crate::sha256::verificar_sha256;

pub enum Fase {
    Descargando,
    Verificando,
    Copiando,
}

pub fn aplicar_producto(
    publicacion: &Publicacion,
    plataforma: &str,
    destino_exe: &Path,
    on_fase: impl Fn(Fase),
) -> Result<(), InstaladorError> {
    let artefacto = publicacion
        .artefactos
        .iter()
        .find(|a| a.plataforma == plataforma)
        .ok_or(InstaladorError::SinArtefactoParaPlataforma)?;

    on_fase(Fase::Descargando);
    // Sin timeout, `reqwest::blocking::get` puede colgarse indefinidamente
    // si la conexión se cae a mitad de descarga — 120s es más generoso que
    // el timeout de 5s del manifiesto (aquí se descarga el instalador
    // completo, no solo JSON), pero sigue acotando el bloqueo.
    let cliente = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|e| InstaladorError::Red(e.to_string()))?;
    let bytes = cliente
        .get(&artefacto.url)
        .send()
        .map_err(|e| InstaladorError::Red(e.to_string()))?
        .bytes()
        .map_err(|e| InstaladorError::Red(e.to_string()))?;

    on_fase(Fase::Verificando);
    if !verificar_sha256(&bytes, &artefacto.sha256) {
        return Err(InstaladorError::HashNoCoincide);
    }

    on_fase(Fase::Copiando);
    if let Some(padre) = destino_exe.parent() {
        fs::create_dir_all(padre).map_err(|e| InstaladorError::Disco(e.to_string()))?;
    }
    fs::write(destino_exe, &bytes).map_err(|e| InstaladorError::Disco(e.to_string()))?;

    Ok(())
}
