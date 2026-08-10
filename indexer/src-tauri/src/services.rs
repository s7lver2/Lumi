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
    /// ¿Es un proceso HIJO nuestro, o uno que ya estaba y hemos adoptado? La
    /// diferencia importa porque solo al propio lo podemos parar, y porque
    /// solo el propio muere al cerrar el Indexer.
    pub propio: bool,
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
    /// Los servicios que hemos lanzado nosotros, con su nombre. Los adoptados
    /// no están aquí, y por eso no se pueden parar desde la aplicación.
    hijos: Mutex<Vec<(&'static str, Child)>>,
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

    async fn lanzar(&self, nombre: &'static str, mut cmd: Command) -> Result<()> {
        let mut hijo = cmd
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            // Sin esto, cerrar el Indexer dejaría un Redis y un Qdrant
            // huérfanos ocupando puertos hasta el siguiente reinicio. Por lo
            // mismo NUNCA se lanza Redis con `--daemonize`: un demonio se
            // desengancha de nosotros y sobrevive a la aplicación, que es
            // justo el huérfano que esto evita.
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
        self.hijos.lock().unwrap().push((nombre, hijo));
        Ok(())
    }

    /// Un comando de una línea dentro de WSL. `sh -lc` para poder expandir
    /// `$HOME` (la ruta de Windows no sirve del otro lado) y `exec` para que el
    /// shell se sustituya por el servicio: así el proceso que WSL nos deja al
    /// otro extremo es el servicio mismo y no un shell que lo envuelve, y
    /// matarlo lo mata de verdad.
    fn en_wsl(guion: &str) -> Command {
        let mut cmd = Command::new("wsl");
        cmd.args(["-e", "sh", "-lc", guion]);
        cmd
    }

    /// ADOPTAR ANTES QUE LANZAR. Un Redis o un Qdrant que ya escuchan en su
    /// puerto valen igual, vengan de donde vengan: de una ejecución anterior
    /// del Indexer, de un servicio del sistema, o —en Windows— de WSL, cuyo
    /// reenvío de `localhost` los hace alcanzables desde el lado Windows sin
    /// exponerlos a la red. Lanzar un segundo contra un puerto ocupado solo
    /// produce un proceso que muere al arrancar.
    pub async fn arrancar(&self) -> Result<()> {
        let (redis_vivo, qdrant_vivo) = self.quien_vive().await;
        if redis_vivo && qdrant_vivo {
            self.log.apuntar("los dos servicios ya escuchaban: se adoptan tal cual".into());
            return Ok(());
        }

        // En Windows no hay nada nativo que lanzar: ni Redis ni Qdrant publican
        // binario oficial. Se levantan dentro de WSL, y eso lo hace `en_wsl`
        // desde el botón, no este camino: quien pulsa «Levantar en WSL» está
        // consintiendo que arranquemos procesos en su distribución, y eso no se
        // hace solo al abrir la aplicación.
        if cfg!(windows) {
            let faltan = match (redis_vivo, qdrant_vivo) {
                (false, false) => "Ni Redis ni Qdrant escuchan",
                (true, false) => "Qdrant no escucha",
                (false, true) => "Redis no escucha",
                (true, true) => unreachable!("se ha devuelto Ok más arriba"),
            };
            let motivo = format!(
                "{faltan}. Ninguno de los dos publica binario oficial para Windows, así que van \
                 dentro de WSL. Pulsa «Levantar en WSL» y el Indexer los arranca ahí y los adopta; \
                 si no están instalados, los instala antes.\n\
                 \nVer la sección «Linux primero» del README."
            );
            // Se apunta ANTES de fallar: un `bail!` sin proceso hijo de por medio
            // no deja rastro en ningún log, y esto era exactamente lo que hacía
            // parecer que "no pasó nada" al abrir la app en Windows sin nada
            // adoptado todavía.
            self.log.apuntar(format!("arrancar: {motivo}"));
            bail!(motivo);
        }

        if !redis_vivo {
            let Some(redis) = buscar(&["redis-server"]) else {
                self.log.apuntar("arrancar: no encuentro `redis-server` en el PATH".into());
                bail!("no encuentro `redis-server` en el PATH");
            };
            let conf = escribir_redis_conf(&self.dir)?;
            self.log.apuntar(format!("redis: usando {}", conf.display()));
            let mut cmd = Command::new(&redis);
            cmd.arg(conf.display().to_string());
            self.lanzar("redis", cmd).await?;
        }

        if !qdrant_vivo {
            let Some(qdrant) = buscar(&["qdrant"]) else {
                self.log.apuntar("arrancar: no encuentro `qdrant` en el PATH".into());
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
                .env("QDRANT__TELEMETRY_DISABLED", "true");
            self.lanzar("qdrant", cmd).await?;
        }
        Ok(())
    }

    /// Levanta dentro de WSL lo que falte, instalándolo antes si hace falta.
    /// Solo Windows: en Linux `arrancar` ya lo hace nativo.
    ///
    /// Los dos quedan como procesos HIJOS del Indexer (nada de `--daemonize`),
    /// así que mueren con él y no se quedan huérfanos ocupando el puerto.
    pub async fn arrancar_wsl(&self) -> Result<()> {
        if !cfg!(windows) {
            bail!("«Levantar en WSL» es solo para Windows; aquí los servicios corren nativos");
        }
        let (redis_vivo, qdrant_vivo) = self.quien_vive().await;
        if redis_vivo && qdrant_vivo {
            self.log.apuntar("los dos servicios ya escuchaban: no hay nada que levantar".into());
            return Ok(());
        }
        self.instalar_en_wsl(redis_vivo, qdrant_vivo).await?;

        if !redis_vivo {
            self.log.apuntar("redis: arrancando dentro de WSL".into());
            self.lanzar(
                "redis",
                Self::en_wsl(&format!(
                    "exec redis-server --bind 127.0.0.1 --protected-mode yes --port {REDIS_PUERTO} \
                     --dir \"$HOME/.lumi-indexer\" --appendonly yes --save ''"
                )),
            )
            .await?;
        }
        if !qdrant_vivo {
            self.log.apuntar("qdrant: arrancando dentro de WSL".into());
            self.lanzar(
                "qdrant",
                Self::en_wsl(&format!(
                    "mkdir -p \"$HOME/.lumi-indexer/qdrant\" && \
                     QDRANT__STORAGE__STORAGE_PATH=\"$HOME/.lumi-indexer/qdrant\" \
                     QDRANT__SERVICE__HOST=127.0.0.1 \
                     QDRANT__SERVICE__HTTP_PORT={QDRANT_PUERTO} \
                     QDRANT__TELEMETRY_DISABLED=true \
                     exec \"$HOME/.lumi-indexer/bin/qdrant\""
                )),
            )
            .await?;
        }
        Ok(())
    }

    /// Instala en WSL lo que no esté. Es lo único de todo el módulo que baja
    /// algo de internet, y por eso solo se llega aquí desde el botón.
    ///
    /// Redis sale de los repositorios de la distribución. Qdrant no está en
    /// ningún repositorio, así que se baja su binario de las publicaciones
    /// oficiales del proyecto, a `~/.lumi-indexer/bin` y no a `/usr/local/bin`:
    /// nada de esto necesita tocar el sistema del usuario fuera de su `$HOME`.
    async fn instalar_en_wsl(&self, redis_vivo: bool, qdrant_vivo: bool) -> Result<()> {
        if !redis_vivo && !Self::hay_en_wsl("redis-server").await {
            self.log.apuntar("redis: no está en WSL, instalándolo".into());
            // `-u root` en vez de `sudo`: WSL entra como root sin contraseña, y
            // `sudo` en un proceso sin terminal se queda esperando una que no
            // va a llegar nunca.
            let mut cmd = Command::new("wsl");
            cmd.args([
                "-u",
                "root",
                "-e",
                "sh",
                "-lc",
                "DEBIAN_FRONTEND=noninteractive apt-get update && \
                 DEBIAN_FRONTEND=noninteractive apt-get install -y redis-server curl ca-certificates && \
                 (systemctl disable --now redis-server 2>/dev/null || true)",
            ]);
            self.correr_hasta_el_final("instalar redis", cmd).await?;
        }

        if !qdrant_vivo && !Self::hay_en_wsl("$HOME/.lumi-indexer/bin/qdrant").await {
            self.log.apuntar("qdrant: no está en WSL, bajando su binario oficial".into());
            // ponytail: se resuelve la última publicación en vez de fijar una
            // versión. El techo es que una publicación rota de Qdrant rompe la
            // instalación y no hay suma de verificación que comparar; la
            // salida, fijar versión y hash aquí el día que el Indexer se
            // empaquete para distribuir en vez de para desarrollar.
            let mut cmd = Command::new("wsl");
            cmd.args([
                "-e", "sh", "-lc",
                "set -e; mkdir -p \"$HOME/.lumi-indexer/bin\"; \
                 v=$(curl -fsSL https://api.github.com/repos/qdrant/qdrant/releases/latest \
                     | sed -n 's/.*\"tag_name\": *\"v\\{0,1\\}\\([^\"]*\\)\".*/\\1/p' | head -1); \
                 test -n \"$v\"; \
                 echo \"qdrant: instalando v$v\"; \
                 curl -fsSL \"https://github.com/qdrant/qdrant/releases/download/v$v/qdrant-x86_64-unknown-linux-gnu.tar.gz\" \
                   | tar -xz -C \"$HOME/.lumi-indexer/bin\"; \
                 chmod +x \"$HOME/.lumi-indexer/bin/qdrant\"",
            ]);
            self.correr_hasta_el_final("instalar qdrant", cmd).await?;
        }
        Ok(())
    }

    /// ¿Existe este ejecutable dentro de WSL?
    async fn hay_en_wsl(que: &str) -> bool {
        Command::new("wsl")
            .args(["-e", "sh", "-lc", &format!("command -v {que} >/dev/null 2>&1 || test -x {que}")])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .await
            .is_ok_and(|s| s.success())
    }

    /// Un comando que TERMINA (instalar), no un servicio. Su salida va al log
    /// según llega, porque `apt-get` y `curl` tardan y un rectángulo mudo
    /// durante dos minutos se lee como colgado.
    async fn correr_hasta_el_final(&self, que: &str, mut cmd: Command) -> Result<()> {
        let mut hijo = cmd.stdout(Stdio::piped()).stderr(Stdio::piped()).kill_on_drop(true).spawn()?;
        for tuberia in [hijo.stdout.take().map(|s| Box::new(s) as Box<dyn tokio::io::AsyncRead + Unpin + Send>),
                        hijo.stderr.take().map(|s| Box::new(s) as Box<dyn tokio::io::AsyncRead + Unpin + Send>)]
            .into_iter()
            .flatten()
        {
            let log = self.log.clone();
            let que = que.to_string();
            tokio::spawn(async move {
                let mut l = BufReader::new(tuberia).lines();
                while let Ok(Some(x)) = l.next_line().await {
                    log.apuntar(format!("{que}: {x}"));
                }
            });
        }
        let salida = hijo.wait().await?;
        if !salida.success() {
            bail!("«{que}» terminó con {salida}; el detalle está en el log de arriba");
        }
        Ok(())
    }

    /// Apagar los dos. Es lo que evita que queden ocupando su puerto cuando el
    /// Indexer se cierra, y lo que el panel de ajustes ofrece a mano.
    ///
    /// Redis se apaga por su PROPIO protocolo: así funciona igual lo hayamos
    /// lanzado nosotros, lo hayamos adoptado, sea nativo o esté en WSL. Qdrant
    /// no tiene apagado por API, así que solo se le puede matar el proceso — y
    /// eso únicamente si es nuestro. Uno adoptado sigue vivo, y se dice.
    pub async fn parar(&self) -> Result<()> {
        if let Ok(c) = redis::Client::open(format!("redis://127.0.0.1:{REDIS_PUERTO}/")) {
            if let Ok(mut con) = c.get_multiplexed_async_connection().await {
                // SHUTDOWN no contesta: cierra la conexión. El error es la
                // respuesta esperada, por eso se descarta.
                let _: redis::RedisResult<()> =
                    redis::cmd("SHUTDOWN").arg("NOSAVE").query_async(&mut con).await;
                self.log.apuntar("redis: apagado".into());
            }
        }

        // El vector se vacía ANTES de esperar a nadie: mantener el cerrojo
        // abierto durante un `await` es la forma corta de colgar la aplicación.
        let mut hijos = std::mem::take(&mut *self.hijos.lock().unwrap());
        for (nombre, hijo) in hijos.iter_mut() {
            let _ = hijo.kill().await;
            self.log.apuntar(format!("{nombre}: parado"));
        }

        let (_, qdrant_vivo) = self.quien_vive().await;
        if qdrant_vivo {
            self.log.apuntar(
                "qdrant: sigue escuchando y no es un proceso nuestro, así que no podemos pararlo \
                 (Qdrant no tiene apagado por API). Hay que cerrarlo donde se arrancó."
                    .into(),
            );
        }
        Ok(())
    }

    /// Los dos sondeos en crudo, sin envolver en `EstadoServicio`. Va aparte de
    /// `estado` para que `arrancar` no dependa del ORDEN del vector que aquel
    /// devuelve: un día alguien añade un tercer servicio y `e[0]` deja de ser
    /// Redis sin que nada se queje.
    async fn quien_vive(&self) -> (bool, bool) {
        let e = self.estado().await;
        let vivo = |n: &str| e.iter().any(|s| s.nombre == n && s.vivo);
        (vivo("Redis"), vivo("Qdrant"))
    }

    /// Cuáles de los que corren son hijos nuestros. De paso quita del vector
    /// los que ya han muerto: sin esta poda, un Redis apagado con SHUTDOWN
    /// seguiría figurando como «propio» para siempre.
    fn propios(&self) -> Vec<&'static str> {
        let mut h = self.hijos.lock().unwrap();
        h.retain_mut(|(_, c)| matches!(c.try_wait(), Ok(None)));
        h.iter().map(|(n, _)| *n).collect()
    }

    pub async fn estado(&self) -> Vec<EstadoServicio> {
        let propios = self.propios();
        let es_propio = |n: &str| propios.iter().any(|p| p.eq_ignore_ascii_case(n));

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
                            propio: es_propio("redis"),
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
                propio: es_propio("qdrant"),
            },
            Ok(r) => no_vivo("Qdrant", format!("respondió {}", r.status())),
            Err(e) => no_vivo("Qdrant", e.to_string()),
        };

        vec![redis, qdrant]
    }

    /// Lo que hace falta para diagnosticar «no arranca» sin adivinar: qué
    /// sistema operativo ve el proceso, si encuentra los binarios nativos en
    /// el PATH, si `wsl.exe` responde en absoluto (Windows sin WSL instalado
    /// es un caso real y da un error de spawn distinto al de "no está
    /// arrancado"), y el estado en vivo de los dos servicios con su detalle
    /// crudo — el mismo que ya se ve en Ajustes, pero reunido en un sitio que
    /// no depende de haber llegado a entrar en la aplicación.
    pub async fn diagnostico(&self) -> Diagnostico {
        let wsl_responde = if cfg!(windows) {
            Some(
                Command::new("wsl")
                    .arg("--status")
                    .stdout(Stdio::null())
                    .stderr(Stdio::null())
                    .status()
                    .await
                    .is_ok_and(|s| s.success()),
            )
        } else {
            None
        };
        Diagnostico {
            so: std::env::consts::OS.into(),
            redis_en_path: buscar(&["redis-server"]).is_some(),
            qdrant_en_path: buscar(&["qdrant"]).is_some(),
            wsl_responde,
            redis_puerto: REDIS_PUERTO,
            qdrant_puerto: QDRANT_PUERTO,
            estado: self.estado().await,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct Diagnostico {
    pub so: String,
    pub redis_en_path: bool,
    pub qdrant_en_path: bool,
    /// `None` fuera de Windows: la pregunta no aplica.
    pub wsl_responde: Option<bool>,
    pub redis_puerto: u16,
    pub qdrant_puerto: u16,
    pub estado: Vec<EstadoServicio>,
}

fn no_vivo(nombre: &str, detalle: String) -> EstadoServicio {
    EstadoServicio { nombre: nombre.into(), vivo: false, detalle, propio: false }
}
