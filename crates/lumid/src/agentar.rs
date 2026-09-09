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

use std::path::Path;
use std::process::Stdio;
use std::time::Duration;

use lumi_index::agentes::Veredicto;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

/// Doce agentes sobre un VLM en CPU pueden tardar; más de esto y el
/// investigador está esperando por algo que es un accesorio del resultado, no
/// el resultado. Se usa cuando los agentes son un extra sobre un análisis
/// `pro` que ya encontró candidatos por su cuenta -- perder los agentes aquí
/// no pierde el resultado principal.
pub const LIMITE: Duration = Duration::from_secs(120);

/// El modo Agentes standalone (`queue::correr_agente_unico`) no tiene ningún
/// resultado de respaldo: el agente ES la respuesta entera. Cargar el motor
/// VLM en frío ya se come casi todo `LIMITE` por sí solo, así que aquí hace
/// falta más margen -- el doble, suficiente para una carga en frío sin ser
/// una espera eterna.
pub const LIMITE_STANDALONE: Duration = Duration::from_secs(240);

/// Un veredicto por agente, con su detalle. Vacío significa «no hubo agentes»,
/// que es un estado legítimo y no un fallo.
///
/// `python`/`pesos` son los mismos que recibe `verificar::afinar` para la
/// misma llamada — antes esto lanzaba un `python3` del sistema a secas, sin
/// `LUMI_PESOS` ni `LUMI_REGISTRO_AGENTES`: nunca era el intérprete del venv
/// (sin torch/transformers/paddleocr instalados) y `lumi_agentes.py` caía a
/// las rutas relativas por defecto, que bajo systemd no resuelven a nada.
/// Los agentes podían tener sus motores descargados y perfectamente
/// instalados y aun así no correr nunca, sin ningún error visible más allá
/// del log — el mismo síntoma exacto que el de `queue::lanzar_uno` antes de
/// unificar en `assets::pesos_dir`, solo que en un tercer sitio que ese
/// arreglo no tocaba.
pub async fn preguntar(
    agentes: &[String],
    consulta: &str,
    python: &Path,
    pesos: &Path,
    dispositivo: &str,
    store: &crate::store::Store,
    persistente: &crate::persistente::Persistente,
    limite: Duration,
) -> Vec<(Veredicto, String)> {
    if agentes.is_empty() || consulta.is_empty() {
        return Vec::new();
    }
    // Instrumentación (Hallazgo 0 del spec de rendimiento): antes de esto
    // `agentar` no registraba tiempo alguno, y era imposible distinguir "los
    // agentes tardan porque cargan sus motores en frío" de "los agentes
    // tardan porque el VLM es lento" sin cronometrar a mano. `agentar::LIMITE`
    // corta a los 120s; este `elapsed` dice cuánto se tardó de verdad,
    // llegue o no a ese corte.
    let inicio = std::time::Instant::now();
    // Ajuste `agentes_persistente` (`routes::rendimiento`): por defecto
    // ("0" o ausente) sigue lanzando un proceso por análisis, como siempre.
    let persistente_activo = store.get_meta("agentes_persistente").as_deref() == Some("1");
    // `if`/`else` con dos `async fn` da dos tipos `impl Future` distintos
    // aunque devuelvan lo mismo — de ahí el `Box::pin` en vez de un `if`
    // directo sobre las llamadas.
    let tarea: std::pin::Pin<Box<dyn std::future::Future<Output = anyhow::Result<Vec<(Veredicto, String)>>> + Send>> =
        if persistente_activo {
            Box::pin(correr_persistente(agentes, consulta, python, pesos, dispositivo, persistente))
        } else {
            Box::pin(correr(agentes, consulta, python, pesos, dispositivo))
        };
    let resultado = match tokio::time::timeout(limite, tarea).await {
        Ok(Ok(v)) => v,
        Ok(Err(e)) => {
            tracing::warn!("los agentes no contestaron: {e}");
            Vec::new()
        }
        Err(_) => {
            tracing::warn!("los agentes tardaron más de {}s; se sigue sin ellos", limite.as_secs());
            Vec::new()
        }
    };
    tracing::info!(
        "agentes: {} pedidos, {} veredictos, persistente={}, {:.1}s",
        agentes.len(),
        resultado.len(),
        persistente_activo,
        inicio.elapsed().as_secs_f64(),
    );
    resultado
}

