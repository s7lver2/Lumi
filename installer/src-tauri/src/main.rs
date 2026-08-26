#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod comandos;
mod silencioso;

fn main() {
    // Un solo .exe para los dos caminos: si viene con `--silencioso` (lo
    // lanzan el cliente/Indexer al autoactualizarse) se resuelve sin tocar
    // Tauri en absoluto y el proceso termina — nunca llega a abrir ventana.
    if silencioso::es_invocacion_silenciosa() {
        silencioso::ejecutar_y_salir();
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_log::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![comandos::detectar_instalados, comandos::instalar])
        .run(tauri::generate_context!())
        .expect("error al iniciar el instalador");
}
