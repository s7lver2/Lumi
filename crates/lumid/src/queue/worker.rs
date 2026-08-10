//! La vida de un trabajador: un proceso hijo con el que se habla por tuberías.
//!
//! Sin puertos y sin autenticación: un trabajador solo puede recibir de su
//! padre, y muere con él, así que un reinicio del daemon no deja procesos
//! huérfanos ocupando VRAM. Es el mismo primitivo que el runner de tareas del
//! subsistema 1, que ya se escribió pensando en este momento.

use anyhow::Result;
use lumi_proto::worker::{Job, Msg};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;
use tokio::sync::mpsc::{self, UnboundedSender};
use tokio::sync::oneshot;

/// Lo que le pasa a un trabajador, ya etiquetado con quién es. La cola no
/// necesita saber nada más de él.
#[derive(Debug, Clone)]
pub enum Evento {
    Listo { dispositivo: String, modelo: Option<String> },
    Progreso { dispositivo: String, id: i64, fase: String, pct: u8 },
    /// El trabajador terminó de embeber: el vector está en `fichero`, a la
    /// espera de que la cola lo lea, lo recupere contra Qdrant y lo borre.
    Vectores { dispositivo: String, id: i64, dims: u32, fichero: String },
    Resultado {
        dispositivo: String,
        id: i64,
        lat: f64,
        lng: f64,
        radio_m: f64,
        confianza: f64,
        alternativas: Vec<lumi_proto::worker::Hipotesis>,
    },
    Fallo { dispositivo: String, id: i64, motivo: String },
    /// Su `stdout` se cerró: el proceso terminó, con o sin gracia.
    Muerto { dispositivo: String },
}

impl Evento {
    /// El `dispositivo` se pone AQUÍ y no se lee del mensaje: el trabajador
    /// declara el suyo en `listo`, pero quién es lo decidimos nosotros al
    /// lanzarlo. Al trabajador se le cree el log, no los datos.
    fn de(dispositivo: &str, m: Msg) -> Self {
        let d = dispositivo.to_string();
        match m {
            Msg::Listo { modelo, .. } => Evento::Listo { dispositivo: d, modelo },
            Msg::Progreso { id, fase, pct } => Evento::Progreso { dispositivo: d, id, fase, pct },
            Msg::Vectores { id, dims, fichero } => Evento::Vectores { dispositivo: d, id, dims, fichero },
            Msg::Resultado { id, lat, lng, radio_m, confianza, alternativas } => {
                Evento::Resultado { dispositivo: d, id, lat, lng, radio_m, confianza, alternativas }
            }
            Msg::Fallo { id, motivo } => Evento::Fallo { dispositivo: d, id, motivo },
        }
    }
}

/// Los dos hilos con los que la cola maneja un trabajador ya lanzado.
pub struct Lanzado {
    pub trabajos: UnboundedSender<Job>,
    /// Mandar aquí lo mata de verdad.
    ///
    /// Hace falta un matar explícito y no basta con cerrarle la entrada: el
    /// caso que hay que resolver es justo el del trabajador colgado cargando
    /// pesos, y ese no está leyendo su `stdin`, así que no se enteraría.
    pub matar: oneshot::Sender<()>,
}

