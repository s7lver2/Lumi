//! La cola de lotes y el trabajador que los resuelve.
//!
//! REDIS ES EL TIMBRE Y EL ESTADO CALIENTE; SQLITE ES LA VERDAD. En Redis van
//! la lista de lotes pendientes y el progreso que la interfaz pinta; el estado
//! por imagen está en SQLite. Si Redis se vacía se pierde la barra y nada más:
//! la cola se reconstruye leyendo qué imágenes siguen sin vector.
//!
//! Dos clases de fallo, y no se tratan igual:
//!   - «esta imagen no se puede embeber» es un RESULTADO. Se anota el motivo,
//!     se salta y se sigue. No se reintenta: reintentarla solo quema GPU.
//!   - que el PROCESO se muera es una AVERÍA. El índice vuelve a la cola una
//!     vez, con un contador que impide el bucle infinito.
//!
//! UN BUCLE POR MODELO, no uno para toda la aplicación: con varios modelos
//! activos a la vez (lumi-2, lumi-preview, ...) cada uno tiene su propio
//! ritmo y su propia GPU-tiempo, y "hecho" para uno no puede significar
//! "hecho" para otro. Por eso el trabajo se elige contra `vectores`
//! (`Almacen::indices_con_pendientes`), no contra una columna compartida en
//! `lotes` — esa columna solo sabía decir una cosa a la vez.

use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::{Arc, Mutex};

use anyhow::{bail, Result};
use lumi_index::embed::{Lote, MsgEmbed};
use serde::Serialize;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin};

use crate::qdrant::{coleccion_de, Cliente};
use crate::runtime::python_del_venv;
use crate::services::Log;
use crate::store::Almacen;
use crate::ubicacion;

/// Imágenes por lote enviado al trabajador. 32 es lo que cabía holgadamente en
/// una GPU de 8 GB con lumi-2 en las pruebas de la v1.
const POR_LOTE: u32 = 32;
/// Reintentos de un índice cuyo proceso murió, POR MODELO. Uno: si muere dos
/// veces, el problema no es de suerte.
const REINTENTOS_MAX: u32 = 1;

#[derive(Debug, Clone, Default, Serialize)]
pub struct Progreso {
    /// A qué modelo pertenece esta fila. Con un solo modelo esto sobraba;
    /// con varios, es lo único que le dice a la interfaz cuál es cuál.
    pub modelo_id: String,
    pub trabajando: bool,
    pub pausada: bool,
    pub indice_actual: Option<i64>,
    /// Del LOTE que el trabajador tiene entre manos ahora mismo (hasta 32).
    pub hechas: u32,
    pub total: u32,
    /// Del ÍNDICE entero para este modelo — lo que responde a "¿cuánto
    /// falta de verdad?", que un lote de 32 no puede contestar por sí solo.
    pub indice_hechas: u32,
    pub indice_total: u32,
    pub dispositivo: String,
    pub saltadas: u32,
    pub reinicios: u32,
    /// Veces que un lote YA EMBEBIDO no se pudo subir a Qdrant, por modelo.
    /// A diferencia de `reinicios` (el proceso del trabajador murió), aquí el
    /// trabajador sigue vivo y el lote se reintenta él solo cada 5s: sin este
    /// contador, ese reintento era invisible desde la interfaz y "atascado en
    /// 32" y "reintentando cada 5s con éxito eventual" se veían idénticos.
    pub guardado_fallos: u32,
    /// El motivo del último `MsgEmbed::Fallo` de este modelo — típicamente
    /// "no se pudo cargar el modelo": pesos o licencia que faltan en disco.
    /// Sin esto, un modelo que SIEMPRE falla (nunca "muere": el trabajador
    /// sigue vivo y contesta) se veía IDÉNTICO a uno que solo tarda: "lote
    /// 0/32" para siempre, sin ninguna pista de por qué.
    pub ultimo_fallo: Option<String>,
    /// `true` mientras este modelo espera a que Qdrant responda antes de
    /// arrancar de verdad (`asegurar_coleccion` reintentando cada 5s). Sin
    /// esto, este caso y "trabajando de verdad pero yendo lento" se veían
    /// idénticos en la interfaz: una fila en "en espera de su turno" para
    /// siempre, sin ninguna pista de que el problema es Qdrant, no la cola.
    pub esperando_qdrant: bool,
}

