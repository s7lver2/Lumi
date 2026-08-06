//! Lumi Indexer: la aplicación.
//!
//! Independiente de Lumi Station. No se vincula a ningún servidor, no tiene
//! cuentas ni sesiones: es una herramienta de un solo operador sobre su propia
//! máquina. Lo que produce son paquetes `.lumidx` sellados.

/// Versión y plataforma, que es lo primero que la interfaz necesita saber:
/// en Windows el aprovisionamiento tiene que avisar de que Redis va por WSL.
#[tauri::command]
fn saludo() -> serde_json::Value {
    serde_json::json!({
        "version": env!("CARGO_PKG_VERSION"),
        "so": std::env::consts::OS,
    })
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_log::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![saludo])
        .run(tauri::generate_context!())
        .expect("no se pudo arrancar el Lumi Indexer");
}
