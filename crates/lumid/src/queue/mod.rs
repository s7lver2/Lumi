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
            .unwrap_or_else(|| PathBuf::from("python3"));
        let candidato = dir.join("workers/lumi_worker.py");
        let script =
            if candidato.exists() { candidato } else { PathBuf::from("workers/lumi_worker.py") };

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
        });

        // No se lanzan aquí: el vigilante del bucle ve que faltan todos y los
        // levanta en su primera pasada. Un solo camino para arrancar un
        // trabajador, y por tanto un solo sitio donde equivocarse.
        tokio::spawn(cola.clone().bucle(rx_avisos, rx_ev));
        cola
    }

    /// «Ha cambiado algo, mira a ver si puedes repartir». No bloquea nunca.
    pub fn avisar(&self) {
        let _ = self.avisos.send(());
    }

    pub fn suscribir(&self) -> broadcast::Receiver<Cambio> {
        self.difusion.subscribe()
    }

    pub fn entra(self: &Arc<Self>, uid: i64) -> Presencia {
        if let Ok(mut e) = self.estado.lock() {
            *e.presentes.entry(uid).or_insert(0) += 1;
        }
        // Llegar puede desbloquear trabajo propio que estaba pausado.
        self.avisar();
        Presencia { uid, cola: self.clone() }
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
                Some(ev) = rx_ev.recv() => self.aplicar(ev),
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

    fn aplicar(&self, ev: Evento) {
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
            Evento::Resultado { dispositivo, id, lat, lng, radio_m, confianza } => {
                if !self.es_suyo(&dispositivo, id) {
                    return;
                }
                let _ = self.store.conn().execute(
                    "UPDATE analyses SET state = 'hecho', error = NULL, result_lat = ?2,
                            result_lng = ?3, result_radius_m = ?4, result_confidence = ?5,
                            finished_at = ?6
                     WHERE id = ?1",
                    rusqlite::params![id, lat, lng, radio_m, confianza, ahora()],
                );
                self.soltar(&dispositivo, id);
                self.anunciar(id, "hecho");
            }
            Evento::Fallo { dispositivo, id, motivo } => {
                if !self.es_suyo(&dispositivo, id) {
                    return;
                }
                let _ = self.store.conn().execute(
                    "UPDATE analyses SET state = 'error', error = ?2, finished_at = ?3
                     WHERE id = ?1",
                    rusqlite::params![id, motivo, ahora()],
                );
                self.soltar(&dispositivo, id);
                self.anunciar(id, "error");
            }
            Evento::Muerto { dispositivo } => self.enterrar(&dispositivo),
        }
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

            let enviado = match self.estado.lock() {
                Ok(mut e) => match e.trabajadores.get_mut(&a.dispositivo) {
                    Some(w) => {
                        w.trabajo = Some(a.analysis_id);
                        w.tx.send(Job::nuevo(a.analysis_id, modelo, imagenes)).is_ok()
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
            let bloqueado: bool = self
                .store
                .conn()
                .query_row("SELECT blocked FROM users WHERE id = ?1", [uid], |r| {
                    r.get::<_, i64>(0)
                })
                .map(|b| b == 1)
                .unwrap_or(true);
            let en_curso: i64 = self
                .store
                .conn()
                .query_row(
                    "SELECT COUNT(*) FROM analyses WHERE requested_by = ?1 AND state = 'en_curso'",
                    [uid],
                    |r| r.get(0),
                )
                .unwrap_or(0);
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
