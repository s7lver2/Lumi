//! Los dos orígenes del 7a: una carpeta del operador y un paquete cifrado de
//! la v1.
//!
//! Todo lo que viene de fuera entra por un directorio de STAGING, y cualquier
//! fallo lo tira entero sin escribir nada. No es paranoia: en la v1 el nombre
//! sin sanear de una imagen era escritura de fichero arbitraria, y aquí el
//! material puede venir del repositorio de un desconocido.

use std::io::Read;
use std::path::Path;
use std::sync::Mutex;

use anyhow::{bail, Context, Result};
use lumi_index::legacy::{descifrar, nombre_seguro, validar_manifiesto, Topes};
use lumi_index::tiles::quadkey;
use serde::Serialize;
use sha2::{Digest, Sha256};

use crate::store::Almacen;

#[derive(Debug, Clone, Default, Serialize)]
pub struct Resumen {
    pub lote_id: i64,
    pub aceptadas: u32,
    pub saltadas: u32,
    /// Cuántas llegaron ya con vector dentro y por tanto no gastan GPU.
    pub con_vector: u32,
    pub motivos: Vec<String>,
}

/// Un vector que vino DENTRO del paquete legacy, listo para subir a Qdrant.
/// `desde_legacy` no lo sube ella misma —es una función síncrona, y Qdrant se
/// habla por HTTP async— así que lo devuelve para que el llamador lo suba y
/// solo entonces marque la fila como `hecho`. Marcarla antes sería mentir:
/// una fila `hecho` sin el vector correspondiente en Qdrant es peor que
/// dejarla `pendiente`, porque nadie vuelve a intentarlo.
pub struct VectorTraido {
    pub imagen_id: i64,
    pub modelo: String,
    pub vector: Vec<f32>,
    pub quadkey: String,
}

/// Lo que ve el operador mientras un paquete legacy se importa. El descifrado
/// y el parseo del manifiesto son de varios segundos con un paquete real
/// (centenares de MB de floats); sin esto la interfaz no tiene nada que
/// enseñar mientras tanto y el operador no puede distinguir "trabajando" de
/// "colgado".
#[derive(Debug, Clone, Default, Serialize)]
pub struct ProgresoIngesta {
    pub trabajando: bool,
    pub etapa: String,
    pub hechas: u32,
    pub total: u32,
    pub terminado: bool,
    pub error: Option<String>,
    pub resumen: Option<Resumen>,
}

/// Un contador compartido, igual en espíritu al `Descarga` del 7b: se crea al
/// arrancar, un hilo aparte lo va actualizando, y el comando de progreso solo
/// lee lo último que dejó.
#[derive(Default)]
pub struct Ingesta {
    progreso: Mutex<ProgresoIngesta>,
}

impl Ingesta {
    pub fn nueva() -> Self {
        Self {
            progreso: Mutex::new(ProgresoIngesta { trabajando: true, ..Default::default() }),
        }
    }

    pub fn progreso(&self) -> ProgresoIngesta {
        self.progreso.lock().unwrap().clone()
    }

    fn etapa(&self, texto: &str) {
        self.progreso.lock().unwrap().etapa = texto.to_string();
    }

    fn empezar_imagenes(&self, total: u32) {
        let mut p = self.progreso.lock().unwrap();
        p.etapa = "importando imágenes".to_string();
        p.total = total;
        p.hechas = 0;
    }

    fn una_imagen(&self) {
        self.progreso.lock().unwrap().hechas += 1;
    }

    /// Cierra el progreso, en éxito o en error. Siempre se llama, para que el
    /// operador nunca se quede mirando una barra que ya no avanza y no dice
    /// por qué.
    pub fn terminar(&self, r: Result<Resumen>) {
        let mut p = self.progreso.lock().unwrap();
        p.trabajando = false;
        p.terminado = true;
        match r {
            Ok(resumen) => p.resumen = Some(resumen),
            Err(e) => p.error = Some(e.to_string()),
        }
    }
}

fn sha256_de(ruta: &Path) -> Result<String> {
    let mut f = std::fs::File::open(ruta)?;
    let mut h = Sha256::new();
    let mut buf = [0u8; 65536];
    loop {
        let n = f.read(&mut buf)?;
        if n == 0 {
            break;
        }
        h.update(&buf[..n]);
    }
    Ok(format!("{:x}", h.finalize()))
}

