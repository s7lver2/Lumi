//! Lógica compartida del instalador de Lumi/Lumi Indexer: la usan tanto
//! `instalador-cli` (actualización silenciosa) como `installer/src-tauri`
//! (primera instalación interactiva). Ver
//! docs/superpowers/specs/2026-08-26-instalador-compartido-design.md.

pub mod error;
pub mod marca;
pub mod proceso;
pub mod sha256;

pub use error::InstaladorError;
