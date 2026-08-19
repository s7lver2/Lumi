//! La cola: quién espera, quién corre y quién puede ejecutarlo.
//!
//! Aquí no vive ni la política (está en `plan`, que es una función pura) ni el
//! protocolo (está en `lumi_proto::worker`). Esto es el pegamento: lee el
//! estado, se lo da al planificador, manda lo que diga y apunta lo que vuelve.

pub mod plan;
pub mod worker;

use crate::limits;
use crate::store::Store;
use lumi_proto::api::{Cambio, GpuInfo, QueueView, WorkerView};
use lumi_proto::worker::Job;
use plan::{Candidato, Dueno, Libre};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Instant;
use tokio::sync::{broadcast, mpsc, oneshot};
use worker::Evento;

/// Cada cuánto se reparte aunque no haya pasado nada. Es una red de seguridad,
/// no el mecanismo: lo normal es que un aviso lo dispare al instante.
const TICK_S: u64 = 2;

/// Cuántas veces vuelve un trabajo a la cola tras morírsele el trabajador.
const MAX_REQUEUES: i64 = 1;

/// Plazo por defecto para que un trabajador diga `listo`. Va en `meta`
/// (`queue_listo_s`) y no compilado: un modelo grande en un disco lento puede
/// tardar más, y eso no debería obligar a recompilar el daemon.
const LISTO_S: u64 = 120;

/// Espera antes de relanzar un trabajador muerto, y su tope. Sin espera, un
/// dispositivo que no puede arrancar —CUDA rota, script borrado— se relanzaría
/// en bucle cerrado y llenaría el disco de log.
const RELANZAR_MIN_S: u64 = 2;
const RELANZAR_MAX_S: u64 = 60;

/// Busca un intérprete de Python en el `PATH` en vez de fijar uno a ciegas.
/// Ubuntu suele traer solo `python3`, pero no todos los entornos — sin esta
/// búsqueda, un sistema donde el binario se llama distinto deja al daemon sin
/// lanzar un solo trabajador, para siempre, sin ni un error que lo delate más
/// allá del log.
fn find_python() -> PathBuf {
    for candidato in ["python3", "python"] {
        let responde = std::process::Command::new(candidato)
            .arg("--version")
            .output()
            .is_ok_and(|o| o.status.success());
        if responde {
            return PathBuf::from(candidato);
        }
    }
    // Ninguno contestó: se deja "python3" para que el error de `spawn` diga
    // qué binario faltaba, en vez de fallar aquí en silencio.
    PathBuf::from("python3")
}

/// Dónde está `lumi_geo.py` — `crate::assets::ruta` ya recorre los mismos
/// candidatos (directorio de datos, checkout de compilación, directorio de
/// trabajo); esto solo lo deja en el log, porque cuando ninguno existe de
/// verdad el único rastro sin esto es una ruta relativa que no dice ni dónde
/// se buscó ni por qué falló.
fn find_script(_dir: &std::path::Path) -> PathBuf {
    let ruta = crate::assets::ruta("workers/lumi_geo.py");
    tracing::info!("cola: lumi_geo.py resuelto a {} (¿existe? {})", ruta.display(), ruta.exists());
    ruta
}

/// El vector que escribió el trabajador: `dims` floats de 32 bits en little
/// endian, sin cabecera — el mismo formato crudo que ya usaba el Indexer para
/// esto. `None` si el fichero no está donde dijo, o mide lo que no toca.
fn leer_f32(ruta: &str, dims: u32) -> Option<Vec<f32>> {
    let bytes = std::fs::read(ruta).ok()?;
    let esperado = dims as usize * 4;
    if bytes.len() != esperado {
        tracing::warn!("{ruta}: {} bytes, se esperaban {esperado} ({dims} floats)", bytes.len());
        return None;
    }
    Some(bytes.chunks_exact(4).map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]])).collect())
}

fn ahora() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// Un trabajador vivo, desde el punto de vista de la cola.
struct Vivo {
    modelo: Option<String>,
    trabajo: Option<i64>,
    listo: bool,
    /// Cuándo se lanzó. Solo se mira mientras `listo` es falso, para saber si
    /// se le ha pasado el plazo de arranque.
    desde: Instant,
    tx: mpsc::UnboundedSender<Job>,
    matar: Option<oneshot::Sender<()>>,
}

/// Vectores recibidos por análisis, a la espera de que lleguen los N del
/// nivel: modelo y vector de cada uno.
type VectoresPorAnalisis = HashMap<i64, Vec<(String, Vec<f32>)>>;

struct Estado {
    trabajadores: HashMap<String, Vivo>,
    /// Cuándo se puede volver a intentar cada dispositivo ausente, y cuántas
    /// veces seguidas ha fallado. Vive fuera de `trabajadores` porque tiene que
    /// sobrevivir precisamente a que el trabajador no exista.
    reintento: HashMap<String, (Instant, u32)>,
    /// Cuántos flujos SSE tiene abiertos cada usuario. Es la presencia, y vive
    /// en memoria a propósito: tras un reinicio nadie está conectado hasta que
    /// vuelve a llamar, que es exactamente lo correcto.
    presentes: HashMap<i64, usize>,
}

