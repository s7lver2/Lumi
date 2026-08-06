//! Lumi Indexer: la aplicación.
//!
//! Independiente de Lumi Station. No se vincula a ningún servidor, no tiene
//! cuentas ni sesiones: es una herramienta de un solo operador sobre su propia
//! máquina. Lo que produce son paquetes `.lumidx` sellados.

mod crypto;
mod store;

use std::path::PathBuf;

use crypto::Maestra;
use store::Almacen;

pub struct Estado {
    pub dir: PathBuf,
    pub almacen: Almacen,
    pub maestra: Maestra,
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

pub fn run() {
    let dir = directorio();
    let almacen = Almacen::abrir(&dir).expect("no se pudo abrir el almacén");
    let maestra = Maestra::abrir_o_crear(&dir).expect("no se pudo abrir la clave maestra");

    tauri::Builder::default()
        .plugin(tauri_plugin_log::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .manage(Estado { dir, almacen, maestra })
        .invoke_handler(tauri::generate_handler![saludo])
        .run(tauri::generate_context!())
        .expect("no se pudo arrancar el Lumi Indexer");
}
