//! Comprobación de versión nueva contra el canal de actualizaciones — ver
//! `crates/lumi-proto/src/actualizacion.rs` para el formato y la firma.
//! Independiente de Lumi: el Indexer se publica y se comprueba aparte.

use lumi_proto::actualizacion::{Manifiesto, Producto};

/// Misma URL que el cliente (`client/src-tauri/src/main.rs`) — duplicada a
/// propósito, no compartida por una constante en `lumi-proto`, porque es
/// configuración de red de cada app, no parte del protocolo.
const VERSIONES_URL: &str = "https://lumi.s7lver.xyz/api/versiones";

#[derive(serde::Serialize)]
#[serde(tag = "tipo", rename_all = "lowercase")]
pub enum EstadoActualizacion {
    Disponible { version: String, notas: String, url: String },
    Retirada,
    Error { motivo: String },
}

/// `Err` = no se pudo comprobar (sin red, sin firma o firma inválida); el
/// lado TS no pinta nada ante un error. `Ok(None)` = se comprobó y no hay
/// nada nuevo que ofrecer.
/// El manifiesto ya descargado y con la firma comprobada — lo usan tanto
/// `comprobar()` (solo "¿hay algo nuevo?") como `historial()` (todo lo
/// publicado), para no repetir la descarga+verificación en los dos sitios.
async fn manifiesto_verificado() -> Result<Manifiesto, String> {
    let manifiesto: Manifiesto = reqwest::Client::new()
        .get(VERSIONES_URL)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;
    manifiesto.comprobar().map_err(|e| e.to_string())?;
    Ok(manifiesto)
}

pub async fn comprobar() -> Result<Option<EstadoActualizacion>, String> {
    let manifiesto = manifiesto_verificado().await?;
    let version_actual = env!("CARGO_PKG_VERSION");
    if manifiesto.version_retirada(Producto::Indexer, version_actual) {
        return Ok(Some(EstadoActualizacion::Retirada));
    }
    let Some(publi) = manifiesto.mas_nueva(Producto::Indexer, version_actual, "windows-x86_64") else {
        return Ok(None);
    };
    let url = publi
        .artefactos
        .iter()
        .find(|a| a.plataforma == "windows-x86_64")
        .map(|a| a.url.clone())
        .unwrap_or_default();
    Ok(Some(EstadoActualizacion::Disponible {
        version: publi.version.clone(),
        notas: publi.notas.clone(),
        url,
    }))
}

pub fn error_pendiente() -> Option<String> {
    lumi_installer::bitacora::leer_y_borrar_marca_error("indexer").map(|e| e.motivo)
}

#[derive(serde::Serialize)]
pub struct PublicacionInfo {
    pub version: String,
    pub publicado: String,
    pub notas: String,
    pub retirada: bool,
}

/// Historial completo de publicaciones del Indexer, más recientes primero —
/// a diferencia de `comprobar()` (solo "¿hay algo nuevo?"), esto es para la
/// sección de Actualizaciones de Ajustes, donde tiene sentido ver qué
/// cambió en cada versión, no solo la última.
pub async fn historial() -> Result<Vec<PublicacionInfo>, String> {
    let manifiesto = manifiesto_verificado().await?;
    let mut publicaciones: Vec<PublicacionInfo> = manifiesto
        .publicaciones
        .iter()
        .filter(|p| p.producto == Producto::Indexer)
        .map(|p| PublicacionInfo {
            version: p.version.clone(),
            publicado: p.publicado.clone(),
            notas: p.notas.clone(),
            retirada: p.retirada,
        })
        .collect();
    publicaciones.sort_by(|a, b| b.publicado.cmp(&a.publicado));
    Ok(publicaciones)
}

/// `installer.exe` solo vive junto al ejecutable en una instalación real —
/// en un build de desarrollo no lo hay. Mismo aviso que el cliente
/// (`client/src-tauri/src/main.rs::ruta_instalador`).
fn ruta_instalador(carpeta: &std::path::Path) -> Result<std::path::PathBuf, String> {
    let instalador = carpeta.join("installer.exe");
    if !instalador.exists() {
        return Err(format!(
            "no se encontró installer.exe junto a esta app ({}) — en un build de desarrollo no \
             lo hay; hace falta instalar desde el installer.exe real para que esto funcione",
            carpeta.display()
        ));
    }
    Ok(instalador)
}

pub fn disparar_silenciosa(app: tauri::AppHandle, version_nueva: String) -> Result<(), String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let carpeta = exe.parent().ok_or("sin carpeta padre")?;
    let instalador = ruta_instalador(carpeta)?;
    let pid = std::process::id();
    let version_actual = env!("CARGO_PKG_VERSION");

    std::process::Command::new(instalador)
        .arg("--producto=indexer")
        .arg(format!("--pid={pid}"))
        .arg(format!("--version-actual={version_actual}"))
        .arg("--silencioso")
        .spawn()
        .map_err(|e| e.to_string())?;

    let _ = version_nueva;
    app.exit(0);
    Ok(())
}

/// Mismo camino que `disparar_silenciosa`, pero para igualar una versión
/// concreta (downgrade, o simplemente "esta, no la última") en vez de "la
/// más nueva".
pub fn disparar_a_version(app: tauri::AppHandle, version_objetivo: String) -> Result<(), String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let carpeta = exe.parent().ok_or("sin carpeta padre")?;
    let instalador = ruta_instalador(carpeta)?;
    let pid = std::process::id();

    std::process::Command::new(instalador)
        .arg("--producto=indexer")
        .arg(format!("--pid={pid}"))
        .arg(format!("--version-objetivo={version_objetivo}"))
        .arg("--silencioso")
        .spawn()
        .map_err(|e| e.to_string())?;

    app.exit(0);
    Ok(())
}
