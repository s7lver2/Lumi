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

use lumi_index::network::Redistribucion;

/// Lo mínimo de una imagen para decidir si sale del paquete.
#[derive(Debug, Clone)]
pub struct FilaPublicable {
    pub id: i64,
    pub fuente: String,
    pub licencia: Option<String>,
    pub quadkey: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct Publicable {
    pub fuente: String,
    pub en_el_indice: u32,
    pub viajan: u32,
    pub licencia: String,
    pub motivo: String,
}

/// La redistribución de cada origen. Vive aquí y no en el trait porque sellar
/// no necesita construir adaptadores —ni claves, ni red— para saber qué puede
/// publicar: es una propiedad del origen, no de la sesión.
pub fn redistribucion_de(fuente: &str) -> Redistribucion {
    match fuente {
        "google" | "mapbox-satelite" => Redistribucion::SoloLocal,
        "flickr" => Redistribucion::PorImagen,
        "mapillary" | "kartaview" => Redistribucion::Libre { licencia: "CC BY-SA 4.0".into() },
        "commons" => Redistribucion::Libre { licencia: "libre (Commons)".into() },
        // Todo lo demás es material del propio operador (carpeta local, legacy):
        // suyo es y suyo sale.
        _ => Redistribucion::Libre { licencia: "declarada por el operador".into() },
    }
}

/// Una fila por origen con cuántas hay y cuántas salen.
pub fn que_viaja(filas: &[FilaPublicable]) -> Vec<Publicable> {
    let mut por_fuente: std::collections::BTreeMap<&str, (u32, u32)> = Default::default();
    for f in filas {
        let r = redistribucion_de(&f.fuente);
        let e = por_fuente.entry(f.fuente.as_str()).or_default();
        e.0 += 1;
        if r.viaja(f.licencia.as_deref()) {
            e.1 += 1;
        }
    }
    por_fuente
        .into_iter()
        .map(|(fuente, (en_el_indice, viajan))| {
            let r = redistribucion_de(fuente);
            let (licencia, motivo) = match &r {
                Redistribucion::Libre { licencia } => {
                    (licencia.clone(), "libre, con autor por fichero".to_string())
                }
                Redistribucion::SoloLocal => (
                    "no redistribuible".to_string(),
                    "no redistribuible: ni imagen ni vector".to_string(),
                ),
                Redistribucion::PorImagen => (
                    "varía por foto".to_string(),
                    format!("{} con ND o NC se quedan", en_el_indice - viajan),
                ),
            };
            Publicable { fuente: fuente.to_string(), en_el_indice, viajan, licencia, motivo }
        })
        .collect()
}

/// Los orígenes que de verdad viajan en el fragmento de esta tesela.
///
/// Es lo que se escribe en `TeselaCubierta::fuentes`, y de lo que otro operador
/// deducirá qué NO tiene que volver a indexar. Meter aquí un origen cuyo
/// material se quedó fuera sería prometerle una cobertura que el paquete no
/// lleva.
///
/// `cobertura.json` sigue siendo el placeholder `{}` del 7a — construir
/// `TeselaCubierta` de verdad es del subsistema 8 — así que `paquete_sellar`
/// todavía no llama a esto. Queda lista y probada para cuando lo haga.
#[allow(dead_code)]
pub fn fuentes_que_viajan(filas: &[FilaPublicable], quadkey: &str) -> Vec<String> {
    let mut fuera: Vec<String> = filas
        .iter()
        .filter(|f| f.quadkey == quadkey)
        .filter(|f| redistribucion_de(&f.fuente).viaja(f.licencia.as_deref()))
        .map(|f| f.fuente.clone())
        .collect();
    fuera.sort();
    fuera.dedup();
    fuera
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fila(fuente: &str, licencia: Option<&str>) -> FilaPublicable {
        FilaPublicable {
            id: 1,
            fuente: fuente.into(),
            licencia: licencia.map(|s| s.to_string()),
            quadkey: "AAA".into(),
        }
    }

    #[test]
    fn google_y_mapbox_no_sacan_ni_un_vector() {
        let filas = vec![fila("google", None), fila("mapbox-satelite", None)];
        let r = que_viaja(&filas);
        assert!(r.iter().all(|p| p.viajan == 0), "{r:?}");
        assert!(r.iter().all(|p| p.motivo.contains("no redistribuible")), "{r:?}");
    }

    #[test]
    fn flickr_viaja_foto_a_foto_y_las_nd_o_nc_se_quedan() {
        let filas = vec![
            fila("flickr", Some("CC BY 2.0")),
            fila("flickr", Some("CC BY-SA 2.0")),
            fila("flickr", Some("CC BY-ND 2.0")),
            fila("flickr", Some("CC BY-NC 2.0")),
            fila("flickr", None),
        ];
        let r = que_viaja(&filas);
        assert_eq!(r.len(), 1);
        assert_eq!(r[0].en_el_indice, 5);
        assert_eq!(r[0].viajan, 2, "solo BY y BY-SA");
    }

    #[test]
    fn lo_libre_viaja_entero() {
        let filas = vec![fila("mapillary", None), fila("commons", Some("CC0 1.0"))];
        let r = que_viaja(&filas);
        assert!(r.iter().all(|p| p.viajan == p.en_el_indice), "{r:?}");
    }

    #[test]
    fn las_fuentes_de_una_tesela_son_solo_las_que_de_verdad_viajan() {
        // Es lo que va a `cobertura.json`, y de lo que otro operador va a
        // deducir qué NO tiene que volver a indexar. Meter aquí google sería
        // prometerle una cobertura que su paquete no lleva.
        let filas = vec![
            fila("mapillary", None),
            fila("google", None),
            fila("flickr", Some("CC BY-ND 2.0")),
        ];
        let f = fuentes_que_viajan(&filas, "AAA");
        assert_eq!(f, vec!["mapillary".to_string()]);
    }
}
