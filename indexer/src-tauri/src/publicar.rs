//! Componer la ficha, trocear, cifrar y subir.
//!
//! El orden de subida es cuerpos → capas → ficha, y no es un detalle: mientras
//! falte un asset la ficha no se publica, y sin ficha el paquete no existe
//! para nadie. Una subida cortada a mitad es invisible, en vez de ser un
//! índice a medias que alguien se encuentra y se instala.
//!
//! El cifrado de los assets es ofuscación frente al alojamiento: la clave
//! viaja en la ficha, y cualquiera con Lumi abre el paquete. Lo que evita es
//! que un rastreador se encuentre un corpus de imágenes geolocalizadas servido
//! en bandeja.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use anyhow::{anyhow, bail, Result};
use base64::{engine::general_purpose::STANDARD, Engine};
use lumi_index::cifrado;
use lumi_index::ficha::{Asset, Capa, Ficha, VIGENCIA_DIAS};
use lumi_index::troceado::{trocear, Trozo, TOPE_TROZO_BYTES};
use serde::Serialize;
use sha2::{Digest, Sha256};

use crate::store::Almacen;

/// Un día en segundos, para la vigencia. Sin `chrono`: la marca de tiempo de
/// esta aplicación son segundos de época y aquí basta con sumar.
const DIA: i64 = 86_400;