pub struct Cola {
    almacen: Arc<Almacen>,
    log: Arc<Log>,
    /// Una entrada por modelo con un bucle arrancado. `arrancar_bucle` la crea
    /// la primera vez que se llama para ese modelo.
    progreso: Mutex<HashMap<String, Progreso>>,
    pausada: Arc<Mutex<bool>>,
    /// Cuántos modelos pueden tener pesos cargados en GPU A LA VEZ. Antes cada
    /// modelo tenía su propio `Option<Trabajador>` que, una vez arrancado,
    /// nunca se soltaba: con varios modelos reales activos (cosplace, salad,
    /// cliquemining, anyloc...) eso significaba varios contextos CUDA y varios
    /// juegos de pesos residentes en la GPU A LA VEZ para siempre. En una GPU
    /// ya compartida con otras aplicaciones eso desborda la VRAM disponible, y
    /// Windows cae a "memoria de GPU compartida" (RAM del sistema de
    /// respaldo) — ahí todo el escritorio se congela, no solo el embebido.
    /// Se guarda en `ajustes` (clave `concurrencia_gpu`) para que sobreviva a
    /// un reinicio; se lee una vez al construir la cola y se puede cambiar en
    /// caliente desde Ajustes con `fijar_concurrencia`.
    concurrencia: std::sync::atomic::AtomicUsize,
    /// El modo de consumo "bajo" de Ajustes: baja la prioridad de proceso
    /// (Windows) del trabajador de embebido que se lance a partir de ahora —
    /// no retroactivo sobre uno ya en marcha, `creation_flags` solo aplica al
    /// arrancar. Va de la mano de bajar `concurrencia` a 1 (`cola_consumo_fijar`
    /// fija los dos juntos): prioridad baja con concurrencia 2 no cumple el
    /// objetivo de dejar el ordenador libre. Mismo patrón que `concurrencia`:
    /// se guarda en `ajustes` para sobrevivir a un reinicio.
    prioridad_baja: std::sync::atomic::AtomicBool,
    /// El conjunto de trabajadores con pesos cargados AHORA MISMO, como mucho
    /// `concurrencia` a la vez. Cada entrada es su propio `Mutex`: dos modelos
    /// con ranura propia corren su lote EN PARALELO de verdad, sin esperarse
    /// el uno al otro — solo se serializa la decisión de "qué modelo entra o
    /// sale del conjunto", no el trabajo en sí.
    trabajadores: tokio::sync::Mutex<Ranuras>,
}

#[derive(Default)]
struct Ranuras {
    ranuras: HashMap<String, Arc<tokio::sync::Mutex<Trabajador>>>,
    /// Orden de uso, del menos reciente (al principio) al más (al final):
    /// a quién desalojar cuando hace falta sitio para un modelo nuevo.
    orden: Vec<String>,
}

impl Ranuras {
    fn tocar(&mut self, modelo: &str) {
        self.orden.retain(|m| m != modelo);
        self.orden.push(modelo.to_string());
    }

    fn quitar(&mut self, modelo: &str) {
        self.ranuras.remove(modelo);
        self.orden.retain(|m| m != modelo);
    }
}

struct Trabajador {
    /// No se lee nunca, y aun así tiene que estar aquí: es lo que mantiene
    /// vivo el proceso hijo. Al soltar el `Trabajador`, `kill_on_drop` lo
    /// mata. Si se quitara el campo, el proceso moriría al salir de `arrancar`.
    #[allow(dead_code)]
    hijo: Child,
    entrada: ChildStdin,
    salida: tokio::sync::mpsc::Receiver<MsgEmbed>,
}