/// Coordenadas del EXIF. Devuelve `None` si no las trae, que es un motivo de
/// salto y no un error: una foto sin GPS es material inutilizable para un
/// índice, no un fallo de la herramienta.
fn gps_del_exif(ruta: &Path) -> Option<(f64, f64)> {
    let f = std::fs::File::open(ruta).ok()?;
    let mut lector = std::io::BufReader::new(f);
    let exif = exif::Reader::new().read_from_container(&mut lector).ok()?;

    let grados = |campo: exif::Tag, ref_campo: exif::Tag, positivo: char| -> Option<f64> {
        let v = exif.get_field(campo, exif::In::PRIMARY)?;
        let exif::Value::Rational(ref r) = v.value else { return None };
        if r.len() < 3 {
            return None;
        }
        let d = r[0].to_f64() + r[1].to_f64() / 60.0 + r[2].to_f64() / 3600.0;
        let signo = exif
            .get_field(ref_campo, exif::In::PRIMARY)
            .map(|f| f.display_value().to_string())
            .filter(|s| s.starts_with(positivo))
            .map(|_| 1.0)
            .unwrap_or(-1.0);
        Some(d * signo)
    };

    let lat = grados(exif::Tag::GPSLatitude, exif::Tag::GPSLatitudeRef, 'N')?;
    let lng = grados(exif::Tag::GPSLongitude, exif::Tag::GPSLongitudeRef, 'E')?;
    (-90.0..=90.0).contains(&lat).then_some(())?;
    (-180.0..=180.0).contains(&lng).then_some(())?;
    Some((lat, lng))
}

/// `ruta;lat;lng` o `ruta,lat,lng`, una por línea, con cabecera opcional. Es el
/// hermano del EXIF para material que no lo trae.
fn leer_sidecar(dir: &Path) -> std::collections::HashMap<String, (f64, f64)> {
    let mut m = std::collections::HashMap::new();
    for nombre in ["coordenadas.csv", "coords.csv"] {
        let Ok(txt) = std::fs::read_to_string(dir.join(nombre)) else { continue };
        for linea in txt.lines() {
            let campos: Vec<&str> = linea.split([';', ',']).map(|s| s.trim()).collect();
            if campos.len() < 3 {
                continue;
            }
            let (Ok(lat), Ok(lng)) = (campos[1].parse::<f64>(), campos[2].parse::<f64>()) else {
                continue;
            };
            m.insert(campos[0].to_string(), (lat, lng));
        }
    }
    m
}

/// Ingesta desde una carpeta del operador.
///
/// EL FICHERO ORIGINAL NO SE TOCA: se abre en solo lectura y su ruta es lo que
/// se guarda. No se reescribe, no se recomprime y no se le quita el EXIF —
/// regla de cadena de custodia de ARCHITECTURE.md.
#[allow(clippy::too_many_arguments)]
pub fn desde_carpeta(
    almacen: &Almacen,
    indice_id: i64,
    dir: &Path,
    tipo: &str,
    fuente: &str,
    licencia: Option<&str>,
    modelos: &[String],
) -> Result<Resumen> {
    if !dir.is_dir() {
        bail!("{} no es un directorio", dir.display());
    }
    let lote_id = almacen.crear_lote(
        indice_id,
        "carpeta",
        &dir.display().to_string(),
        Some(tipo),
        fuente,
        licencia,
        None,
        true,
    )?;
    let sidecar = leer_sidecar(dir);
    let mut r = Resumen { lote_id, ..Default::default() };

    for entrada in std::fs::read_dir(dir)?.flatten() {
        let ruta = entrada.path();
        let ext = ruta.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
        if !matches!(ext.as_str(), "jpg" | "jpeg" | "png" | "webp") {
            continue;
        }
        let nombre = ruta.file_name().unwrap().to_string_lossy().to_string();

        // Que decodifique de verdad como imagen. La extensión no basta ni
        // siquiera con material propio: un fichero truncado a mitad de copia
        // pasaría igual.
        let dimensiones = image::image_dimensions(&ruta);
        if dimensiones.is_err() {
            r.saltadas += 1;
            r.motivos.push(format!("{nombre} — no decodifica como imagen"));
            continue;
        }

        let Some((lat, lng)) = gps_del_exif(&ruta).or_else(|| sidecar.get(&nombre).copied()) else {
            r.saltadas += 1;
            r.motivos.push(format!("{nombre} — sin coordenadas: ni EXIF GPS ni fila en el CSV"));
            continue;
        };

        let sha = sha256_de(&ruta)?;
        almacen.insertar_imagen(
            indice_id,
            lote_id,
            &ruta.display().to_string(),
            &sha,
            lat,
            lng,
            &quadkey(lat, lng),
            modelos,
        )?;
        r.aceptadas += 1;
    }
    almacen.estado_lote(lote_id, "pendiente", None)?;
    Ok(r)
}