pub struct Queue {
    store: Arc<Store>,
    estado: Mutex<Estado>,
    avisos: mpsc::UnboundedSender<()>,
    difusion: broadcast::Sender<Cambio>,
    /// Con qué relanzar. Se calcula una vez al arrancar porque no cambia
    /// mientras el daemon vive, y el vigilante lo necesita a cada rato.
    dispositivos: Vec<String>,
    python: PathBuf,
    script: PathBuf,
    dir: PathBuf,
    eventos: mpsc::UnboundedSender<Evento>,
    pub(crate) niveles: Mutex<Vec<lumi_index::niveles::Nivel>>,
    agentes: Mutex<Vec<lumi_index::agentes::Agente>>,
    geo: Mutex<lumi_index::geo::Datos>,
    // `pub(crate)`: sus lectores son las rutas de gestión de modelos, en
    // `crate::routes::models`, no este módulo.
    pub(crate) modelos: Mutex<Vec<lumi_index::registro::Modelo>>,
    pub(crate) verificadores: Mutex<Vec<lumi_index::registro::Verificador>>,
    pub(crate) motores: Mutex<Vec<lumi_index::registro::Motor>>,
    pub(crate) recursos_geo: Mutex<Vec<lumi_index::geo::RecursoGeo>>,
    /// No se persiste: si el daemon se cae, el análisis se rehace.
    vectores: Mutex<VectoresPorAnalisis>,
}

/// Mientras esto viva, su dueño cuenta como conectado. Se suelta cuando el
/// flujo SSE se cierra, sea porque cerró la app o porque se cayó la red — no
/// hay ventana de tiempo que ajustar ni escritura por petición que hacer.
pub struct Presencia {
    uid: i64,
    cola: Arc<Queue>,
}

impl Drop for Presencia {
    fn drop(&mut self) {
        if let Ok(mut e) = self.cola.estado.lock() {
            if let Some(n) = e.presentes.get_mut(&self.uid) {
                *n = n.saturating_sub(1);
                if *n == 0 {
                    e.presentes.remove(&self.uid);
                }
            }
        }
        // Que alguien se vaya puede liberar sitio para el trabajo de otro.
        self.cola.avisar();
    }
}

impl Queue {
    pub fn arrancar(store: Arc<Store>, dir: PathBuf, gpus: &[GpuInfo]) -> Arc<Self> {
        let rearmados = store.rearmar_trabajos_huerfanos();
        if rearmados > 0 {
            tracing::info!("{rearmados} trabajos quedaron a medias en la caída anterior; vuelven a la cola");
        }

        let (tx_avisos, rx_avisos) = mpsc::unbounded_channel();
        let (difusion, _) = broadcast::channel(256);
        let (tx_ev, rx_ev) = mpsc::unbounded_channel();

        let python = store
            .get_meta("models_dir")
            .map(|m| PathBuf::from(m).join("venv/bin/python3"))
            .filter(|p| p.exists())
            // Sin runtime instalado cae al intérprete del sistema: el trabajador
            // de referencia no necesita nada más, y así el entorno de desarrollo
            // funciona sin haber pasado por el asistente.
            .unwrap_or_else(find_python);
        let script = find_script(&dir);
        tracing::info!("cola: intérprete {}, script {}", python.display(), script.display());

        let mut dispositivos: Vec<String> =
            gpus.iter().map(|g| format!("cuda:{}", g.index)).collect();
        // Con GPU disponible, un trabajo que cae en CPU tarda tanto que parece
        // roto. Sin ninguna, el de CPU es lo único que hay — y por eso el
        // entorno de pruebas en WSL funciona sin hardware.
        let cpu_por_defecto = if dispositivos.is_empty() { "1" } else { "0" };
        if store.get_meta("queue_cpu_worker").as_deref().unwrap_or(cpu_por_defecto) == "1" {
            dispositivos.push("cpu".into());
        }

        let cola = Arc::new(Self {
            store,
            estado: Mutex::new(Estado {
                trabajadores: HashMap::new(),
                reintento: HashMap::new(),
                presentes: HashMap::new(),
            }),
            avisos: tx_avisos,
            difusion,
            dispositivos,
            python,
            script,
            dir,
            eventos: tx_ev,
            niveles: Mutex::new(lumi_index::registro::cargar_niveles(&crate::assets::ruta("registros/niveles"))),
            agentes: Mutex::new(lumi_index::registro::cargar_agentes(&crate::assets::ruta("registros/agentes"))),
            geo: Mutex::new(lumi_index::geo::Datos::cargar(&crate::assets::ruta("registros/geo"))),
            modelos: Mutex::new(lumi_index::registro::cargar_modelos(&crate::assets::ruta("registros/modelos"))),
            verificadores: Mutex::new(lumi_index::registro::cargar_verificadores(&crate::assets::ruta("registros/verificadores"))),
            motores: Mutex::new(lumi_index::registro::cargar_motores(&crate::assets::ruta("registros/motores"))),
            recursos_geo: Mutex::new(lumi_index::geo::cargar_recursos(&crate::assets::ruta("registros/geo"))),
            vectores: Mutex::new(HashMap::new()),
        });

        // No se lanzan aquí: el vigilante del bucle ve que faltan todos y los
        // levanta en su primera pasada. Un solo camino para arrancar un
        // trabajador, y por tanto un solo sitio donde equivocarse.
        tokio::spawn(cola.clone().bucle(rx_avisos, rx_ev));
        cola
    }

