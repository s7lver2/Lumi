//! Sellar y abrir un paquete `.lumidx`.
//!
//! El paquete es el formato de TRANSPORTE y de ARCHIVO; Qdrant es el almacén de
//! TRABAJO. Un directorio de Qdrant es un formato atado a su versión, no un
//! formato de archivo: dentro de veinte años un fichero plano de float32 se
//! sigue leyendo con cinco líneas de código, y en una herramienta forense eso
//! es la diferencia entre poder defender un resultado y no poder.
//!
//! Sellar es IRREVERSIBLE: un paquete sellado no se sigue llenando.

use std::io::Write;
use std::path::Path;

use anyhow::{bail, Result};
use lumi_index::vectors::{escribir_b1, escribir_i8};
use serde::Serialize;
use sha2::{Digest, Sha256};

#[derive(Debug, Clone, Serialize)]
pub struct Informe {
    pub filas: u32,
    /// `(modelo, filas esperadas, vectores encontrados)`.
    pub por_modelo: Vec<(String, u32, u32)>,
    pub cuadra: bool,
}

/// Cuenta filas contra vectores y NO declara éxito si no cuadran. Es lo que
/// hacía el script de migración de la v1 y es la parte que importa: un paquete
/// sellado a medias es peor que ninguno, porque parece bueno.
pub fn comprobar(informe: &Informe) -> Result<()> {
    if !informe.cuadra {
        let faltan: Vec<String> = informe
            .por_modelo
            .iter()
            .filter(|(_, e, v)| e != v)
            .map(|(m, e, v)| format!("{m}: {v} de {e}"))
            .collect();
        bail!("las filas no cuadran con los vectores — {}", faltan.join("; "));
    }
    Ok(())
}

/// Escribe SHA256SUMS con una línea `<hash>  <ruta relativa>` por fichero,
/// recorriendo el paquete en orden. Es lo que hace comprobable la autoría de un
/// fragmento heredado: quitar su atribución rompería este fichero.
pub fn firmar(raiz: &Path) -> Result<()> {
    let mut lineas = Vec::new();
    recorrer(raiz, raiz, &mut lineas)?;
    lineas.sort();
    let mut f = std::fs::File::create(raiz.join("SHA256SUMS"))?;
    for l in lineas {
        writeln!(f, "{l}")?;
    }
    Ok(())
}

fn recorrer(raiz: &Path, dir: &Path, fuera: &mut Vec<String>) -> Result<()> {
    for e in std::fs::read_dir(dir)?.flatten() {
        let p = e.path();
        if p.is_dir() {
            recorrer(raiz, &p, fuera)?;
            continue;
        }
        if p.file_name().and_then(|n| n.to_str()) == Some("SHA256SUMS") {
            continue;
        }
        let bytes = std::fs::read(&p)?;
        let rel = p.strip_prefix(raiz)?.display().to_string().replace('\\', "/");
        fuera.push(format!("{:x}  {rel}", Sha256::digest(&bytes)));
    }
    Ok(())
}

/// Verifica SHA256SUMS antes de tocar nada. Si un fichero no cuadra, el paquete
/// NO se abre — no se abre «con avisos».
pub fn verificar(raiz: &Path) -> Result<()> {
    let sumas = std::fs::read_to_string(raiz.join("SHA256SUMS"))
        .map_err(|_| anyhow::anyhow!("el paquete no trae SHA256SUMS"))?;
    for linea in sumas.lines() {
        let Some((hash, rel)) = linea.split_once("  ") else {
            bail!("línea ilegible en SHA256SUMS: {linea}");
        };
        let bytes = std::fs::read(raiz.join(rel))
            .map_err(|_| anyhow::anyhow!("SHA256SUMS nombra un fichero que no está: {rel}"))?;
        if format!("{:x}", Sha256::digest(&bytes)) != hash {
            bail!("{rel} no cuadra con su hash: el paquete está alterado o corrupto");
        }
    }
    Ok(())
}

/// Escribe los dos ficheros de vectores de un fragmento.
pub fn escribir_fragmento(dir: &Path, modelo: &str, version: &str, vs: &[Vec<f32>]) -> Result<()> {
    std::fs::create_dir_all(dir)?;
    let base = format!("{modelo}-{version}");
    escribir_b1(&mut std::fs::File::create(dir.join(format!("{base}.b1")))?, vs)?;
    escribir_i8(&mut std::fs::File::create(dir.join(format!("{base}.i8")))?, vs)?;
    Ok(())
}