#[derive(Debug, Clone, Serialize)]
pub struct Repo {
    pub nombre: String,
    pub privado: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct TrozoPrevisto {
    /// La zona que nombra el trozo, no un número de orden que no significa
    /// nada.
    pub zona: String,
    pub quadkeys: usize,
    pub bytes: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct Previsualizacion {
    pub trozos: Vec<TrozoPrevisto>,
    pub bytes_total: u64,
    /// Las fuentes cuyos términos no permiten redistribuir. Si esta lista no
    /// está vacía, el diálogo enseña el descargo y exige la casilla.
    pub no_redistribuibles: Vec<String>,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct ProgresoPublicacion {
    pub asset: String,
    pub hechos: u32,
    pub total: u32,
    pub bytes_hechos: u64,
    pub bytes_total: u64,
    pub terminado: bool,
    pub error: Option<String>,
    pub registro: Vec<String>,
}

pub struct Publicacion(Mutex<ProgresoPublicacion>);

impl Publicacion {
    pub fn nueva(total: u32, bytes_total: u64) -> Self {
        Self(Mutex::new(ProgresoPublicacion { total, bytes_total, ..Default::default() }))
    }

    pub fn empezar_asset(&self, nombre: &str) {
        let mut g = self.0.lock().unwrap();
        g.asset = nombre.into();
        g.registro.push(format!("subiendo {nombre}"));
    }

    pub fn terminar_asset(&self, bytes: u64) {
        let mut g = self.0.lock().unwrap();
        g.hechos += 1;
        g.bytes_hechos += bytes;
    }

    pub fn anotar(&self, linea: String) {
        self.0.lock().unwrap().registro.push(linea);
    }

    pub fn terminar(&self, resultado: Result<(), String>) {
        let mut g = self.0.lock().unwrap();
        g.terminado = true;
        if let Err(e) = resultado {
            g.error = Some(e);
        }
    }

    pub fn progreso(&self) -> ProgresoPublicacion {
        self.0.lock().unwrap().clone()
    }
}

/// Bytes por quadkey: lo que de verdad ocupa cada tesela en disco, sumando sus
/// imágenes. Es la entrada del troceado.
fn pesos_por_quadkey(almacen: &Almacen, indice_id: i64) -> Result<Vec<(String, u64)>> {
    let publicables = almacen.filas_publicables(indice_id)?;
    let viajan: std::collections::HashSet<i64> = publicables
        .iter()
        .filter(|f| crate::package::redistribucion_de(&f.fuente).viaja(f.licencia.as_deref()))
        .map(|f| f.id)
        .collect();
    let mut pesos: BTreeMap<String, u64> = BTreeMap::new();
    for (id, ruta, qk) in almacen.imagenes_de_indice(indice_id)? {
        if !viajan.contains(&id) {
            continue;
        }
        let bytes = std::fs::metadata(&ruta).map(|m| m.len()).unwrap_or(0);
        *pesos.entry(qk).or_default() += bytes;
    }
    Ok(pesos.into_iter().collect())
}

/// Los repositorios donde se puede publicar. Solo los que la cuenta puede
/// escribir: ofrecer uno donde la subida va a fallar es peor que no listarlo.
pub async fn repos(testigo: &str) -> Result<Vec<Repo>> {
    #[derive(serde::Deserialize)]
    struct R {
        full_name: String,
        private: bool,
        permissions: Option<P>,
    }
    #[derive(serde::Deserialize)]
    struct P {
        push: bool,
    }
    let r: Vec<R> = reqwest::Client::new()
        .get("https://api.github.com/user/repos?per_page=100&sort=updated")
        .bearer_auth(testigo)
        .header("user-agent", "lumi-indexer")
        .send()
        .await?
        .json()
        .await?;
    Ok(r.into_iter()
        .filter(|r| r.permissions.as_ref().map(|p| p.push).unwrap_or(false))
        .map(|r| Repo { nombre: r.full_name, privado: r.private })
        .collect())
}

pub fn previsualizar(almacen: &Almacen, indice_id: i64) -> Result<Previsualizacion> {
    let pesos = pesos_por_quadkey(almacen, indice_id)?;
    let trozos = trocear(&pesos, TOPE_TROZO_BYTES);
    let filas = almacen.filas_publicables(indice_id)?;
    let no_redistribuibles: Vec<String> = crate::package::que_viaja(&filas)
        .into_iter()
        .filter(|p| p.viajan < p.en_el_indice)
        .map(|p| p.fuente)
        .collect();
    Ok(Previsualizacion {
        bytes_total: trozos.iter().map(|t| t.bytes).sum(),
        trozos: trozos
            .iter()
            .map(|t| TrozoPrevisto {
                zona: t.prefijo.clone(),
                quadkeys: t.quadkeys.len(),
                bytes: t.bytes,
            })
            .collect(),
        no_redistribuibles,
    })
}

/// Comprime un conjunto de ficheros en un zip en memoria. Los trozos caben:
/// el tope los mantiene por debajo de 1,8 GB, y escribir a disco un temporal
/// que solo se va a leer una vez para cifrarlo no compra nada.
fn empaquetar(raiz: &Path, ficheros: &[PathBuf]) -> Result<Vec<u8>> {
    let mut z = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
    let opciones: zip::write::FileOptions<'_, ()> =
        zip::write::FileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    for f in ficheros {
        let Ok(rel) = f.strip_prefix(raiz) else { continue };
        let Ok(bytes) = std::fs::read(f) else { continue };
        z.start_file(rel.to_string_lossy().replace('\\', "/"), opciones)?;
        use std::io::Write;
        z.write_all(&bytes)?;
    }
    Ok(z.finish()?.into_inner())
}

fn sha256_hex(b: &[u8]) -> String {
    format!("{:x}", Sha256::digest(b))
}

/// Sube un asset a un release. Tres intentos con espera creciente: si los tres
/// fallan se abandona ESTE asset y el resto queda apuntado en `publicaciones`,
/// que es lo que permite reanudar sin volver a subir lo que ya está.
async fn subir_asset(
    cliente: &reqwest::Client,
    testigo: &str,
    repo: &str,
    release: i64,
    nombre: &str,
    cuerpo: Vec<u8>,
) -> Result<String> {
    let url = format!(
        "https://uploads.github.com/repos/{repo}/releases/{release}/assets?name={}",
        urlencoding::encode(nombre)
    );
    let mut espera = 2u64;
    for intento in 1..=3 {
        let r = cliente
            .post(&url)
            .bearer_auth(testigo)
            .header("user-agent", "lumi-indexer")
            .header("content-type", "application/octet-stream")
            .body(cuerpo.clone())
            .send()
            .await;
        match r {
            Ok(r) if r.status().is_success() => {
                #[derive(serde::Deserialize)]
                struct A {
                    browser_download_url: String,
                }
                let a: A = r.json().await?;
                return Ok(a.browser_download_url);
            }
            Ok(r) => log::warn!("intento {intento} de {nombre}: {}", r.status()),
            Err(e) => log::warn!("intento {intento} de {nombre}: {e}"),
        }
        tokio::time::sleep(std::time::Duration::from_secs(espera)).await;
        espera *= 3;
    }
    bail!("no se pudo subir {nombre} tras tres intentos")
}

/// El release donde van los assets. Si ya existe con esa etiqueta se reutiliza:
/// reanudar una subida cortada no puede crear un release nuevo cada vez.
async fn asegurar_release(
    cliente: &reqwest::Client,
    testigo: &str,
    repo: &str,
    etiqueta: &str,
) -> Result<i64> {
    #[derive(serde::Deserialize)]
    struct R {
        id: i64,
    }
    let existente = cliente
        .get(format!("https://api.github.com/repos/{repo}/releases/tags/{etiqueta}"))
        .bearer_auth(testigo)
        .header("user-agent", "lumi-indexer")
        .send()
        .await?;
    if existente.status().is_success() {
        return Ok(existente.json::<R>().await?.id);
    }
    let creado = cliente
        .post(format!("https://api.github.com/repos/{repo}/releases"))
        .bearer_auth(testigo)
        .header("user-agent", "lumi-indexer")
        .json(&serde_json::json!({ "tag_name": etiqueta, "name": etiqueta }))
        .send()
        .await?;
    if !creado.status().is_success() {
        bail!("no se pudo crear el release: {}", creado.status());
    }
    Ok(creado.json::<R>().await?.id)
}

/// Los ficheros de un trozo: las imágenes de sus quadkeys.
fn ficheros_del_trozo(raiz: &Path, trozo: &Trozo, por_qk: &BTreeMap<String, Vec<String>>) -> Vec<PathBuf> {
    let imgs = raiz.join("imagenes");
    trozo
        .quadkeys
        .iter()
        .filter_map(|q| por_qk.get(q))
        .flatten()
        .filter_map(|nombre| {
            let p = imgs.join(nombre);
            p.exists().then_some(p)
        })
        .collect()
}

/// Todo el trabajo de una publicación, de principio a fin.
#[allow(clippy::too_many_arguments)]
pub async fn publicar(
    almacen: Arc<Almacen>,
    prog: Arc<Publicacion>,
    indice_id: i64,
    repo: String,
    testigo: String,
    autor: String,
    secreta: [u8; 32],
    dependencias: Vec<lumi_index::ficha::Dependencia>,
) -> Result<()> {
    let ruta = almacen
        .ruta_de_indice(indice_id)?
        .ok_or_else(|| anyhow!("ese índice no está sellado"))?;
    let raiz = PathBuf::from(&ruta);
    let nombre_indice =
        almacen.nombre_de_indice(indice_id)?.unwrap_or_else(|| format!("indice-{indice_id}"));
    let paquete = raiz
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| nombre_indice.clone());

    let cliente = reqwest::Client::new();
    let release = asegurar_release(&cliente, &testigo, &repo, &paquete).await?;

    // Una sola clave para todo el paquete: la ofuscación es del alojamiento,
    // no un permiso por asset, y una clave por trozo solo añadiría formas de
    // perder la mitad de un índice.
    let mut semilla = [0u8; 32];
    {
        use rand::RngCore;
        rand::thread_rng().fill_bytes(&mut semilla);
    }
    let clave = cifrado::clave_nueva(semilla);

    // Qué imagen vive en qué quadkey, por nombre de fichero: es como están
    // dentro del paquete sellado.
    let publicables = almacen.filas_publicables(indice_id)?;
    let viajan: std::collections::HashSet<i64> = publicables
        .iter()
        .filter(|f| crate::package::redistribucion_de(&f.fuente).viaja(f.licencia.as_deref()))
        .map(|f| f.id)
        .collect();
    let mut por_qk: BTreeMap<String, Vec<String>> = BTreeMap::new();
    let mut fuentes_por_quadkey: Vec<(String, Vec<String>)> = Vec::new();
    for (id, r, qk) in almacen.imagenes_de_indice(indice_id)? {
        if !viajan.contains(&id) {
            continue;
        }
        if let Some(n) = Path::new(&r).file_name() {
            por_qk.entry(qk).or_default().push(n.to_string_lossy().to_string());
        }
    }
    for qk in por_qk.keys() {
        fuentes_por_quadkey.push((qk.clone(), crate::package::fuentes_que_viajan(&publicables, qk)));
    }

    let pesos = pesos_por_quadkey(&almacen, indice_id)?;
    let trozos = trocear(&pesos, TOPE_TROZO_BYTES);

    let mut cuerpos: Vec<Asset> = Vec::new();
    for t in &trozos {
        let nombre = format!("cuerpo-{}.lumidx.enc", if t.prefijo.is_empty() { "0" } else { &t.prefijo });
        prog.empezar_asset(&nombre);
        if let Some((sha, bytes)) = ya_subido(&almacen, indice_id, &nombre) {
            prog.anotar(format!("{nombre} ya estaba subido"));
            prog.terminar_asset(bytes);
            cuerpos.push(Asset { nombre, sha256: sha, bytes, quadkeys: t.quadkeys.clone() });
            continue;
        }
        let claro = empaquetar(&raiz, &ficheros_del_trozo(&raiz, t, &por_qk))?;
        let sellado = cifrar_asset(&claro, &clave)?;
        let sha = sha256_hex(&sellado);
        let bytes = sellado.len() as u64;
        almacen.publicacion_apuntar(indice_id, &nombre, &sha, bytes)?;
        let url = subir_asset(&cliente, &testigo, &repo, release, &nombre, sellado).await?;
        almacen.publicacion_marcar_subido(indice_id, &nombre, &url)?;
        prog.terminar_asset(bytes);
        cuerpos.push(Asset { nombre, sha256: sha, bytes, quadkeys: t.quadkeys.clone() });
    }

    // Las capas: un asset por modelo, con los fragmentos de todas las teselas.
    let mut capas: Vec<Capa> = Vec::new();
    for (modelo, version, dims) in modelos_del_paquete(&raiz) {
        let nombre = format!("capa-{modelo}-{version}.enc");
        prog.empezar_asset(&nombre);
        if let Some((sha, bytes)) = ya_subido(&almacen, indice_id, &nombre) {
            prog.terminar_asset(bytes);
            capas.push(Capa {
                modelo,
                version,
                dims,
                autor: autor.clone(),
                assets: vec![Asset { nombre, sha256: sha, bytes, quadkeys: vec![] }],
            });
            continue;
        }
        let ficheros = fragmentos_de_modelo(&raiz, &modelo, &version);
        if ficheros.is_empty() {
            prog.anotar(format!("{modelo} no tiene fragmentos en el paquete"));
            continue;
        }
        let sellado = cifrar_asset(&empaquetar(&raiz, &ficheros)?, &clave)?;
        let sha = sha256_hex(&sellado);
        let bytes = sellado.len() as u64;
        almacen.publicacion_apuntar(indice_id, &nombre, &sha, bytes)?;
        let url = subir_asset(&cliente, &testigo, &repo, release, &nombre, sellado).await?;
        almacen.publicacion_marcar_subido(indice_id, &nombre, &url)?;
        prog.terminar_asset(bytes);
        capas.push(Capa {
            modelo,
            version,
            dims,
            autor: autor.clone(),
            assets: vec![Asset { nombre, sha256: sha, bytes, quadkeys: vec![] }],
        });
    }

    // Y AL FINAL la ficha. Hasta este punto no existe nada publicado para
    // nadie: los assets están ahí, pero sin ficha no se encuentran ni se
    // instalan.
    let ahora: i64 = crate::chrono_ahora().parse().unwrap_or(0);
    let mut ficha = Ficha {
        version: 1,
        paquete: paquete.clone(),
        nombre: nombre_indice,
        autor,
        alojamiento: "github".into(),
        clave_publica: String::new(),
        publicada_en: ahora.to_string(),
        vigente_hasta: (ahora + VIGENCIA_DIAS * DIA).to_string(),
        cifrado: STANDARD.encode(clave),
        no_redistribuible: crate::package::que_viaja(&publicables)
            .into_iter()
            .filter(|p| p.viajan < p.en_el_indice)
            .map(|p| p.fuente)
            .collect(),
        fuentes_por_quadkey,
        cuerpos,
        capas,
        dependencias,
        firma: String::new(),
    };
    ficha.firmar(&secreta)?;

    let json = serde_json::to_vec_pretty(&ficha)?;
    prog.empezar_asset("ficha.json");
    almacen.publicacion_apuntar(indice_id, "ficha.json", &sha256_hex(&json), json.len() as u64)?;
    let url = subir_asset(&cliente, &testigo, &repo, release, "ficha.json", json.clone()).await?;
    almacen.publicacion_marcar_subido(indice_id, "ficha.json", &url)?;
    prog.terminar_asset(json.len() as u64);
    Ok(())
}

/// Si este asset ya está subido, su URL. Es lo que hace que reanudar no
/// vuelva a subir cientos de megas que ya están arriba.
fn ya_subido(almacen: &Almacen, indice_id: i64, asset: &str) -> Option<(String, u64)> {
    almacen
        .publicacion_plan(indice_id)
        .ok()?
        .into_iter()
        .find(|(a, subido, url, ..)| a == asset && *subido && url.is_some())
        .map(|(_, _, _, sha, bytes)| (sha, bytes))
}

fn cifrar_asset(claro: &[u8], clave: &[u8; 32]) -> Result<Vec<u8>> {
    let mut nonce = [0u8; 12];
    use rand::RngCore;
    rand::thread_rng().fill_bytes(&mut nonce);
    cifrado::cifrar(claro, clave, nonce)
}

/// Los modelos que hay dentro del paquete sellado, leídos del manifiesto.
fn modelos_del_paquete(raiz: &Path) -> Vec<(String, String, u32)> {
    let Ok(bytes) = std::fs::read(raiz.join("manifiesto.json")) else { return Vec::new() };
    serde_json::from_slice::<lumi_index::manifest::Manifiesto>(&bytes)
        .map(|m| m.modelos)
        .unwrap_or_default()
}

fn fragmentos_de_modelo(raiz: &Path, modelo: &str, version: &str) -> Vec<PathBuf> {
    let Ok(dirs) = std::fs::read_dir(raiz.join("fragmentos")) else { return Vec::new() };
    let mut fuera = Vec::new();
    for d in dirs.flatten() {
        for f in std::fs::read_dir(d.path()).into_iter().flatten().flatten() {
            let n = f.file_name().to_string_lossy().to_string();
            if n.starts_with(&format!("{modelo}-{version}.")) {
                fuera.push(f.path());
            }
        }
    }
    fuera
}