    /// Sustituye los seis registros ENTEROS, no los parchea: un análisis en
    /// curso sigue viendo los que tenía cuando empezó, porque su `Arc` a los
    /// datos viejos (si los hubiera capturado) no se toca por esto. Se llama
    /// al terminar una tarea de descarga — nunca automáticamente en un
    /// temporizador, porque "recién descargado" es el único momento en que
    /// releer tiene sentido.
    pub fn recargar(&self) {
        *self.niveles.lock().unwrap() =
            lumi_index::registro::cargar_niveles(&crate::assets::ruta("registros/niveles"));
        *self.agentes.lock().unwrap() =
            lumi_index::registro::cargar_agentes(&crate::assets::ruta("registros/agentes"));
        *self.geo.lock().unwrap() = lumi_index::geo::Datos::cargar(&crate::assets::ruta("registros/geo"));
        *self.modelos.lock().unwrap() =
            lumi_index::registro::cargar_modelos(&crate::assets::ruta("registros/modelos"));
        *self.verificadores.lock().unwrap() =
            lumi_index::registro::cargar_verificadores(&crate::assets::ruta("registros/verificadores"));
        *self.motores.lock().unwrap() =
            lumi_index::registro::cargar_motores(&crate::assets::ruta("registros/motores"));
        *self.recursos_geo.lock().unwrap() =
            lumi_index::geo::cargar_recursos(&crate::assets::ruta("registros/geo"));
        tracing::info!("registros de modelos recargados en caliente");
    }

    /// «Ha cambiado algo, mira a ver si puedes repartir». No bloquea nunca.
    pub fn avisar(&self) {
        let _ = self.avisos.send(());
    }

    pub fn suscribir(&self) -> broadcast::Receiver<Cambio> {
        self.difusion.subscribe()
    }

    /// El único punto de entrada para que rutas fuera de este módulo (como
    /// `projects::add_member`) empujen algo por el mismo canal que ya usa la
    /// cola — sin duplicar un canal de difusión propio por cada cosa nueva
    /// que alguien necesite avisar en tiempo real a una sesión conectada.
    pub fn difundir(&self, cambio: Cambio) {
        let _ = self.difusion.send(cambio);
    }

    pub fn entra(self: &Arc<Self>, uid: i64) -> Presencia {
        if let Ok(mut e) = self.estado.lock() {
            *e.presentes.entry(uid).or_insert(0) += 1;
        }
        // Llegar puede desbloquear trabajo propio que estaba pausado.
        self.avisar();
        Presencia { uid, cola: self.clone() }
    }

    /// Cuántos usuarios distintos tienen al menos un flujo SSE abierto.
    /// `presentes` es privado y vive tras el mutex del estado; esto es la
    /// única forma legítima de preguntarlo desde fuera.
    pub fn conectados(&self) -> i64 {
        self.estado.lock().map(|e| e.presentes.len() as i64).unwrap_or(0)
    }

    pub fn profundidad(&self) -> u32 {
        self.store
            .conn()
            .query_row("SELECT COUNT(*) FROM analyses WHERE state = 'pendiente'", [], |r| {
                r.get::<_, i64>(0)
            })
            .unwrap_or(0) as u32
    }

    /// Sin ningún trabajador listo no se reparte nada: la cola está parada, y
    /// eso es lo que `queue_paused` debe significar.
    pub fn hay_trabajadores(&self) -> bool {
        self.estado
            .lock()
            .map(|e| e.trabajadores.values().any(|v| v.listo))
            .unwrap_or(false)
    }

    pub fn foto(&self) -> QueueView {
        let cuenta = |estado: &str| {
            self.store
                .conn()
                .query_row(
                    "SELECT COUNT(*) FROM analyses WHERE state = ?1",
                    [estado],
                    |r| r.get::<_, i64>(0),
                )
                .unwrap_or(0) as u32
        };
        let trabajadores = self
            .estado
            .lock()
            .map(|e| {
                let mut v: Vec<WorkerView> = e
                    .trabajadores
                    .iter()
                    .map(|(d, w)| WorkerView {
                        dispositivo: d.clone(),
                        modelo: w.modelo.clone(),
                        trabajo: w.trabajo,
                        listo: w.listo,
                    })
                    .collect();
                v.sort_by(|a, b| a.dispositivo.cmp(&b.dispositivo));
                v
            })
            .unwrap_or_default();
        QueueView { pendientes: cuenta("pendiente"), en_curso: cuenta("en_curso"), trabajadores }
    }

    // ---- interno ----

    fn lanzar_uno(&self, dispositivo: &str) {
        let log = self
            .dir
            .join("workers")
            .join(format!("{}.log", dispositivo.replace(':', "-")));
        match worker::spawn(
            dispositivo.to_string(),
            &self.python,
            &self.script,
            log,
            self.eventos.clone(),
            &crate::assets::ruta("registros/modelos"),
        ) {
            Ok(l) => {
                if let Ok(mut e) = self.estado.lock() {
                    e.trabajadores.insert(
                        dispositivo.to_string(),
                        Vivo {
                            modelo: None,
                            trabajo: None,
                            listo: false,
                            desde: Instant::now(),
                            tx: l.trabajos,
                            matar: Some(l.matar),
                        },
                    );
                }
                tracing::info!("trabajador lanzado en {dispositivo}");
            }
            Err(err) => {
                tracing::error!("no se pudo lanzar el trabajador de {dispositivo}: {err}");
                // Que ni siquiera arranque cuenta como fallo para la espera: si
                // no, un script borrado daría vueltas en bucle cerrado.
                self.apuntar_fallo(dispositivo);
            }
        }
    }

    /// Anota que este dispositivo ha fallado y cuándo se puede reintentar. La
    /// espera se dobla en cada intento hasta el tope.
    fn apuntar_fallo(&self, dispositivo: &str) {
        if let Ok(mut e) = self.estado.lock() {
            let (_, veces) = e.reintento.get(dispositivo).copied().unwrap_or((Instant::now(), 0));
            let veces = veces.saturating_add(1);
            let espera = (RELANZAR_MIN_S << veces.min(5)).min(RELANZAR_MAX_S);
            e.reintento.insert(
                dispositivo.to_string(),
                (Instant::now() + std::time::Duration::from_secs(espera), veces),
            );
        }
    }

