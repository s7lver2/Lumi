//! Error único para todo `lumi-installer` — lo consumen tanto
//! `instalador-cli` (para decidir el mensaje de log) como los comandos de
//! Tauri de `installer/` (para mostrarlo en la UI).

use std::fmt;

#[derive(Debug)]
pub enum InstaladorError {
    Red(String),
    HashNoCoincide,
    Disco(String),
    Manifiesto(String),
    SinPublicacionNueva,
    SinArtefactoParaPlataforma,
    ProcesoNoCerro,
}

impl fmt::Display for InstaladorError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            InstaladorError::Red(m) => write!(f, "error de red: {m}"),
            InstaladorError::HashNoCoincide => {
                write!(f, "el sha256 descargado no coincide con el del manifiesto")
            }
            InstaladorError::Disco(m) => write!(f, "error de disco: {m}"),
            InstaladorError::Manifiesto(m) => write!(f, "manifiesto inválido: {m}"),
            InstaladorError::SinPublicacionNueva => {
                write!(f, "no hay versión nueva que instalar")
            }
            InstaladorError::SinArtefactoParaPlataforma => {
                write!(f, "el manifiesto no trae artefacto para esta plataforma")
            }
            InstaladorError::ProcesoNoCerro => write!(f, "el proceso objetivo no cerró a tiempo"),
        }
    }
}

impl std::error::Error for InstaladorError {}
