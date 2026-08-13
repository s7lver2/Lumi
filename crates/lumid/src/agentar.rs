//! El puente con el trabajador de agentes.
//!
//! Misma frontera que la verificación geométrica del 5b: Python mira píxeles,
//! Rust decide. Aquí solo se recogen etiquetas; quién baja y por qué lo dice
//! `lumi_index::agentes::aplicar`, que es lógica pura y está probada.
//!
//! **Nunca devuelve `Err`.** Que los agentes no lleguen no es una avería del
//! análisis: el motor del 5b ya contesta sin ellos. Un proceso que no arranca,
//! que muere o que se pasa de tiempo se traduce en «sin agentes», y el cliente
//! lo dice.

use std::process::Stdio;
use std::time::Duration;

use lumi_index::agentes::Veredicto;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

/// Doce agentes sobre un VLM en CPU pueden tardar; más de esto y el
/// investigador está esperando por algo que es un accesorio del resultado, no
/// el resultado.
pub const LIMITE: Duration = Duration::from_secs(120);

/// Un veredicto por agente, con su detalle. Vacío significa «no hubo agentes»,
/// que es un estado legítimo y no un fallo.
pub async fn preguntar(agentes: &[String], consulta: &str) -> Vec<(Veredicto, String)> {
    if agentes.is_empty() || consulta.is_empty() {
        return Vec::new();
    }
    match tokio::time::timeout(LIMITE, correr(agentes, consulta)).await {
        Ok(Ok(v)) => v,
        Ok(Err(e)) => {
            tracing::warn!("los agentes no contestaron: {e}");
            Vec::new()
        }
        Err(_) => {
            tracing::warn!("los agentes tardaron más de {}s; se sigue sin ellos", LIMITE.as_secs());
            Vec::new()
        }
    }
}

async fn correr(agentes: &[String], consulta: &str) -> anyhow::Result<Vec<(Veredicto, String)>> {
    let mut hijo = tokio::process::Command::new("python3")
        .arg("workers/lumi_agentes.py")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true) // el timeout suelta el futuro: sin esto quedaría un python huérfano
        .spawn()?;

    let orden = serde_json::json!({
        "tipo": "agentes",
        "id": 0,
        "consulta": consulta,
        "agentes": agentes,
    });
    if let Some(mut stdin) = hijo.stdin.take() {
        stdin.write_all(format!("{orden}\n").as_bytes()).await?;
        stdin.shutdown().await?;
    }

    let mut fuera = Vec::new();
    if let Some(stdout) = hijo.stdout.take() {
        let mut lineas = BufReader::new(stdout).lines();
        while let Some(linea) = lineas.next_line().await? {
            let Ok(msg) = serde_json::from_str::<lumi_proto::worker::Msg>(&linea) else {
                continue;
            };
            if let lumi_proto::worker::Msg::Agente { agente, etiqueta, confianza, detalle, .. } = msg
            {
                fuera.push((Veredicto { agente, etiqueta, confianza }, detalle));
            }
        }
    }
    let _ = hijo.wait().await;
    Ok(fuera)
}