    /// Relanza a los ausentes y mata a los que llevan demasiado sin decir
    /// `listo`. Sin esto, un trabajador que muere o que se cuelga cargando
    /// pesos deja su dispositivo perdido hasta que alguien reinicie el daemon.
    fn revisar(&self) {
        let plazo = std::time::Duration::from_secs(
            self.store
                .get_meta("queue_listo_s")
                .and_then(|v| v.parse().ok())
                .unwrap_or(LISTO_S),
        );
        let ahora_i = Instant::now();

        // Los que se quedaron cargando para siempre. Se matan y su `Muerto`
        // hará el resto por el camino normal.
        let colgados: Vec<oneshot::Sender<()>> = match self.estado.lock() {
            Ok(mut e) => e
                .trabajadores
                .values_mut()
                .filter(|w| !w.listo && ahora_i.duration_since(w.desde) > plazo)
                .filter_map(|w| w.matar.take())
                .collect(),
            Err(_) => return,
        };
        for m in colgados {
            let _ = m.send(());
        }

        // Y los que faltan, si les toca.
        let faltan: Vec<String> = match self.estado.lock() {
            Ok(e) => self
                .dispositivos
                .iter()
                .filter(|d| !e.trabajadores.contains_key(*d))
                .filter(|d| e.reintento.get(*d).map(|(c, _)| ahora_i >= *c).unwrap_or(true))
                .cloned()
                .collect(),
            Err(_) => return,
        };
        for d in faltan {
            self.apuntar_fallo(&d);
            self.lanzar_uno(&d);
        }
    }

    async fn bucle(
        self: Arc<Self>,
        mut rx_avisos: mpsc::UnboundedReceiver<()>,
        mut rx_ev: mpsc::UnboundedReceiver<Evento>,
    ) {
        loop {
            tokio::select! {
                Some(ev) = rx_ev.recv() => self.aplicar(ev).await,
                Some(_) = rx_avisos.recv() => {}
                _ = tokio::time::sleep(std::time::Duration::from_secs(TICK_S)) => {}
            }
            self.revisar();
            self.repartir_ahora();
        }
    }

    /// ¿Este trabajador tiene de verdad este trabajo en la mano?
    ///
    /// Un trabajador confundido podría contestar por un `id` que nunca se le
    /// dio —el de otro dispositivo, o uno ya terminado— y machacar un resultado
    /// bueno. Se ignora y se registra: al trabajador se le cree el log, no los
    /// datos, y eso vale también para los identificadores.
    fn es_suyo(&self, dispositivo: &str, id: i64) -> bool {
        let suyo = self
            .estado
            .lock()
            .map(|e| e.trabajadores.get(dispositivo).and_then(|w| w.trabajo) == Some(id))
            .unwrap_or(false);
        if !suyo {
            tracing::warn!("[{dispositivo}] contestó por el trabajo {id}, que no es suyo");
        }
        suyo
    }