/// Arranca el trabajador y deja sus dos tuberías separadas: `stdout` es el
/// contrato, `stderr` es el log. `-u` es obligatorio: sin él Python no suelta
/// una línea hasta que el proceso muere, y «cargando pesos» y «colgado» se ven
/// exactamente igual.
///
/// `LUMI_FAKE_DIMS` es igual de obligatorio y antes no se pasaba: el
/// trabajador de referencia es un stub que devuelve vectores de mentira de 64
/// dimensiones POR DEFECTO, pero `asegurar_coleccion` crea la colección de
/// Qdrant con la dimensión REAL del modelo (8448, 12288...). Sin este env var
/// las dos partes del contrato nunca coincidían, y cada lote fallaba al subir
/// para siempre — no una avería puntual, una imposibilidad estructural.
async fn arrancar(
    dir: &std::path::Path,
    log: Arc<Log>,
    dispositivo: &str,
    dims: u32,
    prioridad_baja: bool,
) -> Result<Trabajador> {
    let py = python_del_venv(dir);
    let script = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../workers/lumi_embed.py");
    if !script.exists() {
        bail!("no encuentro el trabajador en {}", script.display());
    }
    // `LUMI_REGISTRO`/`LUMI_PESOS` son igual de obligatorios: sus valores por
    // defecto en `lumi_embed.py` ("registros/modelos", "pesos") son relativos
    // al directorio de trabajo del proceso, que no tiene por qué ser la raíz
    // del repo — con el Indexer arrancado desde cualquier otro sitio (el
    // caso normal fuera de desarrollo), el trabajador fallaba con "el sistema
    // no puede encontrar la ruta especificada" para CUALQUIER modelo, no solo
    // los nuevos. Ambos se fijan aquí, absolutos, sin depender de dónde se
    // lanzó el proceso.
    let registro = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../modelos");
    let pesos = dir.join("pesos");
    let mut hijo = crate::proceso::cmd_async(&py, prioridad_baja)
        .arg("-u")
        .arg(&script)
        .env("LUMI_DEVICE", dispositivo)
        .env("LUMI_FAKE_DIMS", dims.to_string())
        .env("LUMI_REGISTRO", &registro)
        .env("LUMI_PESOS", &pesos)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()?;

    let entrada = hijo.stdin.take().expect("stdin pedido");
    let stdout = hijo.stdout.take().expect("stdout pedido");
    let stderr = hijo.stderr.take().expect("stderr pedido");

    let (tx, rx) = tokio::sync::mpsc::channel(64);
    tokio::spawn(async move {
        let mut lineas = BufReader::new(stdout).lines();
        while let Ok(Some(l)) = lineas.next_line().await {
            match serde_json::from_str::<MsgEmbed>(&l) {
                // Una línea ilegible se registra y se sigue: un `print` de
                // depuración perdido en el motor no puede tumbar la cola.
                Err(e) => log::warn!("línea ilegible del trabajador ({e}): {}", &l[..l.len().min(160)]),
                Ok(m) => {
                    if let Err(e) = m.validar() {
                        log::warn!("mensaje descartado, {e}");
                        continue;
                    }
                    if tx.send(m).await.is_err() {
                        break;
                    }
                }
            }
        }
    });
    tokio::spawn(async move {
        let mut l = BufReader::new(stderr).lines();
        while let Ok(Some(x)) = l.next_line().await {
            log.apuntar(format!("trabajador: {x}"));
        }
    });

    Ok(Trabajador { hijo, entrada, salida: rx })
}

/// Clave bajo la que vive en `ajustes`. En claro (no `_sellado`): no es un
/// secreto, es una preferencia de rendimiento.
const CLAVE_CONCURRENCIA: &str = "concurrencia_gpu";
/// Con una sola GPU en la mayoría de equipos, más de dos modelos con pesos
/// cargados a la vez deja de ser "acelerar" y vuelve a ser "desbordar la
/// VRAM" — el mismo problema que este mecanismo entero existe para evitar.
const CONCURRENCIA_MAX: usize = 2;
/// Clave bajo la que vive el modo de consumo en `ajustes`. Mismo patrón que
/// `CLAVE_CONCURRENCIA`.
const CLAVE_PRIORIDAD_BAJA: &str = "prioridad_baja_embebido";

