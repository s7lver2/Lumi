//! Lumi Indexer: la aplicación.
//!
//! Independiente de Lumi Station. No se vincula a ningún servidor, no tiene
//! cuentas ni sesiones: es una herramienta de un solo operador sobre su propia
//! máquina. Lo que produce son paquetes `.lumidx` sellados.

mod crypto;
mod ingest;
mod models;
mod qdrant;
mod queue;
mod runtime;
mod services;
mod store;

use std::path::PathBuf;
use std::sync::Arc;

use crypto::Maestra;
use store::Almacen;

pub struct Estado {
    pub dir: PathBuf,
    pub almacen: Arc<Almacen>,
    pub maestra: Maestra,
    pub servicios: services::Servicios,
    pub modelos: Vec<models::Modelo>,
    pub cola: Arc<queue::Cola>,
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

#[tauri::command]
fn cola_progreso(estado: tauri::State<'_, Estado>) -> queue::Progreso {
    estado.cola.progreso()
}

#[tauri::command]
fn cola_pausar(estado: tauri::State<'_, Estado>, pausada: bool) {
    estado.cola.pausar(pausada);
}

#[tauri::command]
fn ingesta_carpeta(
    estado: tauri::State<'_, Estado>,
    indice_id: i64,
    ruta: String,
    tipo: String,
    fuente: String,
    licencia: Option<String>,
) -> Result<ingest::Resumen, String> {
    let modelos: Vec<String> = estado.modelos.iter().map(|m| m.id.clone()).collect();
    ingest::desde_carpeta(
        &estado.almacen,
        indice_id,
        std::path::Path::new(&ruta),
        &tipo,
        &fuente,
        licencia.as_deref(),
        &modelos,
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
fn ingesta_legacy(
    estado: tauri::State<'_, Estado>,
    indice_id: i64,
    ruta: String,
    tipo: Option<String>,
    fuente: String,
    declarada: bool,
) -> Result<ingest::Resumen, String> {
    let modelos: Vec<String> = estado.modelos.iter().map(|m| m.id.clone()).collect();
    let destino = estado.dir.join("imagenes").join(indice_id.to_string());
    ingest::desde_legacy(
        &estado.almacen,
        indice_id,
        std::path::Path::new(&ruta),
        tipo.as_deref(),
        &fuente,
        declarada,
        &modelos,
        &destino,
    )
    .map_err(|e| e.to_string())
}

pub fn run() {
    let dir = directorio();
    let almacen = Arc::new(Almacen::abrir(&dir).expect("no se pudo abrir el almacén"));
    let maestra = Maestra::abrir_o_crear(&dir).expect("no se pudo abrir la clave maestra");
    let servicios = services::Servicios::nuevo(dir.clone());
    let modelos = models::cargar_registro(
        &std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../modelos"),
    );
    let cola = queue::Cola::nueva(dir.clone(), almacen.clone(), servicios.log.clone());
    // ponytail: la tarea 12 no dice cómo se elige el modelo cuando hay varios
    // registrados a la vez (eso es orquestación de territorio/ingesta, fuera
    // de esta tarea). El techo es un solo bucle de cola, contra el primer
    // modelo del registro; la salida, si hiciera falta, es un bucle por
    // modelo — pero eso exige separar el estado "hecho" de un lote por
    // modelo, que hoy es una sola columna compartida en `lotes`.
    if let Some(m) = modelos.first() {
        cola.clone().arrancar_bucle(m.id.clone(), m.dims, m.version.clone());
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_log::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .manage(Estado { dir, almacen, maestra, servicios, modelos, cola })
        .invoke_handler(tauri::generate_handler![
            saludo,
            servicios_arrancar,
            servicios_estado,
            servicios_log,
            modelos_lista,
            runtime_listo,
            runtime_instalar,
            cola_progreso,
            cola_pausar,
            ingesta_carpeta,
            ingesta_legacy
        ])
        .run(tauri::generate_context!())
        .expect("no se pudo arrancar el Lumi Indexer");
}