/// Ingesta desde un paquete cifrado de la v1.
///
/// El manifiesto de la v1 NO lleva procedencia: exporta `panoId`, `heading`,
/// coordenadas, embeddings y poco más, y las columnas `provider`/`attribution`
/// de su base de datos se quedaban fuera. Así que la procedencia la declara el
/// operador o queda como `desconocida`, y en cualquiera de los dos casos sale
/// en los porcentajes.
#[allow(clippy::too_many_arguments)]
pub fn desde_legacy(
    almacen: &Almacen,
    indice_id: i64,
    paquete: &Path,
    tipo: Option<&str>,
    fuente: &str,
    declarada_por_operador: bool,
    modelos: &[String],
    destino_imagenes: &Path,
    ingesta: &Ingesta,
) -> Result<(Resumen, Vec<VectorTraido>)> {
    ingesta.etapa("descifrando el paquete");
    let cifrado = std::fs::read(paquete)?;
    let topes = Topes::por_defecto();
    let zip_bytes = descifrar(&cifrado).context("no se pudo descifrar el paquete")?;

    // Los topes se miran sobre lo DECLARADO en el directorio central, antes de
    // descomprimir nada. Mirarlos después ya sería tarde.
    let cursor = std::io::Cursor::new(&zip_bytes);
    let mut zip = zip::ZipArchive::new(cursor)?;
    let declarado: u64 = (0..zip.len())
        .filter_map(|i| zip.by_index_raw(i).ok().map(|f| f.size()))
        .sum();
    topes.comprueba(cifrado.len() as u64, zip.len() as u64, declarado)?;

    // Todo va a un staging; cualquier fallo lo tira entero.
    let stage = tempfile::Builder::new().prefix("lumidx-stage-").tempdir()?;

    // La etapa más larga de un paquete real: un manifiesto de cientos de MB de
    // floats tarda varios segundos en deserializarse, y es donde el operador
    // más necesita saber que la aplicación sigue viva y no colgada.
    ingesta.etapa("leyendo el manifiesto");
    let mut manifiesto_bytes = Vec::new();
    zip.by_name("manifest.json")
        .context("el paquete no trae manifest.json")?
        .read_to_end(&mut manifiesto_bytes)?;
    let manifiesto = validar_manifiesto(&manifiesto_bytes)?;

    let lote_id = almacen.crear_lote(
        indice_id,
        "legacy",
        &paquete.display().to_string(),
        tipo,
        fuente,
        None,
        None,
        declarada_por_operador,
    )?;
    let mut r = Resumen { lote_id, ..Default::default() };
    let mut vectores_traidos = Vec::new();
    let conocidos: Vec<String> = modelos.to_vec();
    std::fs::create_dir_all(destino_imagenes)?;

    let total_imagenes: u32 = manifiesto.areas.iter().map(|a| a.images.len() as u32).sum();
    ingesta.empezar_imagenes(total_imagenes);

    for area in &manifiesto.areas {
        for img in &area.images {
            ingesta.una_imagen();
            if !nombre_seguro(&img.pano_id) {
                r.saltadas += 1;
                r.motivos.push(format!("{} — nombre no admisible", img.pano_id));
                continue;
            }
            let nombre = format!("{}_{}.jpg", img.pano_id, img.heading);
            let en_stage = stage.path().join(&nombre);
            let dentro = format!("images/{nombre}");
            let Ok(mut f) = zip.by_name(&dentro) else {
                r.saltadas += 1;
                r.motivos.push(format!("{nombre} — el manifiesto la declara pero no está en el zip"));
                continue;
            };
            let mut bytes = Vec::new();
            f.read_to_end(&mut bytes)?;
            std::fs::write(&en_stage, &bytes)?;
            if image::image_dimensions(&en_stage).is_err() {
                r.saltadas += 1;
                r.motivos.push(format!("{nombre} — no decodifica como imagen"));
                continue;
            }

            let destino = destino_imagenes.join(&nombre);
            std::fs::rename(&en_stage, &destino).or_else(|_| {
                std::fs::copy(&en_stage, &destino).map(|_| ())
            })?;

            // El vector viene dentro, y es de UN modelo: la v1 nunca exportó
            // más de uno por manifiesto (`manifiesto.model`, no un mapa por
            // imagen). Si coincide con uno instalado se da por hecho; si no,
            // la imagen entra SIN vector y la cola la recoge — el mecanismo
            // que la v1 tuvo que inventar a posteriori, aquí desde el
            // principio.
            let trae: Vec<String> = if img.embedding.is_some() && conocidos.contains(&manifiesto.model.id) {
                vec![manifiesto.model.id.clone()]
            } else {
                Vec::new()
            };
            let pendientes: Vec<String> =
                conocidos.iter().filter(|m| !trae.contains(m)).cloned().collect();

            let sha = sha256_de(&destino)?;
            let id = almacen.insertar_imagen(
                indice_id,
                lote_id,
                &destino.display().to_string(),
                &sha,
                img.lat,
                img.lng,
                &quadkey(img.lat, img.lng),
                &pendientes,
            )?;
            // NO se marca `hecho` aquí: esta función es síncrona y Qdrant se
            // habla por HTTP async. El llamador sube estos vectores de
            // verdad y solo entonces marca la fila — antes de eso, `id` es lo
            // único que necesita para saber a qué imagen atarlo.
            for m in &trae {
                if let Some(v) = &img.embedding {
                    vectores_traidos.push(VectorTraido {
                        imagen_id: id,
                        modelo: m.clone(),
                        vector: v.clone(),
                        quadkey: quadkey(img.lat, img.lng),
                    });
                }
            }
            if !trae.is_empty() {
                r.con_vector += 1;
            }
            r.aceptadas += 1;
        }
    }
    almacen.estado_lote(lote_id, "pendiente", None)?;
    Ok((r, vectores_traidos))
}
