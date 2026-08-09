//! El núcleo del Indexer: formato del paquete, teselas, cobertura,
//! procedencia y el contrato con el trabajador de embebido.
//!
//! Vive aparte de la aplicación porque es lógica pura y se prueba sin GPU, sin
//! servicios y sin ventana — y porque los subsistemas 8 y 5 abrirán estos
//! paquetes y deben depender de este crate en vez de copiar el formato.

pub mod budget;
pub mod cifrado;
pub mod coverage;
pub mod embed;
pub mod filter;
pub mod legacy;
pub mod manifest;
pub mod network;
pub mod streets;
pub mod tiles;
pub mod troceado;
pub mod vectors;
