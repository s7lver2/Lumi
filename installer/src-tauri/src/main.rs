#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod comandos;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_log::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![comandos::detectar_instalados, comandos::instalar])
        .run(tauri::generate_context!())
        .expect("error al iniciar el instalador");
}
