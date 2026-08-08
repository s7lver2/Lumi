//! Lumi Indexer: la aplicación.
//!
//! Independiente de Lumi Station. No se vincula a ningún servidor, no tiene
//! cuentas ni sesiones: es una herramienta de un solo operador sobre su propia
//! máquina. Lo que produce son paquetes `.lumidx` sellados.

mod crypto;
mod download;
mod ingest;
mod keys;
mod models;
mod origins;
mod package;
mod probe;
mod qdrant;
mod queue;
mod review;
mod runtime;
mod services;
mod spend;
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
    /// La descarga de red en curso, si hay alguna. Se reemplaza entera al
    /// arrancar una nueva: solo hay una a la vez.
    pub descarga: std::sync::Mutex<Option<Arc<download::Descarga>>>,
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
    nombre: String,
    imagenes: lumi_index::manifest::PorcentajesImagenes,
    trabajo: Vec<(String, u32, f64)>,
}

#[tauri::command]
fn indice_detalle(estado: tauri::State<'_, Estado>, id: i64) -> Result<DetalleIndice, String> {
    let filas = estado.almacen.filas_procedencia(id).map_err(|e| e.to_string())?;
    let teselas = estado.almacen.teselas_trabajo(id).map_err(|e| e.to_string())?;
    let nombre = estado
        .almacen
        .listar_indices()
        .map_err(|e| e.to_string())?
        .into_iter()
        .find(|(i, ..)| *i == id)
        .map(|(_, n, ..)| n)
        .unwrap_or_default();
    Ok(DetalleIndice {
        nombre,
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

/// Minúsculas, espacios y símbolos colapsados a un solo `-`, sin guiones en
/// los extremos. Si un nombre no deja nada legible (todo símbolos, o vacío),
/// `crear_indice` se lo dirá a través del `UNIQUE` de `slug`: dos índices
/// nunca deberían acabar los dos en la cadena vacía.
fn slug_de(nombre: &str) -> String {
    let mut slug = String::with_capacity(nombre.len());
    let mut ultimo_fue_guion = true; // evita un `-` inicial
    for c in nombre.to_lowercase().chars() {
        if c.is_alphanumeric() {
            slug.push(c);
            ultimo_fue_guion = false;
        } else if !ultimo_fue_guion {
            slug.push('-');
            ultimo_fue_guion = true;
        }
    }
    slug.trim_end_matches('-').to_string()
}

#[tauri::command]
fn indice_crear(estado: tauri::State<'_, Estado>, nombre: String) -> Result<i64, String> {
    estado.almacen.crear_indice(&nombre, &slug_de(&nombre)).map_err(|e| e.to_string())
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
async fn territorio_clasificar(
    estado: tauri::State<'_, Estado>,
    poligono: Vec<lumi_index::tiles::Punto>,
    fuentes: Vec<String>,
) -> Result<territory::Clasificacion, String> {
    let locales = territory::coberturas_locales(&estado.dir.join("paquetes"));
    // ponytail: el catálogo remoto es del subsistema 8. Hasta entonces solo hay
    // lo instalado, y la salida es pasar aquí lo que el 8 tenga descargado.
    territory::clasificar_area(&poligono, &fuentes, &locales, &[]).map_err(|e| e.to_string())
}

/// Anota como heredadas las teselas que el plan confirmó adjuntar. Se llama al
/// confirmar, no al clasificar: clasificar es mirar, y mirar no cambia de quién
/// es el trabajo.
#[tauri::command]
fn territorio_heredar(
    estado: tauri::State<'_, Estado>,
    indice_id: i64,
    heredadas: Vec<(String, String, String)>,
) -> Result<(), String> {
    for (qk, indice_fuente, sha256) in &heredadas {
        estado
            .almacen
            .anotar_tesela(indice_id, qk, "local", Some(indice_fuente), Some(sha256))
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Se reconstruye en cada comando a propósito: así una clave recién guardada
/// surte efecto sin reiniciar la aplicación.
fn origenes_de(estado: &Estado) -> Vec<origins::Origen> {
    let claves = keys::Claves { almacen: &estado.almacen, maestra: &estado.maestra };
    origins::registro(&claves, estado.dir.join("stage"))
        .into_iter()
        .map(std::sync::Arc::from)
        .collect()
}

#[tauri::command]
async fn origenes_lista(estado: tauri::State<'_, Estado>) -> Result<Vec<probe::FichaOrigen>, String> {
    Ok(probe::fichas(&origenes_de(&estado)))
}

#[tauri::command]
async fn sondear_area(
    estado: tauri::State<'_, Estado>,
    teselas: Vec<String>,
) -> Result<Vec<probe::SondeoTesela>, String> {
    let o = origenes_de(&estado);
    Ok(probe::sondear_area(&estado.almacen, &o, &teselas).await)
}

#[tauri::command]
async fn estimar_area(
    estado: tauri::State<'_, Estado>,
    nuevas: std::collections::BTreeMap<String, Vec<String>>,
) -> Result<probe::Estimacion, String> {
    let o = origenes_de(&estado);
    let claves = keys::Claves { almacen: &estado.almacen, maestra: &estado.maestra };
    Ok(probe::estimar(&estado.almacen, &o, &nuevas, claves.tope_eur()).await)
}

#[tauri::command]
async fn descarga_arrancar(
    estado: tauri::State<'_, Estado>,
    indice_id: i64,
    nuevas: std::collections::BTreeMap<String, Vec<String>>,
    presupuesto_eur: f64,
) -> Result<(), String> {
    let origenes = origenes_de(&estado);
    let modelos: Vec<String> = estado.modelos.iter().map(|m| m.id.clone()).collect();
    let d = std::sync::Arc::new(download::Descarga::nueva(
        estado.almacen.clone(),
        indice_id,
        presupuesto_eur,
        &modelos,
    ));
    *estado.descarga.lock().unwrap() = Some(d.clone());
    tauri::async_runtime::spawn(async move {
        for o in &origenes {
            let Some(teselas) = nuevas.get(o.id()) else { continue };
            d.un_origen(o, teselas).await;
        }
    });
    Ok(())
}

#[tauri::command]
async fn descarga_progreso(estado: tauri::State<'_, Estado>) -> Result<download::Progreso, String> {
    Ok(estado.descarga.lock().unwrap().as_ref().map(|d| d.progreso()).unwrap_or_default())
}

#[tauri::command]
async fn descarga_parar(estado: tauri::State<'_, Estado>) -> Result<(), String> {
    if let Some(d) = estado.descarga.lock().unwrap().as_ref() {
        d.parar();
    }
    Ok(())
}

#[tauri::command]
async fn revision_pendientes(
    estado: tauri::State<'_, Estado>,
    indice_id: i64,
) -> Result<Vec<review::Ficha>, String> {
    // 120 caben en la rejilla sin que el navegador se ahogue decodificando
    // miniaturas. La paginación real llega si hace falta.
    review::pendientes(&estado.almacen, indice_id, 120).map_err(|e| e.to_string())
}

#[tauri::command]
async fn revision_rechazar(
    estado: tauri::State<'_, Estado>,
    indice_id: i64,
    ids: Vec<i64>,
) -> Result<store::Cuentas, String> {
    review::rechazar(&estado.almacen, indice_id, &ids).map_err(|e| e.to_string())
}

#[tauri::command]
async fn revision_aceptar_resto(
    estado: tauri::State<'_, Estado>,
    indice_id: i64,
) -> Result<store::Cuentas, String> {
    review::aceptar_resto(&estado.almacen, indice_id).map_err(|e| e.to_string())
}

/// La clave de un proveedor, para el NAVEGADOR. Solo se entrega la de
/// Mapillary y la de Mapbox: son las dos que el mapa necesita pedir directamente
/// desde el cliente. Ninguna otra sale de aquí.
#[tauri::command]
async fn clave_leer(estado: tauri::State<'_, Estado>, proveedor: String) -> Result<Option<String>, String> {
    if proveedor != "mapillary" && proveedor != "mapbox-satelite" {
        return Err("esa clave no se entrega al frontend".into());
    }
    let c = keys::Claves { almacen: &estado.almacen, maestra: &estado.maestra };
    c.leer(&proveedor).map_err(|e| e.to_string())
}

#[tauri::command]
async fn clave_guardar(
    estado: tauri::State<'_, Estado>,
    proveedor: String,
    clave: String,
) -> Result<(), String> {
    let c = keys::Claves { almacen: &estado.almacen, maestra: &estado.maestra };
    c.guardar(&proveedor, &clave).map_err(|e| e.to_string())
}

/// Se devuelve SI HAY, nunca la clave. La pantalla no necesita el secreto para
/// enseñar «configurada», y entregarlo sería regalarlo al portapapeles de
/// cualquier captura de pantalla.
#[tauri::command]
async fn clave_hay(estado: tauri::State<'_, Estado>, proveedor: String) -> Result<bool, String> {
    let c = keys::Claves { almacen: &estado.almacen, maestra: &estado.maestra };
    Ok(c.hay(&proveedor))
}

#[tauri::command]
async fn tope_leer(estado: tauri::State<'_, Estado>) -> Result<f64, String> {
    let c = keys::Claves { almacen: &estado.almacen, maestra: &estado.maestra };
    Ok(c.tope_eur())
}

#[tauri::command]
async fn tope_fijar(estado: tauri::State<'_, Estado>, eur: f64) -> Result<(), String> {
    if !(0.0..=100_000.0).contains(&eur) {
        return Err("el tope tiene que estar entre 0 y 100 000 €".into());
    }
    let c = keys::Claves { almacen: &estado.almacen, maestra: &estado.maestra };
    c.fijar_tope_eur(eur).map_err(|e| e.to_string())
}

/// `(fuente, unidades, coste)` por origen. Con nombre propio porque el tipo
/// tuplado anida demasiado para que clippy lo deje pasar sin más.
type GastoPorOrigen = Vec<(String, u32, f64)>;

#[tauri::command]
async fn gasto_mes(estado: tauri::State<'_, Estado>) -> Result<(f64, GastoPorOrigen), String> {
    let mes = spend::mes_iso();
    let total = estado.almacen.gasto_del_mes(&mes).map_err(|e| e.to_string())?;
    let por = estado.almacen.gasto_del_mes_por_origen(&mes).map_err(|e| e.to_string())?;
    Ok((total, por))
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

    // Lo que no redistribuye no sale del paquete: ni la imagen ni su vector.
    // El motor verifica geométricamente contra la imagen, así que un vector
    // sin ella le daría al receptor un candidato sin verificar nunca.
    let publicables = estado.almacen.filas_publicables(indice_id).map_err(|e| e.to_string())?;
    let viajan: std::collections::HashSet<i64> = publicables
        .iter()
        .filter(|f| package::redistribucion_de(&f.fuente).viaja(f.licencia.as_deref()))
        .map(|f| f.id)
        .collect();

    // Por quadkey: cada uno es un fragmento, y el orden dentro del fragmento
    // es el mismo id ascendente de `indice.db`.
    let mut por_qk: std::collections::BTreeMap<String, Vec<(i64, String)>> = Default::default();
    for (id, ruta, qk) in &imagenes {
        if !viajan.contains(id) {
            continue;
        }
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
    for (id, ruta, _) in &imagenes {
        if !viajan.contains(id) {
            continue;
        }
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

    // Una entrada por quadkey que de verdad viaja. `por_qk` ya está filtrado
    // por `viajan`, así que aquí no hay que volver a decidir nada: solo contar
    // y declarar de dónde salió cada tesela.
    let mut teselas = Vec::with_capacity(por_qk.len());
    for (qk, filas) in &por_qk {
        let dir = raiz.join("fragmentos").join(qk);
        // El tamaño y el hash del fragmento son lo que hace COMPROBABLE la
        // autoría: quitar la atribución rompería SHA256SUMS.
        let (bytes, sha256) = package::medir_fragmento(&dir).map_err(|e| e.to_string())?;
        teselas.push(lumi_index::coverage::TeselaCubierta {
            quadkey: qk.clone(),
            sha256,
            bytes,
            imagenes: filas.len() as u32,
            fuentes: package::fuentes_que_viajan(&publicables, qk),
        });
    }
    let cobertura = lumi_index::coverage::Cobertura {
        version: 1,
        indice: destino.clone(),
        sellado_en: chrono_ahora(),
        atribucion: lumi_index::coverage::Atribucion {
            autor: String::new(),
            url: String::new(),
            licencia: String::new(),
        },
        teselas,
    };
    std::fs::write(
        raiz.join("cobertura.json"),
        serde_json::to_vec_pretty(&cobertura).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;

    package::firmar(&raiz).map_err(|e| e.to_string())?;
    estado.almacen.sellar_indice(indice_id, &destino).map_err(|e| e.to_string())?;

    Ok(informe)
}

#[tauri::command]
async fn paquete_que_viaja(
    estado: tauri::State<'_, Estado>,
    indice_id: i64,
) -> Result<Vec<package::Publicable>, String> {
    let filas = estado.almacen.filas_publicables(indice_id).map_err(|e| e.to_string())?;
    Ok(package::que_viaja(&filas))
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
        .manage(Estado {
            dir,
            almacen,
            maestra,
            servicios,
            modelos,
            cola,
            descarga: std::sync::Mutex::new(None),
        })
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
            indice_crear,
            indices_lista,
            indice_detalle,
            indice_lotes,
            territorio_clasificar,
            territorio_heredar,
            origenes_lista,
            sondear_area,
            estimar_area,
            descarga_arrancar,
            descarga_progreso,
            descarga_parar,
            revision_pendientes,
            revision_rechazar,
            revision_aceptar_resto,
            clave_leer,
            clave_guardar,
            clave_hay,
            tope_leer,
            tope_fijar,
            gasto_mes,
            mapbox_clave_guardar,
            mapbox_clave_leer,
            paquete_sellar,
            paquete_que_viaja,
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

#[cfg(test)]
mod tests {
    use super::slug_de;

    #[test]
    fn el_slug_baja_a_minusculas_y_colapsa_separadores() {
        assert_eq!(slug_de("Lugo Norte"), "lugo-norte");
        assert_eq!(slug_de("  A Coruña · zona 2  "), "a-coruña-zona-2");
    }

    #[test]
    fn el_slug_no_empieza_ni_termina_en_guion() {
        assert_eq!(slug_de("-- ya --"), "ya");
    }
}