/// Lanza un trabajador y devuelve por dónde hablarle.
///
/// No espera a que esté listo: el `Evento::Listo` llegará por el canal cuando
/// termine de cargar, que puede ser dentro de un minuto. Quien llama no debe
/// darle trabajo hasta entonces.
pub fn spawn(
    dispositivo: String,
    python: &Path,
    script: &Path,
    log: PathBuf,
    eventos: UnboundedSender<Evento>,
) -> Result<Lanzado> {
    let mut hijo = Command::new(python)
        // `-u` no es opcional: sin él Python almacena su salida y el daemon no
        // ve una línea hasta que el proceso muere. El `listo` no llegaría nunca
        // y el trabajador parecería colgado desde el primer segundo.
        .arg("-u")
        .arg(script)
        .env("LUMI_DEVICE", &dispositivo)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        // Que el trabajador muera con el daemon es media razón de haber elegido
        // tuberías: si no, un reinicio deja la VRAM ocupada por un fantasma.
        .kill_on_drop(true)
        .spawn()?;

    let mut entrada = hijo.stdin.take().expect("stdin se pidió como piped");
    let salida = BufReader::new(hijo.stdout.take().expect("stdout se pidió como piped"));
    let errores = BufReader::new(hijo.stderr.take().expect("stderr se pidió como piped"));
    let (tx, mut rx) = mpsc::unbounded_channel::<Job>();
    let (tx_matar, mut rx_matar) = oneshot::channel::<()>();

    // Las órdenes que le mandamos.
    tokio::spawn(async move {
        while let Some(job) = rx.recv().await {
            let Ok(linea) = serde_json::to_string(&job) else { continue };
            if entrada.write_all(format!("{linea}\n").as_bytes()).await.is_err() {
                break;
            }
            let _ = entrada.flush().await;
        }
    });

    // Su log, tal cual y sin interpretar. Es lo único suyo que no se valida.
    tokio::spawn(async move {
        if let Some(p) = log.parent() {
            let _ = std::fs::create_dir_all(p);
        }
        let mut l = errores.lines();
        while let Ok(Some(linea)) = l.next_line().await {
            if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&log) {
                use std::io::Write;
                let _ = f.write_all(format!("{linea}\n").as_bytes());
            }
        }
    });

    // Sus respuestas.
    let dev = dispositivo.clone();
    tokio::spawn(async move {
        let mut l = salida.lines();
        loop {
            let linea = tokio::select! {
                r = l.next_line() => match r {
                    Ok(Some(t)) => t,
                    // `stdout` cerrado o ilegible: el proceso terminó.
                    _ => break,
                },
                _ = &mut rx_matar => {
                    tracing::warn!("[{dev}] se le acabó el plazo y se le mata");
                    let _ = hijo.kill().await;
                    break;
                }
            };
            match serde_json::from_str::<Msg>(&linea) {
                Ok(m) => {
                    if let Err(motivo) = m.validar() {
                        // Un número imposible no se guarda, pero tampoco se
                        // traga en silencio: el trabajo tiene que acabar en
                        // algo, o se quedaría en curso para siempre.
                        if let Msg::Resultado { id, .. } = m {
                            let _ = eventos.send(Evento::Fallo {
                                dispositivo: dev.clone(),
                                id,
                                motivo: format!(
                                    "el motor devolvió una coordenada imposible: {motivo}"
                                ),
                            });
                        }
                        continue;
                    }
                    if eventos.send(Evento::de(&dev, m)).is_err() {
                        break;
                    }
                }
                // Una línea ilegible no mata al trabajador: se registra y se
                // sigue. Un `print` de depuración perdido en el motor no puede
                // tumbar la cola entera.
                Err(e) => {
                    let corta: String = linea.chars().take(120).collect();
                    tracing::warn!("[{dev}] línea ilegible ({e}): {corta}");
                }
            }
        }
        let _ = hijo.wait().await;
        // Siempre, pase lo que pase: es lo que le dice a la cola que ese
        // dispositivo está libre para relanzarse y que su trabajo se ha
        // quedado sin dueño.
        let _ = eventos.send(Evento::Muerto { dispositivo: dev });
    });

    Ok(Lanzado { trabajos: tx, matar: tx_matar })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// El entorno de pruebas puede no tener Python (por ejemplo un runner de CI
    /// mínimo). Sin él esta prueba se salta con un aviso en vez de fallar: lo
    /// que verifica es la frontera, no la presencia del intérprete.
    fn python3() -> Option<PathBuf> {
        ["python3", "python"].into_iter().find_map(|c| {
            std::process::Command::new(c)
                .arg("--version")
                .output()
                .ok()
                .filter(|o| o.status.success())
                .map(|_| PathBuf::from(c))
        })
    }

    #[tokio::test]
    async fn el_trabajador_de_referencia_cumple_el_contrato() {
        let Some(python) = python3() else {
            eprintln!("sin python3 en el entorno: se salta la prueba de punta a punta");
            return;
        };
        let script = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../workers/lumi_worker.py");
        let log = std::env::temp_dir().join(format!("lumi-w-{}.log", std::process::id()));
        let (tx_ev, mut rx_ev) = mpsc::unbounded_channel();
        let w = spawn("cpu".into(), &python, &script, log.clone(), tx_ev).unwrap();

        // Arranca diciendo que está, todavía sin ningún modelo cargado.
        match rx_ev.recv().await {
            Some(Evento::Listo { modelo: None, dispositivo }) => assert_eq!(dispositivo, "cpu"),
            otro => panic!("se esperaba `listo` sin modelo, llegó {otro:?}"),
        }

        w.trabajos.send(Job::nuevo(42, "mini".into(), vec![])).unwrap();

        // Carga el modelo y lo vuelve a decir.
        match rx_ev.recv().await {
            Some(Evento::Listo { modelo: Some(m), .. }) => assert_eq!(m, "mini"),
            otro => panic!("se esperaba `listo` con modelo, llegó {otro:?}"),
        }
        match rx_ev.recv().await {
            Some(Evento::Progreso { id, .. }) => assert_eq!(id, 42),
            otro => panic!("se esperaba progreso, llegó {otro:?}"),
        }
        // Y contesta un resultado válido para ESE id.
        match rx_ev.recv().await {
            Some(Evento::Resultado { id, lat, lng, .. }) => {
                assert_eq!(id, 42);
                assert!((-90.0..=90.0).contains(&lat) && (-180.0..=180.0).contains(&lng));
            }
            otro => panic!("se esperaba resultado, llegó {otro:?}"),
        }

        // Y matarlo a mano llega hasta el final: es el camino que usa el
        // vigilante con un trabajador colgado cargando pesos.
        w.matar.send(()).unwrap();
        match rx_ev.recv().await {
            Some(Evento::Muerto { dispositivo }) => assert_eq!(dispositivo, "cpu"),
            otro => panic!("se esperaba `muerto`, llegó {otro:?}"),
        }
        std::fs::remove_file(log).ok();
    }
}