impl Cola {
    pub fn nueva(almacen: Arc<Almacen>, log: Arc<Log>) -> Arc<Self> {
        let concurrencia = almacen
            .leer_ajuste(CLAVE_CONCURRENCIA)
            .ok()
            .flatten()
            .and_then(|v| v.parse::<usize>().ok())
            .map(|n| n.clamp(1, CONCURRENCIA_MAX))
            .unwrap_or(1);
        let prioridad_baja = almacen
            .leer_ajuste(CLAVE_PRIORIDAD_BAJA)
            .ok()
            .flatten()
            .map(|v| v == "true")
            .unwrap_or(false);
        Arc::new(Self {
            almacen,
            log,
            progreso: Mutex::new(HashMap::new()),
            // Empieza en pausa: el embebido usa GPU y puede tardar minutos u
            // horas, así que arranca cuando el operador lo pide, no solo
            // porque la app se abrió. `cola_pausar(false)` es el arranque.
            pausada: Arc::new(Mutex::new(true)),
            concurrencia: std::sync::atomic::AtomicUsize::new(concurrencia),
            prioridad_baja: std::sync::atomic::AtomicBool::new(prioridad_baja),
            trabajadores: tokio::sync::Mutex::new(Ranuras::default()),
        })
    }

    /// Cuántos modelos pueden tener pesos cargados en GPU a la vez, ahora
    /// mismo. Para pintar el selector de Ajustes con el valor real.
    pub fn concurrencia(&self) -> usize {
        self.concurrencia.load(std::sync::atomic::Ordering::Relaxed)
    }

    /// Cambia el límite en caliente: no hace falta reiniciar la app para que
    /// se note. Si se BAJA con más modelos activos que el nuevo límite, no se
    /// desaloja nadie de golpe — el próximo modelo que necesite ranura y no
    /// quepa ya la pedirá desalojando al menos usado, como siempre.
    pub fn fijar_concurrencia(&self, n: usize) {
        let n = n.clamp(1, CONCURRENCIA_MAX);
        self.concurrencia.store(n, std::sync::atomic::Ordering::Relaxed);
        let _ = self.almacen.guardar_ajuste(CLAVE_CONCURRENCIA, &n.to_string());
    }

    /// El modo de consumo ahora mismo: `true` es "bajo". Para pintar el
    /// selector de Ajustes con el valor real.
    pub fn prioridad_baja(&self) -> bool {
        self.prioridad_baja.load(std::sync::atomic::Ordering::Relaxed)
    }

    /// Cambia el modo en caliente. El trabajador YA arrancado no cambia de
    /// prioridad retroactivamente — se aplica al siguiente que arranque, no
    /// hace falta matar uno en marcha para esta primera pasada.
    pub fn fijar_prioridad_baja(&self, bajo: bool) {
        self.prioridad_baja.store(bajo, std::sync::atomic::Ordering::Relaxed);
        let _ = self.almacen.guardar_ajuste(CLAVE_PRIORIDAD_BAJA, if bajo { "true" } else { "false" });
    }

