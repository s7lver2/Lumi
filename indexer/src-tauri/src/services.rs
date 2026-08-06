//! Levantar Redis y Qdrant, y saber si están vivos.
//!
//! Los dos escuchan SOLO en 127.0.0.1 y con `protected-mode`. No es una
//! preferencia de despliegue: un almacén de vectores y una cola abiertos a la
//! red en el portátil de un investigador son exactamente lo que este proyecto
//! existe para no hacer.
//!
//! Redis no publica binarios oficiales para Windows. En Linux corre nativo; en
//! Windows el Indexer se instala dentro de WSL, que es la misma postura que
//! ARCHITECTURE.md §7 ya fija para el servidor. Empaquetar Memurai metería una
//! dependencia de terceros con su propia licencia en un proyecto de código
//! abierto.

use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{Arc, Mutex};

use anyhow::{bail, Result};
use serde::Serialize;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command};

pub const REDIS_PUERTO: u16 = 6579;
pub const QDRANT_PUERTO: u16 = 6633;

#[derive(Debug, Clone, Serialize)]
pub struct EstadoServicio {
    pub nombre: String,
    pub vivo: bool,
    pub detalle: String,
}

/// El log de arranque de los dos servicios, en memoria y por líneas. Se sirve
/// por offset igual que el runner del subsistema 1, para que la interfaz pueda
/// engancharse y desengancharse sin perder nada.
#[derive(Default)]
pub struct Log(Mutex<Vec<String>>);

impl Log {
    pub fn apuntar(&self, linea: String) {
        let mut v = self.0.lock().unwrap();
        // ponytail: tope de 2000 líneas en memoria, sin fichero. El techo es
        // que un arranque patológico pierde el principio; la salida, escribirlo
        // a disco como hace el runner del daemon.
        if v.len() >= 2000 {
            v.remove(0);
        }
        v.push(linea);
    }
    pub fn desde(&self, n: usize) -> Vec<String> {
        let v = self.0.lock().unwrap();
        v.iter().skip(n).cloned().collect()
    }
}

pub struct Servicios {
    dir: PathBuf,
    pub log: Arc<Log>,
    hijos: Mutex<Vec<Child>>,
}

/// Escribe un `redis.conf` que no se puede alcanzar desde fuera del equipo.
fn escribir_redis_conf(dir: &Path) -> Result<PathBuf> {
    let datos = dir.join("redis");
    std::fs::create_dir_all(&datos)?;
    let conf = dir.join("redis.conf");
    std::fs::write(
        &conf,
        format!(
            "bind 127.0.0.1\n\
             protected-mode yes\n\
             port {REDIS_PUERTO}\n\
             dir {}\n\
             appendonly yes\n\
             save \"\"\n",
            datos.display()
        ),
    )?;
    Ok(conf)
}

/// Busca un ejecutable probando varios nombres. Misma lección que costó una
/// tarde en el subsistema 4: fijar `python3` a ciegas deja el proceso muerto en
/// cualquier máquina donde se llame de otra forma.
fn buscar(candidatos: &[&str]) -> Option<String> {
    candidatos.iter().find_map(|c| {
        let ok = std::process::Command::new(c)
            .arg("--version")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .is_ok_and(|s| s.success());
        ok.then(|| (*c).to_string())
    })
}

impl Servicios {
    pub fn nuevo(dir: PathBuf) -> Self {
        Self { dir, log: Arc::new(Log::default()), hijos: Mutex::new(Vec::new()) }
    }