    async fn aplicar(&self, ev: Evento) {
        match ev {
            Evento::Listo { dispositivo, modelo } => {
                if let Ok(mut e) = self.estado.lock() {
                    if let Some(w) = e.trabajadores.get_mut(&dispositivo) {
                        w.listo = true;
                        w.modelo = modelo;
                    }
                    // Arrancó bien: la espera creciente vuelve a cero. Si no,
                    // un dispositivo que falló tres veces hace una hora seguiría
                    // esperando un minuto para relanzarse la próxima vez.
                    e.reintento.remove(&dispositivo);
                }
            }
            Evento::Progreso { dispositivo, id, fase, pct } => {
                if !self.es_suyo(&dispositivo, id) {
                    return;
                }
                // NO se escribe. Se emite y se olvida: persistir cada línea de
                // progreso es lo único que rompería el mutex único de SQLite.
                if let Some((user_id, _)) = self.dueno_y_caso(id) {
                    let _ = self.difusion.send(Cambio::Progreso {
                        user_id,
                        analysis_id: id,
                        fase,
                        pct,
                    });
                }
            }
            Evento::Vectores { dispositivo, id, modelo, dims, fichero } => {
                if !self.es_suyo(&dispositivo, id) {
                    return;
                }
                // El vector viene por fichero y no por la tubería. Se lee y se
                // borra; el trabajador ya terminó el suyo y queda libre para
                // el siguiente mientras Rust recupera y agrupa.
                let vector = leer_f32(&fichero, dims);
                let _ = std::fs::remove_file(&fichero);

                let Some(vector) = vector else {
                    self.soltar(&dispositivo, id);
                    self.fallar(id, "no se pudo leer el vector que escribió el trabajador");
                    return;
                };
                let pedido = self.modelo_del_analisis(id).unwrap_or_default();
                let Some(nivel) = self.nivel_de(&pedido) else {
                    self.soltar(&dispositivo, id);
                    self.fallar(id, "ningún índice instalado sirve para consultar con este nivel");
                    return;
                };
                // Un trabajador viejo manda `modelo` vacío: se toma el primero
                // del nivel, que es lo que ese trabajador habrá embebido.
                let cual = if modelo.is_empty() {
                    nivel.recuperacion.first().cloned().unwrap_or_default()
                } else {
                    modelo
                };
                let recibidos = {
                    let mut v = self.vectores.lock().unwrap();
                    let recibidos = v.entry(id).or_default();
                    recibidos.push((cual, vector));
                    recibidos.len()
                };
                if recibidos < nivel.recuperacion.len() {
                    return; // faltan modelos; el trabajador sigue mandando
                }

                // Nulo significa «el pedido», que es lo normal. Solo se
                // escribe cuando hubo descenso, para que la ausencia de valor
                // no se confunda con «no lo sabemos».
                if nivel.id != pedido {
                    let _ = self.store.conn().execute(
                        "UPDATE analyses SET nivel_efectivo = ?2 WHERE id = ?1",
                        rusqlite::params![id, &nivel.id],
                    );
                }

                let vectores = self.vectores.lock().unwrap().remove(&id).unwrap_or_default();
                self.soltar(&dispositivo, id);
                match crate::recuperar::candidatos(&self.store, &nivel, &vectores).await {
                    Ok(c) if !c.is_empty() => {
                        let consulta = self.imagen_del_analisis(id).unwrap_or_default();
                        let rutas = self.rutas_de_candidatos(&c);
                        // En paralelo con el verificador, no antes: un agente
                        // equivocado no puede matar un candidato antes de que
                        // RANSAC tenga ocasión de confirmarlo.
                        let agentes_del_nivel = self.agentes_de(&nivel);
                        let (afinados, dictamen) = tokio::join!(
                            crate::verificar::afinar(&nivel, &consulta, c.clone(), &rutas),
                            crate::agentar::preguntar(&agentes_del_nivel, &consulta),
                        );
                        let afinados = afinados.unwrap_or_default();
                        // Los que ningún verificador respaldó se caen. Si se
                        // caen todos, se contesta con la recuperación sin
                        // afinar y se dice — negarse escondería información
                        // que el investigador puede usar.
                        let vivos: Vec<_> = afinados
                            .iter()
                            .filter(|a| a.ganador.is_some())
                            .map(|a| {
                                let g = a.ganador.as_ref().unwrap();
                                lumi_index::agrupar::Candidato {
                                    lat: g.lat,
                                    lng: g.lng,
                                    ..a.candidato.clone()
                                }
                            })
                            .collect();
                        // ponytail: `en_grupos` agrega candidatos por
                        // vecindad de tesela, así que un grupo con más de un
                        // candidato ya no tiene un único respaldo que
                        // atribuirle. Se busca por coordenada exacta (redonda
                        // a 6 decimales, ~11 cm): funciona para el caso común
                        // de un grupo con un solo candidato verificado, y
                        // degrada a «sin respaldo» —nunca a un dato
                        // inventado— en el resto.
                        let clave = |lat: f64, lng: f64| {
                            ((lat * 1e6).round() as i64, (lng * 1e6).round() as i64)
                        };
                        let respaldo_de: std::collections::HashMap<(i64, i64), (u32, String)> =
                            afinados
                                .iter()
                                .filter_map(|a| {
                                    let g = a.ganador.as_ref()?;
                                    Some((clave(g.lat, g.lng), (g.inliers, g.verificador.clone())))
                                })
                                .collect();
                        let usar: Vec<_> = if vivos.is_empty() {
                            afinados.into_iter().map(|a| a.candidato).collect()
                        } else {
                            vivos
                        };

                        // Lo que los agentes tengan que decir de cada
                        // candidato, con los atributos de su coordenada ya
                        // resueltos offline y los inliers que lo protegen.
                        let veredictos: Vec<lumi_index::agentes::Veredicto> =
                            dictamen.iter().map(|(v, _)| v.clone()).collect();
                        // Antes relockeaba `self.geo` una vez POR CANDIDATO
                        // dentro del `.map()` — se agarra una sola vez fuera.
                        let geo = self.geo.lock().unwrap();
                        let para_aplicar: Vec<_> = usar
                            .iter()
                            .map(|c| {
                                let at = geo.atributos(c.lat, c.lng);
                                let inliers = respaldo_de.get(&clave(c.lat, c.lng)).map(|(i, _)| *i);
                                (at, inliers)
                            })
                            .collect();
                        drop(geo);
                        let veredicto_final = lumi_index::agentes::aplicar(
                            &self.agentes.lock().unwrap(), &veredictos, &para_aplicar,
                        );
                        let motivo_de: std::collections::HashMap<(i64, i64), String> = usar
                            .iter()
                            .zip(veredicto_final.ajustes.iter())
                            .filter_map(|(c, a)| {
                                Some((clave(c.lat, c.lng), a.motivo.clone()?))
                            })
                            .collect();
                        let usar: Vec<_> = usar
                            .iter()
                            .zip(veredicto_final.ajustes.iter())
                            .filter(|(_, a)| a.factor > 0.0)
                            .map(|(c, _)| c.clone())
                            .collect();

                        self.guardar_agentes(id, &dictamen);
                        let h = crate::recuperar::hipotesis(&usar);
                        let respaldo: Vec<(Option<u32>, Option<String>, Option<String>)> = h
                            .iter()
                            .skip(1)
                            .map(|hip| {
                                let k = clave(hip.lat, hip.lng);
                                let (i, v) = respaldo_de
                                    .get(&k)
                                    .map(|(i, v)| (Some(*i), Some(v.clone())))
                                    .unwrap_or((None, None));
                                (i, v, motivo_de.get(&k).cloned())
                            })
                            .collect();
                        self.guardar_resultado(id, &h, &respaldo);
                    }
                    // Sin candidatos NO es una avería: es una respuesta.
                    Ok(_) => self.fallar(id, "ningún índice instalado cubre esta imagen"),
                    Err(e) => self.fallar(id, &format!("no se pudo recuperar: {e}")),
                }
            }
            Evento::Resultado { dispositivo, id, lat, lng, radio_m, confianza, alternativas } => {
                if !self.es_suyo(&dispositivo, id) {
                    return;
                }
                // Un motor que sepa contestar por su cuenta (sin pasar por
                // `Vectores`) sigue siendo legal — `lumi_worker.py` sigue
                // siendo una referencia válida. La principal manda su propia
                // confianza; las alternativas, la suya, tal como las mandó.
                let principal = lumi_proto::worker::Hipotesis {
                    lat, lng, radio_m, peso: confianza, indice: String::new(), autor: String::new(),
                    inliers: None, verificador: None, motivo_agente: None,
                };
                self.guardar_hipotesis(id, &principal, &alternativas, &[]);
                self.soltar(&dispositivo, id);
                self.anunciar(id, "hecho");
            }
            Evento::Fallo { dispositivo, id, motivo } => {
                if !self.es_suyo(&dispositivo, id) {
                    return;
                }
                self.fallar(id, &motivo);
            }
            Evento::Muerto { dispositivo } => self.enterrar(&dispositivo),
        }
    }