    /// Consigue la ranura de `modelo`: la existente si ya la tiene, o una
    /// nueva desalojando la menos usada si hace falta sitio. El `Mutex` que
    /// envuelve cada `Trabajador` es SUYO, no el del conjunto: dos modelos con
    /// ranura propia procesan su lote en paralelo de verdad, sin esperarse.
    async fn ranura_para(&self, modelo: &str, dims: u32) -> Result<Arc<tokio::sync::Mutex<Trabajador>>> {
        let mut pool = self.trabajadores.lock().await;
        if let Some(r) = pool.ranuras.get(modelo) {
            let r = r.clone();
            pool.tocar(modelo);
            return Ok(r);
        }
        let cap = self.concurrencia();
        while pool.ranuras.len() >= cap {
            let Some(victima) = pool.orden.first().cloned() else { break };
            pool.quitar(&victima);
            self.log.apuntar(format!("cola: se aparta {victima} de la GPU para dejar sitio a {modelo}"));
            // El Trabajador se suelta aquí; si nadie más lo tiene entre manos
            // en este instante, `kill_on_drop` mata su proceso ahora mismo. Si
            // otra tarea aún lo está usando, el Arc sigue vivo hasta que esa
            // tarea termine su lote y lo suelte -- no se corta a mitad.
        }
        // Se lee del puntero de disco en cada arranque de trabajador, no de un
        // campo capturado por valor al construir la cola: la cola vive toda
        // la sesión y su bucle sigue corriendo durante una migración de
        // carpeta (#91), así que un `dir` fijo la dejaba escribiendo contra
        // la carpeta vieja para siempre mientras el resto de la app (el
        // `Almacen` compartido, que sí se re-abre en caliente) ya servía
        // desde la nueva — de ahí el "0 de N" sistemático al sellar.
        let dir = ubicacion::leer_ubicacion();
        let t = arrancar(&dir, self.log.clone(), "cuda:0", dims, self.prioridad_baja()).await?;
        let r = Arc::new(tokio::sync::Mutex::new(t));
        pool.ranuras.insert(modelo.to_string(), r.clone());
        pool.tocar(modelo);
        Ok(r)
    }

    /// Una fila por modelo con un bucle arrancado, en el orden del registro.
    pub fn progreso(&self) -> Vec<Progreso> {
        let mapa = self.progreso.lock().unwrap();
        let mut fuera: Vec<Progreso> = mapa.values().cloned().collect();
        fuera.sort_by(|a, b| a.modelo_id.cmp(&b.modelo_id));
        fuera
    }

    /// Pausar termina el lote en curso y no coge el siguiente. Nunca mata
    /// trabajo que ya está corriendo: es la misma regla del subsistema 4.
    /// Es UN SOLO interruptor para todos los modelos: pausar la GPU es pausar
    /// la GPU, no "pausar lumi-2 pero seguir con lumi-preview".
    pub fn pausar(&self, si: bool) {
        *self.pausada.lock().unwrap() = si;
        for p in self.progreso.lock().unwrap().values_mut() {
            p.pausada = si;
        }
    }