    async fn lanzar(&self, nombre: &'static str, exe: &str, args: Vec<String>) -> Result<()> {
        let mut hijo = Command::new(exe)
            .args(&args)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            // Sin esto, cerrar el Indexer dejaría un Redis y un Qdrant
            // huérfanos ocupando puertos hasta el siguiente reinicio.
            .kill_on_drop(true)
            .spawn()?;

        for tuberia in [hijo.stdout.take().map(|s| Box::new(s) as Box<dyn tokio::io::AsyncRead + Unpin + Send>),
                        hijo.stderr.take().map(|s| Box::new(s) as Box<dyn tokio::io::AsyncRead + Unpin + Send>)]
            .into_iter()
            .flatten()
        {
            let log = self.log.clone();
            tokio::spawn(async move {
                let mut lineas = BufReader::new(tuberia).lines();
                while let Ok(Some(l)) = lineas.next_line().await {
                    log.apuntar(format!("{nombre}: {l}"));
                }
            });
        }
        self.hijos.lock().unwrap().push(hijo);
        Ok(())
    }

    pub async fn arrancar(&self) -> Result<()> {
        if cfg!(windows) {
            bail!(
                "Redis no tiene binario oficial para Windows. El Indexer se instala dentro de WSL; \
                 ver la sección «Linux primero» del README."
            );
        }

        let Some(redis) = buscar(&["redis-server"]) else {
            bail!("no encuentro `redis-server` en el PATH");
        };
        let conf = escribir_redis_conf(&self.dir)?;
        self.log.apuntar(format!("redis: usando {}", conf.display()));
        self.lanzar("redis", &redis, vec![conf.display().to_string()]).await?;

        let Some(qdrant) = buscar(&["qdrant"]) else {
            bail!("no encuentro `qdrant` en el PATH");
        };
        let almacen = self.dir.join("qdrant");
        std::fs::create_dir_all(&almacen)?;
        self.log.apuntar(format!("qdrant: storage en {}", almacen.display()));
        // Qdrant se configura por entorno; se le fija el host explícitamente
        // porque su defecto (0.0.0.0) es justo lo que no queremos.
        let mut cmd = Command::new(&qdrant);
        cmd.env("QDRANT__STORAGE__STORAGE_PATH", &almacen)
            .env("QDRANT__SERVICE__HOST", "127.0.0.1")
            .env("QDRANT__SERVICE__HTTP_PORT", QDRANT_PUERTO.to_string())
            .env("QDRANT__TELEMETRY_DISABLED", "true")
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        let mut hijo = cmd.spawn()?;
        if let Some(s) = hijo.stdout.take() {
            let log = self.log.clone();
            tokio::spawn(async move {
                let mut l = BufReader::new(s).lines();
                while let Ok(Some(x)) = l.next_line().await {
                    log.apuntar(format!("qdrant: {x}"));
                }
            });
        }
        self.hijos.lock().unwrap().push(hijo);
        Ok(())
    }

    pub async fn estado(&self) -> Vec<EstadoServicio> {
        let redis = match redis::Client::open(format!("redis://127.0.0.1:{REDIS_PUERTO}/")) {
            Ok(c) => match c.get_multiplexed_async_connection().await {
                Ok(mut con) => {
                    let pong: redis::RedisResult<String> =
                        redis::cmd("PING").query_async(&mut con).await;
                    match pong {
                        Ok(_) => EstadoServicio {
                            nombre: "Redis".into(),
                            vivo: true,
                            detalle: format!("127.0.0.1:{REDIS_PUERTO}"),
                        },
                        Err(e) => no_vivo("Redis", e.to_string()),
                    }
                }
                Err(e) => no_vivo("Redis", e.to_string()),
            },
            Err(e) => no_vivo("Redis", e.to_string()),
        };

        let url = format!("http://127.0.0.1:{QDRANT_PUERTO}/readyz");
        let qdrant = match reqwest::get(&url).await {
            Ok(r) if r.status().is_success() => EstadoServicio {
                nombre: "Qdrant".into(),
                vivo: true,
                detalle: format!("127.0.0.1:{QDRANT_PUERTO}"),
            },
            Ok(r) => no_vivo("Qdrant", format!("respondió {}", r.status())),
            Err(e) => no_vivo("Qdrant", e.to_string()),
        };

        vec![redis, qdrant]
    }
}

fn no_vivo(nombre: &str, detalle: String) -> EstadoServicio {
    EstadoServicio { nombre: nombre.into(), vivo: false, detalle }
}