    fn modelo_del_analisis(&self, id: i64) -> Option<String> {
        self.store.conn().query_row("SELECT model FROM analyses WHERE id = ?1", [id], |r| r.get(0)).ok()
    }

    /// El nivel que de verdad se puede correr: el pedido, o el primero por
    /// debajo cuyas capas estén todas instaladas.
    fn nivel_de(&self, pedido: &str) -> Option<lumi_index::niveles::Nivel> {
        let capas = crate::recuperar::capas_instaladas(&self.store);
        lumi_index::niveles::resolver(&self.niveles.lock().unwrap(), pedido, &capas).cloned()
    }

    /// Los agentes del nivel. **Vacío en el nivel significa «todos los del
    /// registro»** —así está Vision—, y por eso esto no puede ser un simple
    /// `clone` del campo.
    fn agentes_de(&self, nivel: &lumi_index::niveles::Nivel) -> Vec<String> {
        if nivel.agentes.is_empty() {
            self.agentes.lock().unwrap().iter().map(|a| a.id.clone()).collect()
        } else {
            nivel.agentes.clone()
        }
    }

    /// La imagen de consulta del análisis, la primera de las que trae —hoy un
    /// análisis siempre es una sola. Reutiliza `rutas`, que ya sabe dónde vive
    /// cada imagen en disco (`{DATA}/projects/<id>/<imagen>`).
    fn imagen_del_analisis(&self, id: i64) -> Option<String> {
        self.rutas(id)?.into_iter().next()
    }