    /// Bucle principal de UN modelo. Se lanza una vez por modelo registrado,
    /// al arrancar la app.
    ///
    /// `tauri::async_runtime::spawn` y no `tokio::spawn`: esto se llama antes
    /// de construir la aplicación, donde todavía no hay ningún runtime en
    /// contexto y `tokio::spawn` entra en pánico. El runtime de Tauri es un
    /// tokio multihilo global que se crea al pedirlo, así que desde dentro de
    /// la tarea `tokio::spawn`, `tokio::process` y los temporizadores ya
    /// funcionan con normalidad.
    pub fn arrancar_bucle(self: Arc<Self>, modelo: String, dims: u32, version: String) {
        tauri::async_runtime::spawn(async move {
            {
                let pausada = *self.pausada.lock().unwrap();
                self.progreso.lock().unwrap().entry(modelo.clone()).or_insert_with(|| Progreso {
                    modelo_id: modelo.clone(),
                    pausada,
                    ..Default::default()
                });
            }

            let qdrant = Cliente::nuevo();
            let coleccion = coleccion_de(&modelo, &version);
            // Reintenta en vez de rendirse: Qdrant puede no estar arrancado
            // TODAVÍA cuando esto se ejecuta —en Windows, ni siquiera está
            // instalado hasta que el operador aprieta "Levantar en WSL" desde
            // Ajustes, ya con la app abierta—. Rendirse aquí una sola vez
            // dejaba el modelo entero muerto el resto de la sesión aunque
            // Qdrant arrancara treinta segundos después.
            loop {
                match qdrant.asegurar_coleccion(&coleccion, dims).await {
                    Ok(()) => {
                        if let Some(p) = self.progreso.lock().unwrap().get_mut(&modelo) {
                            p.esperando_qdrant = false;
                        }
                        break;
                    }
                    Err(e) => {
                        if let Some(p) = self.progreso.lock().unwrap().get_mut(&modelo) {
                            p.esperando_qdrant = true;
                        }
                        self.log.apuntar(format!(
                            "cola ({modelo}): no se pudo preparar Qdrant, reintentando en 5s: {e}"
                        ));
                        tokio::time::sleep(std::time::Duration::from_secs(5)).await;
                    }
                }
            }
            // En memoria, no en SQLite: un índice que revienta el trabajador
            // (o falla siempre) se aparta un rato para ESTE modelo, no para
            // siempre. Descartarlo sin fecha de caducidad era peor que el
            // bucle que evitaba: arreglar la causa real (bajar los pesos que
            // faltaban, por ejemplo) no servía de nada hasta reiniciar la
            // app entera, porque nada volvía a intentarlo jamás dentro de la
            // misma sesión.
            let mut reintentos: HashMap<i64, u32> = HashMap::new();
            let mut descartados: HashMap<i64, std::time::Instant> = HashMap::new();
            const ENFRIAMIENTO: std::time::Duration = std::time::Duration::from_secs(60);

            loop {
                if *self.pausada.lock().unwrap() {
                    tokio::time::sleep(std::time::Duration::from_millis(600)).await;
                    continue;
                }
                // La verdad está en SQLite: se pregunta a ella, no a Redis.
                let Ok(indices) = self.almacen.indices_con_pendientes(&modelo) else {
                    tokio::time::sleep(std::time::Duration::from_secs(2)).await;
                    continue;
                };
                let Some(indice_id) = indices
                    .into_iter()
                    .find(|i| descartados.get(i).map_or(true, |t| t.elapsed() >= ENFRIAMIENTO))
                else {
                    if let Some(p) = self.progreso.lock().unwrap().get_mut(&modelo) {
                        p.trabajando = false;
                    }
                    tokio::time::sleep(std::time::Duration::from_secs(2)).await;
                    continue;
                };

                // La ranura es del modelo, no de la cola entera: hasta
                // `concurrencia` modelos distintos pueden tener la suya y
                // avanzar en paralelo de verdad, sin esperarse unos a otros.
                let ranura = match self.ranura_para(&modelo, dims).await {
                    Ok(r) => r,
                    Err(e) => {
                        self.log.apuntar(format!("cola ({modelo}): no arrancó el trabajador: {e}"));
                        tokio::time::sleep(std::time::Duration::from_secs(5)).await;
                        continue;
                    }
                };
                let mut trabajador_guard = ranura.lock().await;
                let (vivo, fallo) = self
                    .resolver_indice(&mut trabajador_guard, indice_id, &modelo, &coleccion, &qdrant)
                    .await;
                drop(trabajador_guard);
                if !vivo {
                    // El proceso murió: AVERÍA. El índice vuelve a la cola una
                    // vez; el contador impide el bucle infinito. Se quita
                    // también de las ranuras: reintentar contra un `Mutex` que
                    // envuelve un proceso ya muerto no sirve de nada.
                    self.trabajadores.lock().await.quitar(&modelo);
                    if let Some(p) = self.progreso.lock().unwrap().get_mut(&modelo) {
                        p.reinicios += 1;
                    }
                    let n = reintentos.entry(indice_id).or_insert(0);
                    *n += 1;
                    if *n > REINTENTOS_MAX {
                        self.log.apuntar(format!(
                            "cola ({modelo}): el índice {indice_id} murió más veces de las permitidas, se aparta {}s",
                            ENFRIAMIENTO.as_secs()
                        ));
                        descartados.insert(indice_id, std::time::Instant::now());
                        reintentos.remove(&indice_id);
                    }
                } else if fallo {
                    // El trabajador sigue vivo, pero el lote entero falló (el
                    // caso típico: el modelo no cargó — pesos o licencia que
                    // faltan). Sin esta espera y este mismo contador de
                    // `reintentos`, el lote se repetía IDÉNTICO en el
                    // siguiente tick sin ningún límite: giraba a toda
                    // velocidad gastando CPU, no GPU, y "0/32 para siempre"
                    // era indistinguible de estar cargando algo de verdad.
                    tokio::time::sleep(std::time::Duration::from_secs(5)).await;
                    let n = reintentos.entry(indice_id).or_insert(0);
                    *n += 1;
                    if *n > REINTENTOS_MAX {
                        self.log.apuntar(format!(
                            "cola ({modelo}): el índice {indice_id} falla siempre con este modelo, se aparta {}s",
                            ENFRIAMIENTO.as_secs()
                        ));
                        descartados.insert(indice_id, std::time::Instant::now());
                        reintentos.remove(&indice_id);
                    }
                } else {
                    reintentos.remove(&indice_id);
                }
            }
        });
    }

