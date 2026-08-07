//! Lumi Indexer: la aplicación.
//!
//! Independiente de Lumi Station. No se vincula a ningún servidor, no tiene
//! cuentas ni sesiones: es una herramienta de un solo operador sobre su propia
//! máquina. Lo que produce son paquetes `.lumidx` sellados.

mod crypto;
mod ingest;
mod models;
mod package;
mod qdrant;
mod queue;
mod runtime;
mod services;
mod store;
mod territory;

use std::path::PathBuf;
use std::sync::Arc;

use tauri::Manager;

use crypto::Maestra;
use store::Almacen;

pub struct Estado {
    pub dir: PathBuf,
    pub almacen: Arc<Almacen>,
    pub maestra: Maestra,
    /// Detrás de un `Arc` porque el gancho de salida necesita quedárselo para
    /// pararlos, y en ese punto no se puede seguir prestando el estado.
    pub servicios: Arc<services::Servicios>,
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
async fn servicios_arrancar_wsl(estado: tauri::State<'_, Estado>) -> Result<(), String> {
    estado.servicios.arrancar_wsl().await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn servicios_parar(estado: tauri::State<'_, Estado>) -> Result<(), String> {
    estado.servicios.parar().await.map_err(|e| e.to_string())
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

#[derive(serde::Serialize)]
struct DetalleIndice {
    imagenes: lumi_index::manifest::PorcentajesImagenes,
    trabajo: Vec<(String, u32, f64)>,
}

#[tauri::command]
fn indice_detalle(estado: tauri::State<'_, Estado>, id: i64) -> Result<DetalleIndice, String> {
    let filas = estado.almacen.filas_procedencia(id).map_err(|e| e.to_string())?;
    let teselas = estado.almacen.teselas_trabajo(id).map_err(|e| e.to_string())?;
    Ok(DetalleIndice {
        imagenes: lumi_index::manifest::porcentajes(&filas),
        trabajo: lumi_index::manifest::porcentajes_trabajo(&teselas),
    })
}

#[derive(serde::Serialize)]
struct LoteResumen {
    id: i64,
    clase: String,
    origen: String,
    estado: String,
}

#[tauri::command]
fn indice_lotes(estado: tauri::State<'_, Estado>, id: i64) -> Result<Vec<LoteResumen>, String> {
    Ok(estado
        .almacen
        .listar_lotes(id)
        .map_err(|e| e.to_string())?
        .into_iter()
        .map(|(id, clase, origen, estado)| LoteResumen { id, clase, origen, estado })
        .collect())
}

#[derive(serde::Serialize)]
struct ResumenIndice {
    id: i64,
    nombre: String,
    slug: String,
    estado: String,
    imagenes: u32,
    teselas: u32,
    imagenes_pct: lumi_index::manifest::PorcentajesImagenes,
}

/// Por índice, el mismo cálculo que `indice_detalle` pero solo de imágenes:
/// es lo que pinta la barra de procedencia en la propia fila, sin tener que
/// abrir el detalle para verla.
#[tauri::command]
fn indices_lista(estado: tauri::State<'_, Estado>) -> Result<Vec<ResumenIndice>, String> {
    let indices = estado.almacen.listar_indices().map_err(|e| e.to_string())?;

    indices
        .into_iter()
        .map(|(id, nombre, slug, estado_str)| {
            let filas = estado.almacen.filas_procedencia(id).map_err(|e| e.to_string())?;
            let pct = lumi_index::manifest::porcentajes(&filas);
            Ok(ResumenIndice {
                id,
                nombre,
                slug,
                estado: estado_str,
                imagenes: pct.imagenes_total,
                teselas: pct.teselas_total,
                imagenes_pct: pct,
            })
        })
        .collect()
}

/// El polígono dibujado, ya clasificado tesela a tesela contra lo local y lo
/// publicado. Sin catálogo remoto todavía (el 8), así que por ahora solo mira
/// lo local — el mismo camino de código que usará el 8 cuando exista.
#[tauri::command]
fn territorio_clasificar(
    estado: tauri::State<'_, Estado>,
    poligono: Vec<lumi_index::tiles::Punto>,
) -> Result<territory::Clasificacion, String> {
    let locales = territory::coberturas_locales(&estado.dir.join("paquetes"));
    territory::clasificar_area(&poligono, &locales, &[]).map_err(|e| e.to_string())
}

/// La clave de Mapbox del operador, cifrada con la maestra del equipo. No es
/// un secreto de servidor: vive local, igual que el resto de `ajustes`.
#[tauri::command]
fn mapbox_clave_guardar(estado: tauri::State<'_, Estado>, clave: String) -> Result<(), String> {
    let sellado = estado.maestra.sellar(clave.as_bytes()).map_err(|e| e.to_string())?;
    estado.almacen.guardar_ajuste_sellado("mapbox", &sellado).map_err(|e| e.to_string())
}

#[tauri::command]
fn mapbox_clave_leer(estado: tauri::State<'_, Estado>) -> Result<Option<String>, String> {
    let Some(sellado) = estado.almacen.leer_ajuste_sellado("mapbox").map_err(|e| e.to_string())? else {
        return Ok(None);
    };
    let claro = estado.maestra.abrir(&sellado).map_err(|e| e.to_string())?;
    String::from_utf8(claro).map(Some).map_err(|e| e.to_string())
}

/// Sella un índice: cuenta filas contra vectores, se niega si no cuadran, y
/// solo entonces escribe un solo byte. El paquete resultante lleva binario e
/// int8 de cada modelo, las imágenes, el manifiesto, la cobertura y
/// SHA256SUMS.
#[tauri::command]
async fn paquete_sellar(
    estado: tauri::State<'_, Estado>,
    indice_id: i64,
    destino: String,
) -> Result<package::Informe, String> {
    let modelos: Vec<&models::Modelo> = estado.modelos.iter().collect();
    let esperadas = estado.almacen.total_imagenes(indice_id).map_err(|e| e.to_string())?;

    let mut por_modelo = Vec::new();
    for m in &modelos {
        let hechos = estado.almacen.vectores_hechos(indice_id, &m.id).map_err(|e| e.to_string())?;
        por_modelo.push((m.id.clone(), esperadas, hechos));
    }
    let cuadra = por_modelo.iter().all(|(_, e, v)| e == v);
    let informe = package::Informe { filas: esperadas, por_modelo, cuadra };

    // Se aborta ANTES de escribir un solo byte si las cuentas no cuadran.
    package::comprobar(&informe).map_err(|e| e.to_string())?;

    let raiz = std::path::PathBuf::from(&destino);
    std::fs::create_dir_all(&raiz).map_err(|e| e.to_string())?;
    let imagenes = estado.almacen.imagenes_de_indice(indice_id).map_err(|e| e.to_string())?;

    // Por quadkey: cada uno es un fragmento, y el orden dentro del fragmento
    // es el mismo id ascendente de `indice.db`.
    let mut por_qk: std::collections::BTreeMap<String, Vec<(i64, String)>> = Default::default();
    for (id, ruta, qk) in &imagenes {
        por_qk.entry(qk.clone()).or_default().push((*id, ruta.clone()));
    }

    let qdrant = qdrant::Cliente::nuevo();
    for m in &modelos {
        let coleccion = qdrant::coleccion_de(&m.id, &m.version);
        for (qk, filas) in &por_qk {
            let ids: Vec<i64> = filas.iter().map(|(id, _)| *id).collect();
            let vectores = qdrant.leer(&coleccion, &ids).await.map_err(|e| e.to_string())?;
            let dir = raiz.join("fragmentos").join(qk);
            package::escribir_fragmento(&dir, &m.id, &m.version, &vectores).map_err(|e| e.to_string())?;
        }
    }

    let imgs_dir = raiz.join("imagenes");
    std::fs::create_dir_all(&imgs_dir).map_err(|e| e.to_string())?;
    for (_, ruta, _) in &imagenes {
        let origen = std::path::Path::new(ruta);
        if let Some(nombre) = origen.file_name() {
            // Se copia, no se mueve ni se recomprime: el original de una
            // carpeta local nunca se toca.
            let _ = std::fs::copy(origen, imgs_dir.join(nombre));
        }
    }

    let filas_proc = estado.almacen.filas_procedencia(indice_id).map_err(|e| e.to_string())?;
    let teselas_trab = estado.almacen.teselas_trabajo(indice_id).map_err(|e| e.to_string())?;
    let manifiesto = lumi_index::manifest::Manifiesto {
        version: 1,
        nombre: destino.clone(),
        slug: destino.clone(),
        sellado_en: chrono_ahora(),
        version_indexer: env!("CARGO_PKG_VERSION").to_string(),
        modelos: modelos.iter().map(|m| (m.id.clone(), m.version.clone(), m.dims)).collect(),
        imagenes: lumi_index::manifest::porcentajes(&filas_proc),
        trabajo: lumi_index::manifest::porcentajes_trabajo(&teselas_trab),
        atribuciones: Vec::new(),
    };
    std::fs::write(
        raiz.join("manifiesto.json"),
        serde_json::to_vec_pretty(&manifiesto).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;

    std::fs::write(raiz.join("cobertura.json"), b"{}").map_err(|e| e.to_string())?;

    package::firmar(&raiz).map_err(|e| e.to_string())?;
    estado.almacen.sellar_indice(indice_id, &destino).map_err(|e| e.to_string())?;

    Ok(informe)
}

/// Nada de "abrir con avisos": si `SHA256SUMS` no cuadra, no se abre.
#[tauri::command]
fn paquete_abrir(ruta: String) -> Result<(), String> {
    package::verificar(std::path::Path::new(&ruta)).map_err(|e| e.to_string())
}

fn chrono_ahora() -> String {
    // ponytail: sin dependencia de `chrono` por una sola marca de tiempo; el
    // formato exacto no lo consume nada todavía (el 8 aún no existe), así que
    // basta con segundos desde época en un texto legible.
    let s = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    format!("{s}")
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
    let servicios = Arc::new(services::Servicios::nuevo(dir.clone()));
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
            servicios_arrancar_wsl,
            servicios_parar,
            servicios_estado,
            servicios_log,
            modelos_lista,
            runtime_listo,
            runtime_instalar,
            cola_progreso,
            cola_pausar,
            ingesta_carpeta,
            ingesta_legacy,
            indices_lista,
            indice_detalle,
            indice_lotes,
            territorio_clasificar,
            mapbox_clave_guardar,
            mapbox_clave_leer,
            paquete_sellar,
            paquete_abrir
        ])
        .build(tauri::generate_context!())
        .expect("no se pudo arrancar el Lumi Indexer")
        // `kill_on_drop` solo dispara si el hijo se suelta, y al cerrar la
        // ventana nadie garantiza que el estado gestionado llegue a soltarse.
        // Este gancho es lo que de verdad impide dejar un Redis y un Qdrant
        // huérfanos ocupando sus puertos hasta el siguiente reinicio.
        .run(|app, evento| {
            if matches!(evento, tauri::RunEvent::Exit) {
                let servicios = app.state::<Estado>().servicios.clone();
                tauri::async_runtime::block_on(async move {
                    let _ = servicios.parar().await;
                });
            }
        });
}
