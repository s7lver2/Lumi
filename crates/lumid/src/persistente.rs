//! Un proceso Python opcionalmente persistente, para verificación geométrica
//! y agentes.
//!
//! Mismo espíritu que `queue::worker::Lanzado` (un canal de trabajos, una
//! tarea de Tokio que vive con el hijo, lee su `stdout` línea a línea) pero
//! NO el mismo tipo: `queue::worker` está atado al protocolo de embebido
//! (`Job` de entrada, `Msg::Vectores`/`Msg::Resultado` de salida) y aquí la
//! orden es un `serde_json::Value` libre (verificación manda "verificar" con
//! candidatos; agentes manda "agentes" con una lista de ids) y la salida es
//! `Msg::Verificado`/`Msg::Agente`.
//!
//! ponytail: en vez de un multiplexor por id de trabajo (como si hiciera
//! falta atender varias peticiones a la vez), `pedir` mantiene el `Mutex`
//! asíncrono agarrado durante TODA la petición — una sola en vuelo contra
//! este proceso en cada instante, exactamente como ya se comporta hoy el
//! modo no persistente (una orden, se espera su respuesta entera, recién
//! entonces se lanza la siguiente). Eso evita tener que correlacionar
//! mensajes por id: todo lo que llega antes del `Msg::Fin` de esta petición
//! es suyo, sin ambigüedad. El día que esto necesite paralelismo real, la
//! salida más simple es un proceso persistente por dispositivo, como ya hace
//! `queue::worker` — no un multiplexor aquí.

use std::path::Path;
use std::process::Stdio;

use anyhow::{anyhow, Context, Result};
use lumi_proto::worker::Msg;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, Lines};
use tokio::process::{ChildStderr, ChildStdin, ChildStdout};
use tokio::sync::Mutex;

struct Proceso {
    hijo: tokio::process::Child,
    entrada: ChildStdin,
    lineas: Lines<BufReader<ChildStdout>>,
}

fn drenar_stderr(nombre: &'static str, stderr: ChildStderr) {
    // El log del hijo no tiene contrato: se registra tal cual, igual que
    // hace `agentar::correr` hoy con su tarea de stderr aparte para no
    // competir por el mismo `await` que el bucle de stdout.
    tokio::spawn(async move {
        let mut lineas = BufReader::new(stderr).lines();
        while let Ok(Some(linea)) = lineas.next_line().await {
            tracing::warn!(target: "lumid::persistente", "{nombre}: {linea}");
        }
    });
}

/// Un proceso persistente perezoso: no arranca nada hasta el primer `pedir`.
///
/// `python`/`script`/`envs` NO se fijan en la construcción: se reciben en
/// cada `pedir` y solo se usan si de verdad hace falta lanzar (o relanzar) el
/// proceso. ponytail: eso significa que si `pesos`/`registro`/el intérprete
/// cambian (p. ej. se reinstala el runtime desde el panel de Modelos) un
/// proceso persistente ya vivo NO se entera hasta que muere y se relanza —
/// mismo trato que ya recibe un cambio en caliente del ajuste
/// activar/desactivar (ver `routes::rendimiento::patch`): surte efecto en el
/// próximo arranque del proceso, no al instante. Reiniciar `lumid` siempre
/// lo fuerza.
pub struct Persistente {
    nombre: &'static str,
    dentro: Mutex<Option<Proceso>>,
}

impl Persistente {
    pub fn nuevo(nombre: &'static str) -> Self {
        Self { nombre, dentro: Mutex::new(None) }
    }

    fn lanzar(&self, python: &Path, script: &Path, envs: &[(&str, &Path)]) -> Result<Proceso> {
        let mut cmd = tokio::process::Command::new(python);
        cmd.arg("-u").arg(script).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
        // Muere con el daemon, igual que el resto de los trabajadores: un
        // reinicio no debe dejar VRAM ocupada por un proceso huérfano.
        cmd.kill_on_drop(true);
        for &(k, v) in envs {
            cmd.env(k, v);
        }
        let mut hijo = cmd.spawn().with_context(|| format!("lanzando {} persistente", self.nombre))?;
        let entrada = hijo.stdin.take().expect("stdin se pidió como piped");
        let salida = hijo.stdout.take().expect("stdout se pidió como piped");
        drenar_stderr(self.nombre, hijo.stderr.take().expect("stderr se pidió como piped"));
        tracing::info!("{} persistente lanzado (pid {:?})", self.nombre, hijo.id());
        Ok(Proceso { hijo, entrada, lineas: BufReader::new(salida).lines() })
    }

    /// Manda una orden y devuelve todos sus mensajes hasta (sin incluir) el
    /// `Msg::Fin` que la cierra. Si el proceso está muerto o no existe
    /// todavía, lo lanza con `python`/`script`/`envs`; si muere A MITAD de la
    /// petición, se relanza UNA vez y se reintenta desde cero — cubre el caso
    /// de un crash entre peticiones sin dejar las siguientes estrelladas
    /// contra un proceso fantasma.
    pub async fn pedir(
        &self, orden: &serde_json::Value, python: &Path, script: &Path, envs: &[(&str, &Path)],
    ) -> Result<Vec<Msg>> {
        let mut guard = self.dentro.lock().await;
        for intento in 0..2 {
            if guard.is_none() {
                *guard = Some(self.lanzar(python, script, envs)?);
            } else if let Some(p) = guard.as_mut() {
                // `try_wait` no bloquea: si ya ha terminado (crash, señal),
                // se descarta y se relanza en vez de escribirle a un
                // proceso muerto.
                if matches!(p.hijo.try_wait(), Ok(Some(_))) {
                    tracing::warn!("{} persistente ya no estaba vivo; se relanza", self.nombre);
                    *guard = Some(self.lanzar(python, script, envs)?);
                }
            }
            match Self::una_peticion(self.nombre, guard.as_mut().expect("recién asegurado"), orden).await {
                Ok(msgs) => return Ok(msgs),
                Err(e) if intento == 0 => {
                    tracing::warn!("{} persistente falló a mitad de petición, se relanza: {e}", self.nombre);
                    *guard = None;
                }
                Err(e) => return Err(e),
            }
        }
        unreachable!("el bucle siempre devuelve en el segundo intento")
    }

    async fn una_peticion(nombre: &str, proceso: &mut Proceso, orden: &serde_json::Value) -> Result<Vec<Msg>> {
        let linea = format!("{orden}\n");
        proceso.entrada.write_all(linea.as_bytes()).await.context("escribiendo la orden")?;
        proceso.entrada.flush().await.context("vaciando la orden")?;

        let mut fuera = Vec::new();
        loop {
            let linea = proceso
                .lineas
                .next_line()
                .await
                .context("leyendo al proceso persistente")?
                .ok_or_else(|| anyhow!("el proceso persistente cerró stdout (murió) a mitad de la petición"))?;
            match serde_json::from_str::<Msg>(&linea) {
                Ok(Msg::Fin { .. }) => return Ok(fuera),
                // `Listo` puede llegar en cualquier momento (al arrancar, o
                // cuando se carga perezosamente un verificador/motor nuevo a
                // mitad de una orden): se registra y se sigue esperando el
                // resto de esta misma petición.
                Ok(Msg::Listo { modelo, .. }) => {
                    tracing::info!("{nombre} persistente listo (modelo {modelo:?})")
                }
                Ok(m) => fuera.push(m),
                Err(e) => {
                    let corta: String = linea.chars().take(120).collect();
                    tracing::warn!("línea ilegible del proceso persistente ({e}): {corta}");
                }
            }
        }
    }
}