    /// `(vivo, fallo)`: `vivo` es `false` si el trabajador se murió a mitad.
    /// `fallo` es `true` si el trabajador siguió vivo pero el lote entero no
    /// se pudo procesar (típicamente el modelo no cargó) — sin distinguir
    /// esto de un éxito, la misma imagen se reintentaba instantáneamente para
    /// siempre: nada moría, así que nada disparaba el descarte por
    /// reintentos, y la cola giraba en un bucle apretado gastando CPU sin
    /// que se notara desde fuera más que "0/32 no avanza nunca".
    async fn resolver_indice(
        &self,
        t: &mut Trabajador,
        indice_id: i64,
        modelo: &str,
        coleccion: &str,
        qdrant: &Cliente,
    ) -> (bool, bool) {
        let Ok(pendientes) = self.almacen.pendientes_de(indice_id, modelo, POR_LOTE) else {
            return (true, false);
        };
        if pendientes.is_empty() {
            // Otro tick ya se lo llevó, o el operador lo canceló justo ahora.
            return (true, false);
        }
        // De antes de este lote: el lote en sí ya lo cambia, así que esto es
        // "lo que llevaba el índice hasta ahora", no "lo que lleva después".
        // Barato de sobra frente a lo que tarda de verdad un lote de 32.
        let (indice_hechas, indice_total) =
            self.almacen.progreso_indice(indice_id, modelo).unwrap_or((0, 0));
        {
            let mut mapa = self.progreso.lock().unwrap();
            let p = mapa.entry(modelo.to_string()).or_default();
            p.modelo_id = modelo.to_string();
            p.trabajando = true;
            p.indice_actual = Some(indice_id);
            p.hechas = 0;
            p.total = pendientes.len() as u32;
            p.indice_hechas = indice_hechas;
            p.indice_total = indice_total;
        }

        let por_ruta: std::collections::HashMap<String, i64> =
            pendientes.iter().map(|(id, r)| (r.clone(), *id)).collect();
        let orden =
            Lote::nuevo(indice_id, modelo.to_string(), pendientes.iter().map(|(_, r)| r.clone()).collect());
        let linea = format!("{}\n", serde_json::to_string(&orden).unwrap());
        if t.entrada.write_all(linea.as_bytes()).await.is_err() {
            return (false, false);
        }
        let _ = t.entrada.flush().await;

        loop {
            let Some(msg) = t.salida.recv().await else { return (false, false) };
            match msg {
                MsgEmbed::Listo { dispositivo, .. } => {
                    if let Some(p) = self.progreso.lock().unwrap().get_mut(modelo) {
                        p.dispositivo = dispositivo;
                    }
                }
                MsgEmbed::Progreso { hechas, .. } => {
                    if let Some(p) = self.progreso.lock().unwrap().get_mut(modelo) {
                        p.hechas = hechas;
                        // Vivo también a nivel de índice: sin esto, un lote
                        // largo con un modelo de verdad se vería congelado en
                        // el total del índice hasta que el lote entero termine.
                        p.indice_hechas = indice_hechas + hechas;
                    }
                }
                MsgEmbed::Saltada { ruta, motivo, .. } => {
                    // RESULTADO, no avería: se anota y no vuelve a la cola.
                    if let Some(id) = por_ruta.get(&ruta) {
                        let _ = self.almacen.marcar_saltada(*id, &motivo);
                    }
                    if let Some(p) = self.progreso.lock().unwrap().get_mut(modelo) {
                        p.saltadas += 1;
                    }
                }
                MsgEmbed::Fallo { motivo, .. } => {
                    self.log.apuntar(format!("cola ({modelo}): índice {indice_id}, {motivo}"));
                    if let Some(p) = self.progreso.lock().unwrap().get_mut(modelo) {
                        p.ultimo_fallo = Some(motivo);
                    }
                    return (true, true);
                }
                MsgEmbed::Vectores { dims, cuenta, fichero, imagenes, .. } => {
                    let ok = self.guardar(qdrant, coleccion, &fichero, dims, cuenta, &imagenes, &por_ruta, modelo).await;
                    // El temporal es del trabajador y ya no hace falta; si se
                    // quedara, una indexación larga llenaría /tmp sola.
                    let _ = std::fs::remove_file(&fichero);
                    if let Err(e) = ok {
                        // Ninguna fila se marcó «hecho»: el lote entero sigue
                        // pendiente y el próximo tick lo vuelve a coger IDÉNTICO.
                        // Sin esta espera, un Qdrant que tarda en estabilizarse
                        // (justo después de «Levantar en WSL», por ejemplo) hacía
                        // que la GPU reembebiera el mismo lote sin parar, y la
                        // barra enseñaba un avance optimista que se deshacía en
                        // cada vuelta — parecía "atascado en 32" porque de verdad
                        // lo estaba, solo que gastando GPU en bucle mientras tanto.
                        self.log.apuntar(format!(
                            "cola ({modelo}): no se pudieron guardar los vectores, reintentando en 5s: {e}"
                        ));
                        if let Some(p) = self.progreso.lock().unwrap().get_mut(modelo) {
                            p.guardado_fallos += 1;
                        }
                        tokio::time::sleep(std::time::Duration::from_secs(5)).await;
                    } else if let Some(p) = self.progreso.lock().unwrap().get_mut(modelo) {
                        // Un lote de verdad guardado: lo que fallara antes de
                        // este modelo ya no describe su estado actual.
                        p.ultimo_fallo = None;
                    }
                    return (true, false);
                }
            }
        }
    }