/// Igual que `correr`, pero reutilizando un proceso ya vivo en vez de lanzar
/// uno nuevo — `Persistente::pedir` lo lanza la primera vez que hace falta y
/// lo relanza solo si murió a mitad de una petición anterior.
async fn correr_persistente(
    agentes: &[String], consulta: &str, python: &Path, pesos: &Path, dispositivo: &str,
    persistente: &crate::persistente::Persistente,
) -> anyhow::Result<Vec<(Veredicto, String)>> {
    let script = crate::assets::ruta("workers/lumi_agentes.py");
    let registro = crate::assets::ruta("registros/agentes");
    let orden = serde_json::json!({
        "tipo": "agentes",
        "id": 0,
        "consulta": consulta,
        "agentes": agentes,
    });
    let envs: [(&str, &Path); 3] =
        [("LUMI_REGISTRO_AGENTES", &registro), ("LUMI_PESOS", pesos), ("LUMI_DEVICE", Path::new(dispositivo))];
    let msgs = persistente.pedir(&orden, python, &script, &envs).await?;
    Ok(msgs
        .into_iter()
        .filter_map(|msg| {
            if let lumi_proto::worker::Msg::Agente {
                agente, etiqueta, confianza, detalle, alternativas, rasgos, ..
            } = msg
            {
                Some((Veredicto { agente, etiqueta, confianza, alternativas, rasgos }, detalle))
            } else {
                None
            }
        })
        .collect())
}

async fn correr(
    agentes: &[String], consulta: &str, python: &Path, pesos: &Path, dispositivo: &str,
) -> anyhow::Result<Vec<(Veredicto, String)>> {
    let mut hijo = tokio::process::Command::new(python)
        .arg(crate::assets::ruta("workers/lumi_agentes.py"))
        .env("LUMI_REGISTRO_AGENTES", crate::assets::ruta("registros/agentes"))
        .env("LUMI_PESOS", pesos)
        // Antes ausente: `lumi_agentes.py` decidía su dispositivo por su
        // cuenta (`dispositivo()`, siempre "cuda" si hay alguna GPU) sin
        // saber en cuál de varias corría este análisis -- en una caja
        // multi-GPU, un análisis en "cuda:1" mandaba sus agentes a "cuda:0",
        // que podía estar ya ocupada con otro análisis. La verificación
        // geométrica ya recibía esto (`verificar.rs`); los agentes no.
        .env("LUMI_DEVICE", dispositivo)
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

    // Sin drenar esto, un motor que no carga (falta LICENCIA.txt, falta una
    // dependencia del venv...) se traga su propio motivo: `lumi_agentes.py`
    // lo escribe a stderr y aquí se descartaba sin que nadie lo leyera nunca
    // -- "0 agentes" sin una sola pista de por qué. Tarea aparte para que no
    // compita con el bucle de stdout por el mismo await.
    let stderr_task = hijo.stderr.take().map(|stderr| {
        tokio::spawn(async move {
            let mut lineas = BufReader::new(stderr).lines();
            while let Ok(Some(linea)) = lineas.next_line().await {
                tracing::warn!(target: "lumid::agentar", "lumi_agentes.py: {linea}");
            }
        })
    });

    let mut fuera = Vec::new();
    if let Some(stdout) = hijo.stdout.take() {
        let mut lineas = BufReader::new(stdout).lines();
        while let Some(linea) = lineas.next_line().await? {
            let Ok(msg) = serde_json::from_str::<lumi_proto::worker::Msg>(&linea) else {
                continue;
            };
            if let lumi_proto::worker::Msg::Agente {
                agente, etiqueta, confianza, detalle, alternativas, rasgos, ..
            } = msg
            {
                fuera.push((Veredicto { agente, etiqueta, confianza, alternativas, rasgos }, detalle));
            }
        }
    }
    let _ = hijo.wait().await;
    if let Some(t) = stderr_task {
        let _ = t.await;
    }
    Ok(fuera)
}
