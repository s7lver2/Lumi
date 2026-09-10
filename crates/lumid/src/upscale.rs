//! El puente con `workers/lumi_upscale.py` (spec 2026-09-10 §2).
//!
//! Mismo criterio que `agentar.rs`: Python hace el trabajo pesado, aquí solo
//! se lanza el proceso y se lee su respuesta. A diferencia de `agentar`, este
//! trabajo SÍ debe poder fallar de verdad (`Err`, no "sin resultado, se
//! sigue"): un upscale que no llegó a producir nada no tiene un resultado de
//! respaldo que mostrar, así que el análisis termina en `error` con el
//! motivo real en vez de en `hecho` con una imagen que nadie mejoró.
//!
//! ponytail: sin modo persistente todavía (a diferencia de
//! `agentar::preguntar`/`verificar::afinar`) -- un proceso por trabajo, como
//! el resto del proyecto hacía antes de que el ajuste de rendimiento
//! existiera. Es la superficie mínima que cumple el criterio de hecho del
//! spec (un trabajo de cola real, con estado real); añadir el modo
//! persistente es la misma receta que ya existe en `persistente.rs` el día
//! que el upscaler se use lo bastante para que merezca la pena.

use std::path::Path;
use std::process::Stdio;
use std::time::Duration;

use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

/// Una imagen sola, con un modelo real cargando en frío si hace falta: más
/// margen que `agentar::LIMITE` porque aquí no hay ningún resultado parcial
/// que perder si se corta -- si se agota el tiempo, el trabajo entero falla.
pub const LIMITE: Duration = Duration::from_secs(180);

/// Pide al trabajador que escale `ruta_entrada` y escriba el resultado en
/// `ruta_salida`. `Ok(())` significa que `ruta_salida` ya existe y tiene el
/// resultado; cualquier `Err` es el motivo legible que va a `analyses.error`.
pub async fn procesar(
    ruta_entrada: &Path,
    ruta_salida: &Path,
    python: &Path,
    pesos: &Path,
    dispositivo: &str,
) -> anyhow::Result<()> {
    let tarea = correr(ruta_entrada, ruta_salida, python, pesos, dispositivo);
    match tokio::time::timeout(LIMITE, tarea).await {
        Ok(r) => r,
        Err(_) => anyhow::bail!("el upscaler tardó más de {}s", LIMITE.as_secs()),
    }
}

async fn correr(
    ruta_entrada: &Path, ruta_salida: &Path, python: &Path, pesos: &Path, dispositivo: &str,
) -> anyhow::Result<()> {
    let mut hijo = tokio::process::Command::new(python)
        .arg(crate::assets::ruta("workers/lumi_upscale.py"))
        .env("LUMI_PESOS", pesos)
        .env("LUMI_DEVICE", dispositivo)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()?;

    let orden = serde_json::json!({
        "tipo": "upscale",
        "id": 0,
        "ruta_entrada": ruta_entrada.display().to_string(),
        "ruta_salida": ruta_salida.display().to_string(),
    });
    if let Some(mut stdin) = hijo.stdin.take() {
        stdin.write_all(format!("{orden}\n").as_bytes()).await?;
        stdin.shutdown().await?;
    }

    let stderr_task = hijo.stderr.take().map(|stderr| {
        tokio::spawn(async move {
            let mut lineas = BufReader::new(stderr).lines();
            while let Ok(Some(linea)) = lineas.next_line().await {
                tracing::warn!(target: "lumid::upscale", "lumi_upscale.py: {linea}");
            }
        })
    });

    let mut resultado: Option<anyhow::Result<()>> = None;
    if let Some(stdout) = hijo.stdout.take() {
        let mut lineas = BufReader::new(stdout).lines();
        while let Some(linea) = lineas.next_line().await? {
            let Ok(msg) = serde_json::from_str::<lumi_proto::worker::Msg>(&linea) else { continue };
            match msg {
                lumi_proto::worker::Msg::Upscale { .. } => resultado = Some(Ok(())),
                lumi_proto::worker::Msg::Fallo { motivo, .. } => resultado = Some(Err(anyhow::anyhow!(motivo))),
                _ => {}
            }
        }
    }
    let _ = hijo.wait().await;
    if let Some(t) = stderr_task {
        let _ = t.await;
    }
    resultado.unwrap_or_else(|| anyhow::bail!("el upscaler no contestó"))
}