    /// La foto de referencia de cada candidato, que es lo que el verificador
    /// tiene que mirar. Se busca por quadkey y coordenada porque `Candidato`
    /// no arrastra el id — no lo necesitaba hasta ahora.
    fn rutas_de_candidatos(&self, cands: &[lumi_index::agrupar::Candidato]) -> Vec<(i64, String)> {
        let c = self.store.conn();
        cands
            .iter()
            .filter_map(|cand| {
                c.query_row(
                    "SELECT id, ruta FROM reference_images
                      WHERE quadkey = ?1 AND lat = ?2 AND lng = ?3 LIMIT 1",
                    rusqlite::params![&cand.quadkey, cand.lat, cand.lng],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .ok()
            })
            .collect()
    }

    /// Guarda la hipótesis principal en las columnas `result_*` de `analyses`
    /// (que ya existen y que el cliente ya lee) y las alternativas en
    /// `analysis_hypotheses`, en una sola transacción: un análisis a medio
    /// escribir es peor que uno que tarda un poco más.
    ///
    /// `respaldo` empareja por posición con `alternativas` — la principal no
    /// lleva inliers/verificador porque vive en columnas propias de
    /// `analyses` que este ciclo no amplía. `&[]` es válido: faltan tantas
    /// entradas como haga falta y todo lo que falte se guarda `NULL`, que es
    /// justo lo que significa «nadie lo verificó» (el camino de
    /// `Msg::Resultado`, donde el motor contesta por su cuenta).
    fn guardar_hipotesis(
        &self,
        id: i64,
        principal: &lumi_proto::worker::Hipotesis,
        alternativas: &[lumi_proto::worker::Hipotesis],
        respaldo: &[(Option<u32>, Option<String>, Option<String>)],
    ) {
        let mut c = self.store.conn();
        let tx = match c.transaction() {
            Ok(t) => t,
            Err(_) => return,
        };
        let _ = tx.execute(
            "UPDATE analyses SET state = 'hecho', error = NULL, result_lat = ?2,
                    result_lng = ?3, result_radius_m = ?4, result_confidence = ?5,
                    finished_at = ?6
             WHERE id = ?1",
            rusqlite::params![id, principal.lat, principal.lng, principal.radio_m, principal.peso, ahora()],
        );
        let _ = tx.execute("DELETE FROM analysis_hypotheses WHERE analysis_id = ?1", [id]);
        for (i, h) in alternativas.iter().enumerate() {
            let (inliers, verificador, motivo) =
                respaldo.get(i).cloned().unwrap_or((None, None, None));
            let _ = tx.execute(
                "INSERT INTO analysis_hypotheses
                    (analysis_id, orden, lat, lng, radio_m, peso, indice, autor, inliers,
                     verificador, motivo_agente)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
                rusqlite::params![
                    id, i as i64, h.lat, h.lng, h.radio_m, h.peso, h.indice, h.autor, inliers,
                    verificador, motivo
                ],
            );
        }
        let _ = tx.commit();
    }

    /// Lo mismo que `guardar_hipotesis`, pero para el camino de
    /// `recuperar::hipotesis`: la primera hipótesis de la lista es la
    /// principal, el resto son sus alternativas.
    fn guardar_resultado(
        &self,
        id: i64,
        hipotesis: &[lumi_proto::worker::Hipotesis],
        respaldo: &[(Option<u32>, Option<String>, Option<String>)],
    ) {
        let Some((principal, alternativas)) = hipotesis.split_first() else { return };
        self.guardar_hipotesis(id, principal, alternativas, respaldo);
        self.anunciar(id, "hecho");
    }

    /// Los veredictos, incluidos los que se abstuvieron. Un agente que no llegó
    /// a su umbral aparece con la etiqueta `abstiene`: en el panel se ve que
    /// corrió y que no vio suficiente, en vez de desaparecer sin explicación.
    fn guardar_agentes(&self, id: i64, dictamen: &[(lumi_index::agentes::Veredicto, String)]) {
        let c = self.store.conn();
        let _ = c.execute("DELETE FROM analysis_agents WHERE analysis_id = ?1", [id]);
        let agentes = self.agentes.lock().unwrap();
        for (v, detalle) in dictamen {
            let Some(a) = agentes.iter().find(|a| a.id == v.agente) else { continue };
            let abstiene = v.confianza < a.umbral_confianza;
            let _ = c.execute(
                "INSERT OR REPLACE INTO analysis_agents
                    (analysis_id, agente, nombre, etiqueta, confianza, tipo, detalle)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                rusqlite::params![
                    id,
                    &a.id,
                    &a.nombre,
                    if abstiene { "abstiene" } else { v.etiqueta.as_str() },
                    v.confianza,
                    &a.tipo,
                    detalle,
                ],
            );
        }
    }

    fn fallar(&self, id: i64, motivo: &str) {
        let _ = self.store.conn().execute(
            "UPDATE analyses SET state = 'error', error = ?2, finished_at = ?3 WHERE id = ?1",
            rusqlite::params![id, motivo, ahora()],
        );
        self.anunciar(id, "error");
    }

    /// El trabajador se murió. Lo que tenía en la mano no es culpa suya, así que
    /// vuelve a la cola — pero con tope: sin él, una imagen envenenada tumbaría
    /// a la misma GPU en bucle para siempre.
    fn enterrar(&self, dispositivo: &str) {
        let trabajo = match self.estado.lock() {
            Ok(mut e) => e.trabajadores.remove(dispositivo).and_then(|w| w.trabajo),
            Err(_) => None,
        };
        tracing::error!("el trabajador de {dispositivo} ha muerto");
        // Sin esto, un dispositivo que muere al instante (script que no
        // existe, intérprete roto) se relanzaba cada `TICK_S` para siempre:
        // el único sitio que antes anotaba el retraso creciente era un
        // `spawn()` que fallara AL CREAR el proceso, no uno que muriera justo
        // después. `revisar()` es quien lo relanza, así que aquí solo se
        // anota la espera para cuando le toque mirar.
        self.apuntar_fallo(dispositivo);
        let Some(id) = trabajo else { return };

        let veces: i64 = self
            .store
            .conn()
            .query_row("SELECT requeues FROM analyses WHERE id = ?1", [id], |r| r.get(0))
            .unwrap_or(0);
        if veces >= MAX_REQUEUES {
            let _ = self.store.conn().execute(
                "UPDATE analyses SET state = 'error', error = ?2, finished_at = ?3 WHERE id = ?1",
                rusqlite::params![
                    id,
                    "el trabajador murió dos veces con este trabajo",
                    ahora()
                ],
            );
            self.anunciar(id, "error");
        } else {
            let _ = self.store.conn().execute(
                "UPDATE analyses SET state = 'pendiente', requeues = requeues + 1 WHERE id = ?1",
                [id],
            );
            self.anunciar(id, "pendiente");
        }
    }

    fn soltar(&self, dispositivo: &str, id: i64) {
        if let Ok(mut e) = self.estado.lock() {
            if let Some(w) = e.trabajadores.get_mut(dispositivo) {
                if w.trabajo == Some(id) {
                    w.trabajo = None;
                }
            }
        }
    }

    fn dueno_y_caso(&self, analysis_id: i64) -> Option<(i64, i64)> {
        self.store
            .conn()
            .query_row(
                "SELECT requested_by, case_id FROM analyses WHERE id = ?1",
                [analysis_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .ok()
    }

    fn anunciar(&self, analysis_id: i64, estado: &str) {
        if let Some((user_id, case_id)) = self.dueno_y_caso(analysis_id) {
            let _ = self.difusion.send(Cambio::Estado {
                user_id,
                analysis_id,
                case_id,
                estado: estado.to_string(),
            });
        }
    }

    fn repartir_ahora(&self) {
        let libres: Vec<Libre> = match self.estado.lock() {
            Ok(e) => e
                .trabajadores
                .iter()
                .filter(|(_, w)| w.listo && w.trabajo.is_none())
                .map(|(d, w)| Libre { dispositivo: d.clone(), modelo: w.modelo.clone() })
                .collect(),
            Err(_) => return,
        };
        if libres.is_empty() {
            return;
        }

        let candidatos = self.candidatos();
        if candidatos.is_empty() {
            return;
        }
        let duenos = self.duenos(&candidatos);

        for a in plan::repartir(&candidatos, &duenos, &libres) {
            let Some(imagenes) = self.rutas(a.analysis_id) else { continue };
            let Some(modelo) = candidatos
                .iter()
                .find(|c| c.analysis_id == a.analysis_id)
                .map(|c| c.modelo.clone())
            else {
                continue;
            };

            // Se marca ANTES de mandarlo: si el trabajador muere entre el
            // UPDATE y el envío, `enterrar` lo devuelve a la cola. Al revés se
            // perdería sin dejar rastro.
            let marcado = self
                .store
                .conn()
                .execute(
                    "UPDATE analyses SET state = 'en_curso' WHERE id = ?1 AND state = 'pendiente'",
                    [a.analysis_id],
                )
                .unwrap_or(0);
            if marcado == 0 {
                continue;
            }

            // El campo `modelo` del análisis guarda el NIVEL («mini», «pro»,
            // «vision»), no un id de modelo. Se resuelve contra el registro y
            // se manda la lista. `nivel_de` da `None` cuando ningún índice
            // instalado cubre sus modelos de recuperación — antes esto caía
            // en el nivel mismo («mini») como si fuera un id de modelo, y el
            // trabajador fallaba mucho más abajo con "el modelo mini no está
            // en el registro": cierto en la letra, pero el motivo real es que
            // no hay ningún índice instalado, no un registro roto.
            let Some(modelos) = self.nivel_de(&modelo).map(|n| n.recuperacion.clone()) else {
                self.fallar(a.analysis_id, "ningún índice instalado sirve para consultar con este nivel");
                continue;
            };

            let enviado = match self.estado.lock() {
                Ok(mut e) => match e.trabajadores.get_mut(&a.dispositivo) {
                    Some(w) => {
                        w.trabajo = Some(a.analysis_id);
                        w.tx.send(Job::con_modelos(a.analysis_id, modelos, imagenes)).is_ok()
                    }
                    None => false,
                },
                Err(_) => false,
            };
            if enviado {
                self.anunciar(a.analysis_id, "en_curso");
            } else {
                let _ = self.store.conn().execute(
                    "UPDATE analyses SET state = 'pendiente' WHERE id = ?1",
                    [a.analysis_id],
                );
            }
        }
    }

    fn candidatos(&self) -> Vec<Candidato> {
        let c = self.store.conn();
        let Ok(mut q) = c.prepare(
            "SELECT id, requested_by, model, created_at FROM analyses
             WHERE state = 'pendiente' ORDER BY created_at",
        ) else {
            return vec![];
        };
        q.query_map([], |r| {
            Ok(Candidato {
                analysis_id: r.get(0)?,
                user_id: r.get(1)?,
                modelo: r.get(2)?,
                created_at: r.get(3)?,
            })
        })
        .map(|it| it.flatten().collect())
        .unwrap_or_default()
    }

    fn duenos(&self, candidatos: &[Candidato]) -> HashMap<i64, Dueno> {
        let presentes = self
            .estado
            .lock()
            .map(|e| e.presentes.keys().copied().collect::<Vec<_>>())
            .unwrap_or_default();
        let mut out = HashMap::new();
        for uid in candidatos.iter().map(|c| c.user_id).collect::<std::collections::HashSet<_>>() {
            // `limits::effective` y no la tabla: la precedencia de dos niveles
            // vive ahí y en un solo sitio.
            let l = limits::effective(&self.store, uid);
            // Antes eran dos adquisiciones separadas de `store.conn()` por
            // usuario — se agrupan bajo una sola.
            let (bloqueado, en_curso): (bool, i64) = {
                let c = self.store.conn();
                let bloqueado = c
                    .query_row("SELECT blocked FROM users WHERE id = ?1", [uid], |r| r.get::<_, i64>(0))
                    .map(|b| b == 1)
                    .unwrap_or(true);
                let en_curso = c
                    .query_row(
                        "SELECT COUNT(*) FROM analyses WHERE requested_by = ?1 AND state = 'en_curso'",
                        [uid],
                        |r| r.get(0),
                    )
                    .unwrap_or(0);
                (bloqueado, en_curso)
            };
            out.insert(
                uid,
                Dueno {
                    bloqueado,
                    conectado: presentes.contains(&uid),
                    segundo_plano: l.background_jobs,
                    max_concurrent: l.max_concurrent,
                    prioridad: l.queue_priority,
                    en_curso,
                },
            );
        }
        out
    }

    /// Las rutas de las imágenes del análisis. `None` si le falta alguna: mejor
    /// dejarlo pendiente que mandar un trabajo incompleto.
    fn rutas(&self, analysis_id: i64) -> Option<Vec<String>> {
        let c = self.store.conn();
        let mut q = c
            .prepare(
                "SELECT ca.project_id, i.id FROM analysis_images ai
                 JOIN images i ON i.id = ai.image_id
                 JOIN cases ca ON ca.id = i.case_id
                 WHERE ai.analysis_id = ?1",
            )
            .ok()?;
        let filas: Vec<(i64, i64)> = q
            .query_map([analysis_id], |r| Ok((r.get(0)?, r.get(1)?)))
            .ok()?
            .flatten()
            .collect();
        if filas.is_empty() {
            return None;
        }
        // El mismo reparto que `images::dir_for`: `{DATA}/projects/<id>/<imagen>`.
        Some(
            filas
                .into_iter()
                .map(|(p, i)| self.dir.join("projects").join(p.to_string()).join(i.to_string()))
                .map(|p| p.to_string_lossy().into_owned())
                .collect(),
        )
    }
}
