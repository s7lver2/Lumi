#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod autoactualizacion;
mod comandos;
mod silencioso;

fn main() {
    // Un solo .exe para los tres caminos: si viene con `--silencioso` (lo
    // lanzan el cliente/Indexer al autoactualizarse) o con
    // `--reemplazar-destino=` (se lanza a sí mismo tras descargar una
    // versión nueva de sí mismo, ver `autoactualizacion.rs`) se resuelve
    // sin tocar Tauri en absoluto y el proceso termina — nunca llega a
    // abrir ventana.
    if silencioso::es_invocacion_silenciosa() {
        silencioso::ejecutar_y_salir();
    }
    if autoactualizacion::es_invocacion_reemplazo() {
        autoactualizacion::ejecutar_reemplazo_y_salir();
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_log::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // Silencioso y en segundo plano: si hay una versión más nueva
            // del instalador publicada, esta llamada descarga, relanza, y
            // cierra la app entera antes de que el investigador llegue a
            // hacer nada con ella. Nunca bloquea la apertura de la ventana.
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(autoactualizacion::comprobar_y_lanzar(handle));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            comandos::detectar_instalados, comandos::instalar, comandos::ruta_instalacion_por_defecto,
            comandos::listar_versiones_disponibles, comandos::version_instalador
        ])
        .run(tauri::generate_context!())
        .expect("error al iniciar el instalador");
}
