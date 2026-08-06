//! Lumi Indexer: la aplicación.
//!
//! Independiente de Lumi Station. No se vincula a ningún servidor, no tiene
//! cuentas ni sesiones: es una herramienta de un solo operador sobre su propia
//! máquina. Lo que produce son paquetes `.lumidx` sellados.

mod crypto;
mod models;
mod qdrant;
mod runtime;
mod services;
mod store;

use std::path::PathBuf;

use crypto::Maestra;
use store::Almacen;

pub struct Estado {
    pub dir: PathBuf,
    pub almacen: Almacen,
    pub maestra: Maestra,
    pub servicios: services::Servicios,
    pub modelos: Vec<models::Modelo>,
}

/// Dónde vive todo. `LUMI_INDEXER_DATA` existe para poder correr una instancia
/// de pruebas sin tocar la del operador.
fn directorio() -> PathBuf {
    if let Ok(d) = std::env::var("LUMI_INDEXER_DATA") {
        return PathBuf::from(d);
    }
    let base = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .unwrap_or_else(|_| ".".into());
    PathBuf::from(base).join(".lumi-indexer")
}

#[tauri::command]
fn saludo(estado: tauri::State<'_, Estado>) -> serde_json::Value {
    serde_json::json!({
        "version": env!("CARGO_PKG_VERSION"),
        "so": std::env::consts::OS,
        "dir": estado.dir.display().to_string(),
    })
}

#[tauri::command]
async fn servicios_arrancar(estado: tauri::State<'_, Estado>) -> Result<(), String> {
    estado.servicios.arrancar().await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn servicios_estado(
    estado: tauri::State<'_, Estado>,
) -> Result<Vec<services::EstadoServicio>, String> {
    Ok(estado.servicios.estado().await)
}

#[tauri::command]
fn servicios_log(estado: tauri::State<'_, Estado>, desde: usize) -> Vec<String> {
    estado.servicios.log.desde(desde)
}

#[tauri::command]
fn modelos_lista(estado: tauri::State<'_, Estado>) -> Vec<models::Modelo> {
    estado.modelos.clone()
}

#[tauri::command]
fn runtime_listo(estado: tauri::State<'_, Estado>) -> bool {
    runtime::esta_instalado(&estado.dir)
}

#[tauri::command]
async fn runtime_instalar(estado: tauri::State<'_, Estado>) -> Result<(), String> {
    runtime::instalar(&estado.dir, estado.servicios.log.clone()).await.map_err(|e| e.to_string())
}

pub fn run() {
    let dir = directorio();
    let almacen = Almacen::abrir(&dir).expect("no se pudo abrir el almacén");
    let maestra = Maestra::abrir_o_crear(&dir).expect("no se pudo abrir la clave maestra");
    let servicios = services::Servicios::nuevo(dir.clone());
    let modelos = models::cargar_registro(
        &std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../modelos"),
    );

    tauri::Builder::default()
        .plugin(tauri_plugin_log::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .manage(Estado { dir, almacen, maestra, servicios, modelos })
        .invoke_handler(tauri::generate_handler![
            saludo,
            servicios_arrancar,
            servicios_estado,
            servicios_log,
            modelos_lista,
            runtime_listo,
            runtime_instalar
        ])
        .run(tauri::generate_context!())
        .expect("no se pudo arrancar el Lumi Indexer");
}