    #[allow(clippy::too_many_arguments)]
    async fn guardar(
        &self,
        qdrant: &Cliente,
        coleccion: &str,
        fichero: &str,
        dims: u32,
        cuenta: u32,
        imagenes: &[String],
        por_ruta: &std::collections::HashMap<String, i64>,
        modelo: &str,
    ) -> Result<()> {
        let bytes = std::fs::read(fichero)?;
        let esperado = cuenta as usize * dims as usize * 4;
        if bytes.len() != esperado {
            bail!("el fichero de vectores mide {} y debería medir {esperado}", bytes.len());
        }
        let mut vectores = Vec::with_capacity(cuenta as usize);
        for i in 0..cuenta as usize {
            let base = i * dims as usize * 4;
            vectores.push(
                (0..dims as usize)
                    .map(|j| {
                        let o = base + j * 4;
                        f32::from_le_bytes(bytes[o..o + 4].try_into().unwrap())
                    })
                    .collect::<Vec<f32>>(),
            );
        }
        let ids: Vec<i64> = imagenes.iter().filter_map(|r| por_ruta.get(r).copied()).collect();
        if ids.len() != vectores.len() {
            bail!("el trabajador devolvió rutas que no había pedido");
        }
        let quadkeys: Vec<String> =
            ids.iter().map(|id| self.almacen.quadkey_de_imagen(*id).unwrap_or_default()).collect();
        qdrant.subir(coleccion, &ids, &vectores, &quadkeys).await?;
        for id in &ids {
            self.almacen.marcar_vector(*id, modelo, "hecho")?;
        }
        Ok(())
    }
}
