//! Lumi Indexer: la aplicación.
//!
//! Independiente de Lumi Station. No se vincula a ningún servidor, no tiene
//! cuentas ni sesiones: es una herramienta de un solo operador sobre su propia
//! máquina. Lo que produce son paquetes `.lumidx` sellados.

mod catalogo;
mod crypto;
mod download;
mod identidad;
mod ingest;
mod keys;
mod models;
mod origins;
mod package;
mod perf;
mod proceso;
mod probe;
mod publicar;
mod qdrant;
mod queue;
mod red;
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
    /// La importación legacy en curso, si hay alguna. Mismo patrón que
    /// `descarga`: un paquete real tarda segundos en descifrarse y parsear, y
    /// sin este estado el comando de progreso no tiene nada que leer.
    pub ingesta: std::sync::Mutex<Option<Arc<ingest::Ingesta>>>,
    /// El sondeo de disponibilidad en curso, si hay alguno. Mismo patrón:
    /// un área grande sondea muchas teselas contra varios orígenes a la vez,
    /// y sin este estado no hay dónde leer lo que ya ha llegado.
    pub sondeo: std::sync::Mutex<Option<Arc<probe::Sondeo>>>,
    /// El sellado en curso, si hay alguno. Mismo patrón que `descarga` e
    /// `ingesta`: sellar miles de imágenes tarda, y sin este estado el
    /// comando de progreso no tiene nada que leer.
    pub sellado: std::sync::Mutex<Option<Arc<package::Sellado>>>,
    /// El código de dispositivo en vuelo entre `arrancar` y `sondear`. En
    /// memoria y no en disco: si la aplicación se cierra a mitad, el código
    /// caduca solo y volver a empezar cuesta un clic.
    pub identidad_en_curso: std::sync::Mutex<Option<(String, String)>>, // (proveedor, device_code)
    /// La publicación en curso, si hay alguna. Mismo patrón que `descarga`.
    pub publicacion: std::sync::Mutex<Option<Arc<publicar::Publicacion>>>,
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
async fn rendimiento_leer() -> Result<perf::Rendimiento, String> {
    tokio::task::spawn_blocking(perf::leer).await.map_err(|e| e.to_string())
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
async fn servicios_diagnostico(estado: tauri::State<'_, Estado>) -> Result<services::Diagnostico, String> {
    Ok(estado.servicios.diagnostico().await)
}

/// Cuánto del fichero de log se enseña y se copia. No todo: con TRACE de
/// reqwest de por medio, un fichero de 8 MB no cabe cómodo en una caja de
/// texto ni en un mensaje. La cola es lo que importa cuando algo acaba de
/// pasar, que es para lo que existe esta pestaña.
const DEBUG_LOG_TOPE_BYTES: usize = 300_000;

#[tauri::command]
fn debug_log_leer(app: tauri::AppHandle) -> Result<String, String> {
    let ruta = app.path().app_log_dir().map_err(|e| e.to_string())?.join("indexer.log");
    let bytes = std::fs::read(&ruta).map_err(|e| format!("{}: {e}", ruta.display()))?;
    let desde = bytes.len().saturating_sub(DEBUG_LOG_TOPE_BYTES);
    // Cortar en un byte cualquiera puede caer en mitad de un carácter UTF-8;
    // se avanza hasta el siguiente arranque de carácter válido en vez de
    // fallar la lectura entera por un corte a ciegas.
    let desde = desde + bytes[desde..].iter().take_while(|b| (**b & 0b1100_0000) == 0b1000_0000).count();
    Ok(String::from_utf8_lossy(&bytes[desde..]).into_owned())
}

/// La clave en `ajustes` que dice si el asistente inicial ya se completó una
/// vez. Sin esto, cada arranque volvía a enseñar "Servicios / Runtime /
/// Modelos" aunque todo siguiera instalado — tres clics de "Continuar" para
/// no decidir nada, cada vez que se abre la app.
const CLAVE_SETUP_COMPLETO: &str = "setup_completo";

#[tauri::command]
fn setup_completo(estado: tauri::State<'_, Estado>) -> bool {
    estado.almacen.leer_ajuste(CLAVE_SETUP_COMPLETO).ok().flatten().as_deref() == Some("1")
}

#[tauri::command]
fn setup_marcar_completo(estado: tauri::State<'_, Estado>) -> Result<(), String> {
    estado.almacen.guardar_ajuste(CLAVE_SETUP_COMPLETO, "1").map_err(|e| e.to_string())
}

/// Repetir el asistente no es un reseteo de nada: solo hace que el próximo
/// arranque (o la vuelta desde Ajustes, sin ni reabrir la app) vuelva a
/// enseñarlo. Lo instalado —runtime, modelos, servicios— sigue exactamente
/// como estaba.
#[tauri::command]
fn setup_reiniciar(estado: tauri::State<'_, Estado>) -> Result<(), String> {
    estado.almacen.borrar_ajuste(CLAVE_SETUP_COMPLETO).map_err(|e| e.to_string())
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
fn cola_progreso(estado: tauri::State<'_, Estado>) -> Vec<queue::Progreso> {
    estado.cola.progreso()
}

#[derive(serde::Serialize)]
struct ProgresoIndiceEmbed {
    modelo_id: String,
    hechas: u32,
    total: u32,
    /// Si el trabajador de este modelo está en ESTE índice ahora mismo, o
    /// está ocupado con otro y este se queda esperando su turno. Sin esto,
    /// dos índices con trabajo pendiente a la vez se veían idénticos aunque
    /// uno estuviera avanzando y el otro ni hubiera empezado.
    activo: bool,
    lote_hechas: u32,
    lote_total: u32,
    pausada: bool,
    guardado_fallos: u32,
}

/// El progreso de embebido de ESTE índice, por modelo — no el de cualquiera
/// que la cola tenga entre manos ahora mismo. `cola_progreso` refleja el
/// trabajador entero, que procesa los índices con pendientes en orden y por
/// turnos: con dos índices a la vez, la fila de un modelo podía enseñar el
/// total de UNO mientras se miraba el detalle del OTRO, y los dos números no
/// tenían nada que ver entre sí.
#[tauri::command]
fn indice_progreso_embebido(
    estado: tauri::State<'_, Estado>,
    id: i64,
) -> Result<Vec<ProgresoIndiceEmbed>, String> {
    let cola = estado.cola.progreso();
    estado
        .modelos
        .iter()
        .map(|m| {
            let (hechas, total) = estado.almacen.progreso_indice(id, &m.id).map_err(|e| e.to_string())?;
            let fila = cola.iter().find(|p| p.modelo_id == m.id);
            let activo = fila.is_some_and(|p| p.indice_actual == Some(id));
            Ok(ProgresoIndiceEmbed {
                modelo_id: m.id.clone(),
                hechas,
                total,
                activo,
                lote_hechas: if activo { fila.map(|p| p.hechas).unwrap_or(0) } else { 0 },
                lote_total: if activo { fila.map(|p| p.total).unwrap_or(0) } else { 0 },
                pausada: fila.is_some_and(|p| p.pausada),
                guardado_fallos: if activo { fila.map(|p| p.guardado_fallos).unwrap_or(0) } else { 0 },
            })
        })
        .collect()
}

#[tauri::command]
fn cola_pausar(estado: tauri::State<'_, Estado>, pausada: bool) {
    estado.cola.pausar(pausada);
}

/// La guarda de «sellar es irreversible»: se llama al principio de todo
/// comando que escribe contra un `indice_id` ya elegido, antes de tocar nada.
fn exige_abierto(estado: &Estado, indice_id: i64) -> Result<(), String> {
    if estado.almacen.indice_sellado(indice_id).map_err(|e| e.to_string())? {
        return Err("este índice está sellado: un paquete sellado no se sigue llenando".into());
    }
    Ok(())
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
    exige_abierto(&estado, indice_id)?;
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
    slug: String,
    estado: String,
    imagenes: lumi_index::manifest::PorcentajesImagenes,
    trabajo: Vec<(String, u32, f64)>,
}

#[tauri::command]
fn indice_detalle(estado: tauri::State<'_, Estado>, id: i64) -> Result<DetalleIndice, String> {
    let filas = estado.almacen.filas_procedencia(id).map_err(|e| e.to_string())?;
    let teselas = estado.almacen.teselas_trabajo(id).map_err(|e| e.to_string())?;
    let (nombre, slug, estado_str) = estado
        .almacen
        .listar_indices()
        .map_err(|e| e.to_string())?
        .into_iter()
        .find(|(i, ..)| *i == id)
        .map(|(_, n, s, e)| (n, s, e))
        .unwrap_or_default();
    Ok(DetalleIndice {
        nombre,
        slug,
        estado: estado_str,
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

#[tauri::command]
fn lote_cancelar(estado: tauri::State<'_, Estado>, id: i64) -> Result<bool, String> {
    estado.almacen.cancelar_lote(id).map_err(|e| e.to_string())
}

/// Borra un índice entero. Los ficheros de imagen en disco y los puntos ya
/// subidos a Qdrant se limpian aparte, no por SQLite; lo de Qdrant es
/// best-effort a propósito — un punto huérfano ahí no hace daño, pero
/// bloquear el borrado porque Qdrant no respondió sí lo haría.
#[tauri::command]
async fn indice_borrar(estado: tauri::State<'_, Estado>, id: i64) -> Result<(), String> {
    let hechos = estado.almacen.vectores_hechos_de_indice(id).map_err(|e| e.to_string())?;
    estado.almacen.borrar_indice(id).map_err(|e| e.to_string())?;

    let dir = estado.dir.join("imagenes").join(id.to_string());
    let _ = std::fs::remove_dir_all(&dir);

    if !hechos.is_empty() {
        let mut por_modelo: std::collections::BTreeMap<String, Vec<i64>> = Default::default();
        for (modelo, imagen_id) in hechos {
            por_modelo.entry(modelo).or_default().push(imagen_id);
        }
        let cliente = qdrant::Cliente::nuevo();
        for (modelo_id, ids) in por_modelo {
            let Some(m) = estado.modelos.iter().find(|m| m.id == modelo_id) else { continue };
            let coleccion = qdrant::coleccion_de(&m.id, &m.version);
            if let Err(e) = cliente.borrar(&coleccion, &ids).await {
                log::warn!("indice {id}: no se pudieron borrar {} puntos de {coleccion}: {e}", ids.len());
            }
        }
    }
    Ok(())
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
    publicado: bool,
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
    let publicados = estado.almacen.indices_publicados().map_err(|e| e.to_string())?;

    indices
        .into_iter()
        .map(|(id, nombre, slug, estado_str)| {
            let filas = estado.almacen.filas_procedencia(id).map_err(|e| e.to_string())?;
            let pct = lumi_index::manifest::porcentajes(&filas);
            Ok(ResumenIndice {
                publicado: publicados.contains(&id),
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

/// Los puntos y metadatos de un índice, para el visor de mapa/galería que se
/// abre desde «Abrir en mapa» en el detalle del índice.
#[tauri::command]
fn indice_imagenes(estado: tauri::State<'_, Estado>, id: i64) -> Result<Vec<store::FilaMapa>, String> {
    estado.almacen.imagenes_mapa(id).map_err(|e| e.to_string())
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
    let mut c =
        territory::clasificar_area(&poligono, &fuentes, &locales, &[]).map_err(|e| e.to_string())?;

    // El descuento se aplica ANTES de devolver, para que el coste en euros que
    // el operador ve ya lleve descontado lo que cubre otro. Ese es el punto
    // entero del reclamo: si el descuento llegara después, ya habría decidido.
    let quadkeys: Vec<String> = c.teselas.iter().map(|(q, _)| q.clone()).collect();
    let reclamos = catalogo::reclamos(&estado.almacen, &quadkeys).map_err(|e| e.to_string())?;
    let pares: Vec<(String, String)> =
        reclamos.iter().map(|r| (r.quadkey.clone(), r.fuente.clone())).collect();
    lumi_index::coverage::descontar_reclamadas(&mut c.teselas, &pares);
    for (qk, e) in c.teselas.iter_mut() {
        if let lumi_index::coverage::Estado::Reclamada { paquete, autor } = e {
            if let Some(r) = reclamos.iter().find(|r| &r.quadkey == qk) {
                *paquete = r.paquete.clone();
                *autor = r.autor.clone();
            }
        }
    }
    let reparto = lumi_index::coverage::repartir(&c.teselas);
    c.nuevas = reparto.nuevas;
    c.reclamadas = reparto.reclamadas;
    Ok(c)
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
    exige_abierto(&estado, indice_id)?;
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

/// Arranca el sondeo en segundo plano y vuelve enseguida: todas las
/// combinaciones origen×tesela salen a la vez, y esperar aquí a que
/// terminaran todas era exactamente lo que dejaba el mapa entero en gris
/// hasta el final en vez de ir coloreándose. El progreso se lee aparte, con
/// `sondear_area_progreso`.
#[tauri::command]
async fn sondear_area_arrancar(
    estado: tauri::State<'_, Estado>,
    teselas: Vec<String>,
) -> Result<(), String> {
    let origenes = origenes_de(&estado);
    let almacen = estado.almacen.clone();
    let total = (origenes.len() * teselas.len()) as u32;
    let s = Arc::new(probe::Sondeo::nuevo(total));
    *estado.sondeo.lock().unwrap() = Some(s.clone());
    tauri::async_runtime::spawn(async move {
        probe::sondear_area(almacen, origenes, teselas, s).await;
    });
    Ok(())
}

#[tauri::command]
async fn sondear_area_progreso(
    estado: tauri::State<'_, Estado>,
) -> Result<probe::ProgresoSondeo, String> {
    Ok(estado.sondeo.lock().unwrap().as_ref().map(|s| s.progreso()).unwrap_or_default())
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
    imagenes_estimadas: u32,
) -> Result<(), String> {
    exige_abierto(&estado, indice_id)?;
    // Se escribe ANTES de arrancar: si la app se cierra en el segundo entre
    // esto y el primer progreso, el plan ya quedó anotado y es reanudable.
    let plan = download::PlanDescarga { indice_id, nuevas: nuevas.clone(), presupuesto_eur, imagenes_estimadas };
    if let Ok(json) = serde_json::to_string(&plan) {
        let _ = estado.almacen.guardar_ajuste(download::CLAVE_PLAN_PENDIENTE, &json);
    }
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
        d.correr(&origenes, &nuevas).await;
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

#[derive(serde::Serialize)]
struct PlanPendiente {
    plan: download::PlanDescarga,
    nombre_indice: String,
}

/// Lo que quedó anotado si la app se cerró a mitad de una descarga. `None` en
/// el caso normal (nunca hubo una, o la última terminó bien). Si el índice ya
/// no existe —se borró entretanto— el plan es basura y se limpia solo.
#[tauri::command]
fn descarga_pendiente(estado: tauri::State<'_, Estado>) -> Result<Option<PlanPendiente>, String> {
    let Some(json) = estado.almacen.leer_ajuste(download::CLAVE_PLAN_PENDIENTE).map_err(|e| e.to_string())? else {
        return Ok(None);
    };
    let Ok(plan) = serde_json::from_str::<download::PlanDescarga>(&json) else {
        let _ = estado.almacen.borrar_ajuste(download::CLAVE_PLAN_PENDIENTE);
        return Ok(None);
    };
    match estado.almacen.nombre_de_indice(plan.indice_id) {
        Ok(Some(nombre_indice)) => Ok(Some(PlanPendiente { nombre_indice, plan })),
        _ => {
            let _ = estado.almacen.borrar_ajuste(download::CLAVE_PLAN_PENDIENTE);
            Ok(None)
        }
    }
}

#[tauri::command]
fn descarga_pendiente_descartar(estado: tauri::State<'_, Estado>) -> Result<(), String> {
    estado.almacen.borrar_ajuste(download::CLAVE_PLAN_PENDIENTE).map_err(|e| e.to_string())
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
    estado.almacen.guardar_ajuste_sellado(keys::CLAVE_MAPBOX, &sellado).map_err(|e| e.to_string())
}

#[tauri::command]
fn mapbox_clave_leer(estado: tauri::State<'_, Estado>) -> Result<Option<String>, String> {
    let Some(sellado) = estado.almacen.leer_ajuste_sellado(keys::CLAVE_MAPBOX).map_err(|e| e.to_string())? else {
        return Ok(None);
    };
    let claro = estado.maestra.abrir(&sellado).map_err(|e| e.to_string())?;
    String::from_utf8(claro).map(Some).map_err(|e| e.to_string())
}

/// Arranca el sellado en segundo plano y vuelve enseguida: cuenta filas
/// contra vectores, se niega si no cuadran, y solo entonces escribe un solo
/// byte. El progreso se lee aparte, con `paquete_sellar_progreso`.
#[tauri::command]
async fn paquete_sellar_arrancar(
    estado: tauri::State<'_, Estado>,
    indice_id: i64,
    destino: String,
) -> Result<(), String> {
    exige_abierto(&estado, indice_id)?;
    let almacen = estado.almacen.clone();
    let modelos = estado.modelos.clone();
    let s = Arc::new(package::Sellado::nuevo(0));
    *estado.sellado.lock().unwrap() = Some(s.clone());
    tauri::async_runtime::spawn(async move {
        let r = sellar(&almacen, &modelos, indice_id, &destino, &s).await;
        s.terminar(r);
    });
    Ok(())
}

#[tauri::command]
fn paquete_sellar_progreso(estado: tauri::State<'_, Estado>) -> package::ProgresoSellado {
    estado.sellado.lock().unwrap().as_ref().map(|s| s.progreso()).unwrap_or_default()
}

/// El sellado de verdad. El paquete resultante lleva binario e int8 de cada
/// modelo, las imágenes, el manifiesto, la cobertura y SHA256SUMS.
async fn sellar(
    almacen: &store::Almacen,
    modelos: &[models::Modelo],
    indice_id: i64,
    destino: &str,
    prog: &package::Sellado,
) -> Result<package::Informe, String> {
    prog.etapa("comprobando");
    let esperadas = almacen.total_imagenes(indice_id).map_err(|e| e.to_string())?;

    let mut por_modelo = Vec::new();
    for m in modelos {
        let hechos = almacen.vectores_hechos(indice_id, &m.id).map_err(|e| e.to_string())?;
        por_modelo.push((m.id.clone(), esperadas, hechos));
    }
    let cuadra = por_modelo.iter().all(|(_, e, v)| e == v);
    let informe = package::Informe { filas: esperadas, por_modelo, cuadra };

    // Se aborta ANTES de escribir un solo byte si las cuentas no cuadran.
    package::comprobar(&informe).map_err(|e| e.to_string())?;

    let raiz = std::path::PathBuf::from(destino);
    std::fs::create_dir_all(&raiz).map_err(|e| e.to_string())?;
    let imagenes = almacen.imagenes_de_indice(indice_id).map_err(|e| e.to_string())?;

    // Lo que no redistribuye no sale del paquete: ni la imagen ni su vector.
    // El motor verifica geométricamente contra la imagen, así que un vector
    // sin ella le daría al receptor un candidato sin verificar nunca.
    let publicables = almacen.filas_publicables(indice_id).map_err(|e| e.to_string())?;
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

    // El total real: un paso por fragmento (modelo × quadkey publicable) y
    // uno por imagen que viaja. Se fija aquí, justo antes del primer avance,
    // porque hasta ahora no se conocía cuánto de verdad viaja.
    let imagenes_que_viajan = imagenes.iter().filter(|(id, ..)| viajan.contains(id)).count();
    prog.fijar_total((por_qk.len() * modelos.len() + imagenes_que_viajan) as u32);
    prog.etapa("vectores");

    let qdrant = qdrant::Cliente::nuevo();
    for m in modelos {
        let coleccion = qdrant::coleccion_de(&m.id, &m.version);
        for (qk, filas) in &por_qk {
            let ids: Vec<i64> = filas.iter().map(|(id, _)| *id).collect();
            let vectores = qdrant.leer(&coleccion, &ids).await.map_err(|e| e.to_string())?;
            let dir = raiz.join("fragmentos").join(qk);
            package::escribir_fragmento(&dir, &m.id, &m.version, &vectores).map_err(|e| e.to_string())?;
            prog.avanzar();
        }
    }

    prog.etapa("imágenes");
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
        prog.avanzar();
    }

    prog.etapa("manifiesto");
    let filas_proc = almacen.filas_procedencia(indice_id).map_err(|e| e.to_string())?;
    let teselas_trab = almacen.teselas_trabajo(indice_id).map_err(|e| e.to_string())?;
    let manifiesto = lumi_index::manifest::Manifiesto {
        version: 1,
        nombre: destino.to_string(),
        slug: destino.to_string(),
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
        indice: destino.to_string(),
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

    prog.etapa("firmando");
    package::firmar(&raiz).map_err(|e| e.to_string())?;
    almacen.sellar_indice(indice_id, destino).map_err(|e| e.to_string())?;

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

// --- Identidad -------------------------------------------------------------
//
// La identidad es opcional: sin ella la aplicación funciona entera menos
// publicar. Por eso ningún otro comando la consulta.

#[tauri::command]
async fn identidad_arrancar(
    estado: tauri::State<'_, Estado>,
    proveedor: String,
) -> Result<identidad::CodigoDispositivo, String> {
    let (codigo, device_code) =
        identidad::arrancar(&proveedor).await.map_err(|e| e.to_string())?;
    log::info!(
        "codigo de dispositivo pedido: {} (device_code {}…)",
        codigo.codigo,
        &device_code[..device_code.len().min(8)],
    );
    *estado.identidad_en_curso.lock().unwrap() = Some((proveedor, device_code));
    Ok(codigo)
}

#[derive(serde::Serialize)]
struct RespuestaSondeo {
    sesion: Option<identidad::Sesion>,
    /// Cuando GitHub pide ir más despacio: quien llama suma 5 segundos a su
    /// intervalo de sondeo y sigue desde ahí. Ignorarlo deja la pantalla en
    /// «esperando…» para siempre, incluso después de autorizar.
    mas_despacio: bool,
}

#[tauri::command]
async fn identidad_sondear(estado: tauri::State<'_, Estado>) -> Result<RespuestaSondeo, String> {
    // El candado se suelta antes del `await`: un guard vivo cruzando un punto
    // de espera no es `Send` y el comando no compilaría.
    let en_curso = estado.identidad_en_curso.lock().unwrap().clone();
    let Some((_, device_code)) = en_curso else {
        return Ok(RespuestaSondeo { sesion: None, mas_despacio: false });
    };
    let (mut sesion, testigo) = match identidad::sondear(&device_code).await.map_err(|e| e.to_string())? {
        identidad::Sondeo::Pendiente => return Ok(RespuestaSondeo { sesion: None, mas_despacio: false }),
        identidad::Sondeo::MasDespacio => return Ok(RespuestaSondeo { sesion: None, mas_despacio: true }),
        identidad::Sondeo::Lista(sesion, testigo) => (sesion, testigo),
    };

    let claves = keys::Claves { almacen: &estado.almacen, maestra: &estado.maestra };
    // Entrar por primera vez es también el momento de tener clave de firma:
    // sin ella la sesión no sirve para publicar, que es lo único para lo que
    // la sesión existe.
    if identidad::leer_clave(&claves).is_err() {
        identidad::crear_clave(&claves).map_err(|e| e.to_string())?;
    }
    sesion.huella = identidad::huella_actual(&claves).unwrap_or_default();
    identidad::guardar_sesion(&estado.almacen, &claves, &sesion, &testigo)
        .map_err(|e| e.to_string())?;
    *estado.identidad_en_curso.lock().unwrap() = None;
    Ok(RespuestaSondeo { sesion: Some(sesion), mas_despacio: false })
}

#[tauri::command]
async fn identidad_leer(
    estado: tauri::State<'_, Estado>,
) -> Result<Option<identidad::Sesion>, String> {
    identidad::leer_sesion(&estado.almacen).map_err(|e| e.to_string())
}

#[tauri::command]
async fn identidad_cerrar(estado: tauri::State<'_, Estado>) -> Result<(), String> {
    let claves = keys::Claves { almacen: &estado.almacen, maestra: &estado.maestra };
    // La clave de firma NO se borra al cerrar sesión: lo ya publicado tiene
    // que poder seguir comprobándose, y volver a entrar con otra cuenta no
    // cambia quién hizo los paquetes.
    identidad::cerrar_sesion(&estado.almacen, &claves).map_err(|e| e.to_string())
}

#[tauri::command]
async fn identidad_respaldo(estado: tauri::State<'_, Estado>) -> Result<Vec<String>, String> {
    let claves = keys::Claves { almacen: &estado.almacen, maestra: &estado.maestra };
    identidad::respaldo(&claves).map_err(|e| e.to_string())
}

#[tauri::command]
async fn identidad_rotar(estado: tauri::State<'_, Estado>) -> Result<Vec<String>, String> {
    let claves = keys::Claves { almacen: &estado.almacen, maestra: &estado.maestra };
    identidad::rotar(&claves).map_err(|e| e.to_string())
}

#[tauri::command]
async fn identidad_respaldo_guardar(ruta: String, palabras: Vec<String>) -> Result<(), String> {
    std::fs::write(&ruta, identidad::respaldo_como_texto(&palabras)).map_err(|e| e.to_string())
}

// --- Catálogo remoto -------------------------------------------------------

#[tauri::command]
async fn catalogo_refrescar(estado: tauri::State<'_, Estado>) -> Result<u32, String> {
    let n = catalogo::refrescar(&estado.almacen).await.map_err(|e| e.to_string())?;
    // Un fallo de la web no es un error: se sigue con la última lista.
    let _ = catalogo::refrescar_desreclamos(&estado.almacen).await;
    let _ = catalogo::comprobar_vivos(&estado.almacen).await;
    Ok(n)
}

#[tauri::command]
async fn catalogo_buscar(
    estado: tauri::State<'_, Estado>,
    texto: String,
) -> Result<catalogo::Resultados, String> {
    catalogo::buscar(&estado.almacen, &texto).map_err(|e| e.to_string())
}

#[tauri::command]
async fn catalogo_perfil(
    estado: tauri::State<'_, Estado>,
    cuenta: String,
) -> Result<catalogo::Perfil, String> {
    catalogo::perfil(&estado.almacen, &cuenta).map_err(|e| e.to_string())
}

#[tauri::command]
async fn catalogo_perfil_github(cuenta: String) -> Result<catalogo::PerfilGithub, String> {
    catalogo::perfil_github(&cuenta).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn catalogo_mios(
    estado: tauri::State<'_, Estado>,
) -> Result<Vec<catalogo::RepoRemoto>, String> {
    let cuenta = identidad::leer_sesion(&estado.almacen)
        .map_err(|e| e.to_string())?
        .map(|s| s.cuenta)
        .unwrap_or_default();
    catalogo::mios(&estado.almacen, &cuenta).map_err(|e| e.to_string())
}

#[tauri::command]
async fn catalogo_reclamos(
    estado: tauri::State<'_, Estado>,
    quadkeys: Vec<String>,
) -> Result<Vec<catalogo::Reclamo>, String> {
    catalogo::reclamos(&estado.almacen, &quadkeys).map_err(|e| e.to_string())
}

#[tauri::command]
async fn catalogo_dependencias_rotas(
    estado: tauri::State<'_, Estado>,
) -> Result<Vec<catalogo::DependenciaRota>, String> {
    let cuenta = identidad::leer_sesion(&estado.almacen)
        .map_err(|e| e.to_string())?
        .map(|s| s.cuenta)
        .unwrap_or_default();
    catalogo::dependencias_rotas(&estado.almacen, &cuenta).map_err(|e| e.to_string())
}

#[tauri::command]
async fn catalogo_capas(
    estado: tauri::State<'_, Estado>,
) -> Result<Vec<catalogo::CapaRemota>, String> {
    catalogo::capas(&estado.almacen).map_err(|e| e.to_string())
}

// --- Publicar --------------------------------------------------------------

#[tauri::command]
async fn publicar_repos(estado: tauri::State<'_, Estado>) -> Result<Vec<publicar::Repo>, String> {
    let claves = keys::Claves { almacen: &estado.almacen, maestra: &estado.maestra };
    let testigo = identidad::leer_testigo(&claves).map_err(|e| e.to_string())?;
    publicar::repos(&testigo).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn publicar_previsualizar(
    estado: tauri::State<'_, Estado>,
    indice_id: i64,
) -> Result<publicar::Previsualizacion, String> {
    publicar::previsualizar(&estado.almacen, indice_id).map_err(|e| e.to_string())
}

#[tauri::command]
async fn publicar_arrancar(
    estado: tauri::State<'_, Estado>,
    indice_id: i64,
    repo: String,
    descargo: bool,
) -> Result<(), String> {
    // Publicar un indice abierto no tiene sentido: el contenido cambiaria
    // bajo los pies del hash que se acaba de firmar.
    if !estado.almacen.indice_sellado(indice_id).map_err(|e| e.to_string())? {
        return Err("solo se puede publicar un índice sellado".into());
    }
    let previa = publicar::previsualizar(&estado.almacen, indice_id).map_err(|e| e.to_string())?;
    if !previa.no_redistribuibles.is_empty() && !descargo {
        return Err("faltan por aceptar los términos de las fuentes no redistribuibles".into());
    }

    let claves = keys::Claves { almacen: &estado.almacen, maestra: &estado.maestra };
    let testigo = identidad::leer_testigo(&claves).map_err(|e| e.to_string())?;
    let secreta = identidad::leer_clave(&claves).map_err(|e| e.to_string())?;
    let autor = identidad::leer_sesion(&estado.almacen)
        .map_err(|e| e.to_string())?
        .map(|s| s.cuenta)
        .unwrap_or_default();

    let total = previa.trozos.len() as u32 + 2; // cuerpos, capas y la ficha
    let prog = Arc::new(publicar::Publicacion::nueva(total, previa.bytes_total));
    *estado.publicacion.lock().unwrap() = Some(prog.clone());

    // Lo que no indexó porque ya lo cubría otro se declara: no entra en el
    // índice, entra en la ficha. Se calcula aquí, con el catálogo delante, y
    // no dentro de `publicar`, que no conoce el almacén de fichas remotas.
    let dependencias =
        publicar::dependencias_de(&estado.almacen, indice_id).map_err(|e| e.to_string())?;

    let almacen = estado.almacen.clone();
    tauri::async_runtime::spawn(async move {
        let r = publicar::publicar(almacen, prog.clone(), indice_id, repo, testigo, autor, secreta, dependencias)
            .await;
        prog.terminar(r.map_err(|e| e.to_string()));
    });
    Ok(())
}

#[tauri::command]
async fn publicar_progreso(
    estado: tauri::State<'_, Estado>,
) -> Result<publicar::ProgresoPublicacion, String> {
    Ok(estado.publicacion.lock().unwrap().as_ref().map(|p| p.progreso()).unwrap_or_default())
}

/// Reanudar es lo mismo que publicar: lo ya subido está apuntado en
/// `publicaciones` y no se vuelve a subir.
#[tauri::command]
async fn publicar_continuar(
    estado: tauri::State<'_, Estado>,
    indice_id: i64,
) -> Result<Vec<String>, String> {
    Ok(estado
        .almacen
        .publicacion_pendientes(indice_id)
        .map_err(|e| e.to_string())?
        .into_iter()
        .map(|(a, _, _)| a)
        .collect())
}

/// Publicar una capa sobre un cuerpo que no se toca — incluso el de otra
/// persona, porque en ese caso la capa va a un repositorio propio.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
async fn publicar_capa_arrancar(
    estado: tauri::State<'_, Estado>,
    indice_id: i64,
    cuerpo_sha256: String,
    cuerpo_paquete: String,
    cuerpo_autor: String,
    cuerpo_url: String,
    modelo: String,
    repo: String,
) -> Result<(), String> {
    let claves = keys::Claves { almacen: &estado.almacen, maestra: &estado.maestra };
    let testigo = identidad::leer_testigo(&claves).map_err(|e| e.to_string())?;
    let secreta = identidad::leer_clave(&claves).map_err(|e| e.to_string())?;
    let autor = identidad::leer_sesion(&estado.almacen)
        .map_err(|e| e.to_string())?
        .map(|s| s.cuenta)
        .unwrap_or_default();

    // Dos pasos: la capa y la ficha. Ni un byte de imagen.
    let prog = Arc::new(publicar::Publicacion::nueva(2, 0));
    *estado.publicacion.lock().unwrap() = Some(prog.clone());
    let almacen = estado.almacen.clone();
    tauri::async_runtime::spawn(async move {
        let r = publicar::publicar_capa(
            almacen, prog.clone(), indice_id, cuerpo_sha256, cuerpo_paquete, cuerpo_autor,
            cuerpo_url, modelo, repo, testigo, autor, secreta,
        )
        .await;
        prog.terminar(r.map_err(|e| e.to_string()));
    });
    Ok(())
}

pub(crate) fn chrono_ahora() -> String {
    // ponytail: sin dependencia de `chrono` por una sola marca de tiempo; el
    // formato exacto no lo consume nada todavía (el 8 aún no existe), así que
    // basta con segundos desde época en un texto legible.
    let s = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    format!("{s}")
}

/// Arranca la importación en un hilo aparte y vuelve enseguida: un paquete
/// real descifra y parsea durante varios segundos, y bloquear el comando
/// hasta el final es exactamente lo que dejaba a la interfaz sin nada que
/// enseñar mientras tanto. El progreso se lee aparte, con `ingesta_legacy_progreso`.
#[tauri::command]
async fn ingesta_legacy_arrancar(
    estado: tauri::State<'_, Estado>,
    indice_id: i64,
    ruta: String,
    tipo: Option<String>,
    fuente: String,
    declarada: bool,
) -> Result<(), String> {
    exige_abierto(&estado, indice_id)?;
    let modelos_registro = estado.modelos.clone();
    let modelos: Vec<String> = modelos_registro.iter().map(|m| m.id.clone()).collect();
    let destino = estado.dir.join("imagenes").join(indice_id.to_string());
    let almacen = estado.almacen.clone();
    let ing = Arc::new(ingest::Ingesta::nueva());
    *estado.ingesta.lock().unwrap() = Some(ing.clone());

    let paquete = PathBuf::from(ruta);
    tauri::async_runtime::spawn(async move {
        let almacen2 = almacen.clone();
        let ing2 = ing.clone();
        let salida = tokio::task::spawn_blocking(move || {
            ingest::desde_legacy(
                &almacen2,
                indice_id,
                &paquete,
                tipo.as_deref(),
                &fuente,
                declarada,
                &modelos,
                &destino,
                &ing2,
            )
        })
        .await;

        let r = match salida {
            Ok(r) => r,
            Err(e) => Err(anyhow::anyhow!("la importación se cayó: {e}")),
        };

        // El vector viene dentro del paquete, pero está en memoria, no en
        // Qdrant: subirlo es lo que hace real la promesa de "no se gasta
        // GPU". `desde_legacy` es síncrona a propósito (decodifica imágenes,
        // calcula sha256) y Qdrant se habla por HTTP async, así que la subida
        // pasa aquí, después de que el hilo bloqueante ya terminó.
        let r = match r {
            Ok((resumen, vectores)) if !vectores.is_empty() => {
                match subir_vectores_legacy(&almacen, &modelos_registro, vectores).await {
                    Ok(()) => Ok(resumen),
                    Err(e) => Err(anyhow::anyhow!(
                        "{} imágenes traían vector pero no se pudieron subir a Qdrant: {e}",
                        resumen.con_vector
                    )),
                }
            }
            Ok((resumen, _)) => Ok(resumen),
            Err(e) => Err(e),
        };
        ing.terminar(r);
    });
    Ok(())
}

/// Sube a Qdrant los vectores que un paquete legacy traía dentro, agrupados
/// por modelo (la v1 solo trae uno, pero agrupar es gratis y no asume nada),
/// y solo entonces marca cada fila como `hecho`. Antes de esto,
/// `Almacen::marcar_vector` hacía un `UPDATE` a secas contra una fila que
/// `insertar_imagen` nunca creaba para estos vectores —los que SÍ vienen
/// dentro—, así que la marca no tocaba ninguna fila y el vector importado se
/// perdía en silencio: la fila se quedaba sin `vectores` en absoluto, ni
/// pendiente ni hecha.
async fn subir_vectores_legacy(
    almacen: &Almacen,
    modelos: &[models::Modelo],
    vectores: Vec<ingest::VectorTraido>,
) -> anyhow::Result<()> {
    let mut por_modelo: std::collections::BTreeMap<String, Vec<ingest::VectorTraido>> =
        std::collections::BTreeMap::new();
    for v in vectores {
        por_modelo.entry(v.modelo.clone()).or_default().push(v);
    }

    let cliente = qdrant::Cliente::nuevo();
    for (modelo_id, filas) in por_modelo {
        let Some(modelo) = modelos.iter().find(|m| m.id == modelo_id) else {
            anyhow::bail!("el modelo {modelo_id} ya no está registrado");
        };
        let coleccion = qdrant::coleccion_de(&modelo.id, &modelo.version);
        cliente.asegurar_coleccion(&coleccion, modelo.dims).await?;

        let ids: Vec<i64> = filas.iter().map(|f| f.imagen_id).collect();
        let vecs: Vec<Vec<f32>> = filas.iter().map(|f| f.vector.clone()).collect();
        let quadkeys: Vec<String> = filas.iter().map(|f| f.quadkey.clone()).collect();
        cliente.subir(&coleccion, &ids, &vecs, &quadkeys).await?;

        for id in &ids {
            almacen.marcar_vector(*id, &modelo_id, "hecho")?;
        }
    }
    Ok(())
}

#[tauri::command]
async fn ingesta_legacy_progreso(
    estado: tauri::State<'_, Estado>,
) -> Result<ingest::ProgresoIngesta, String> {
    Ok(estado.ingesta.lock().unwrap().as_ref().map(|i| i.progreso()).unwrap_or_default())
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
    // Un bucle por modelo registrado, no solo el primero: con lumi-2 y
    // lumi-preview activos a la vez, quedarse en `modelos.first()` significaba
    // que el segundo modelo nunca tenía quien le bajara los vectores — sus
    // filas se quedaban en `pendiente` para siempre, y el sellado se negaba
    // eternamente con "0 de N" sin que nada estuviera realmente roto.
    for m in &modelos {
        cola.clone().arrancar_bucle(m.id.clone(), m.dims, m.version.clone());
    }

    tauri::Builder::default()
        .plugin(
            tauri_plugin_log::Builder::default()
                // Mismo `Stdout` de siempre, más un fichero de nombre fijo en
                // vez del que el plugin elige solo — así el comando de debug
                // sabe exactamente qué leer. 8 MB porque una sola descarga
                // densa (el caso de Tokio) ya deja cientos de líneas TRACE de
                // reqwest; con el tope por defecto (40 KB) se rotaba solo con
                // arrancar la app.
                .targets([
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Stdout),
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::LogDir {
                        file_name: Some("indexer".into()),
                    }),
                ])
                .max_file_size(8_000_000)
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .manage(Estado {
            dir,
            almacen,
            maestra,
            servicios,
            modelos,
            cola,
            descarga: std::sync::Mutex::new(None),
            ingesta: std::sync::Mutex::new(None),
            sondeo: std::sync::Mutex::new(None),
            sellado: std::sync::Mutex::new(None),
            identidad_en_curso: std::sync::Mutex::new(None),
            publicacion: std::sync::Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![
            saludo,
            rendimiento_leer,
            servicios_arrancar,
            servicios_arrancar_wsl,
            servicios_parar,
            servicios_estado,
            servicios_log,
            servicios_diagnostico,
            debug_log_leer,
            setup_completo,
            setup_marcar_completo,
            setup_reiniciar,
            modelos_lista,
            runtime_listo,
            runtime_instalar,
            cola_progreso,
            cola_pausar,
            indice_progreso_embebido,
            ingesta_carpeta,
            ingesta_legacy_arrancar,
            ingesta_legacy_progreso,
            indice_crear,
            indices_lista,
            indice_detalle,
            indice_lotes,
            lote_cancelar,
            indice_borrar,
            indice_imagenes,
            territorio_clasificar,
            territorio_heredar,
            origenes_lista,
            sondear_area_arrancar,
            sondear_area_progreso,
            estimar_area,
            descarga_arrancar,
            descarga_progreso,
            descarga_parar,
            descarga_pendiente,
            descarga_pendiente_descartar,
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
            paquete_sellar_arrancar,
            paquete_sellar_progreso,
            paquete_que_viaja,
            paquete_abrir,
            identidad_arrancar,
            identidad_sondear,
            identidad_leer,
            identidad_cerrar,
            identidad_respaldo,
            identidad_respaldo_guardar,
            identidad_rotar,
            publicar_repos,
            publicar_previsualizar,
            publicar_arrancar,
            publicar_progreso,
            publicar_continuar,
            catalogo_refrescar,
            catalogo_buscar,
            catalogo_perfil,
            catalogo_perfil_github,
            catalogo_mios,
            catalogo_reclamos,
            catalogo_dependencias_rotas,
            catalogo_capas,
            publicar_capa_arrancar
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
