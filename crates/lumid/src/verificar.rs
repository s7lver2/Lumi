//! El puente con el trabajador de verificación geométrica.
//!
//! El trabajador solo cuenta inliers; quien decide es `lumi_index::arbitro`,
//! aquí en Rust, porque el arbitraje es lógica pura y está probado con
//! `cargo test`. Es la misma frontera que ya rige la recuperación: Python
//! mira píxeles, Rust decide y atribuye.

use std::path::Path;
use std::process::Stdio;

use anyhow::Result;
use lumi_index::agrupar::Candidato;
use lumi_index::arbitro::{arbitrar, Ganador, Veredicto};
use lumi_index::niveles::Nivel;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};

pub struct Afinado {
    pub candidato: Candidato,
    /// `None` significa que ningún verificador llegó al umbral: el candidato
    /// se cae.
    pub ganador: Option<Ganador>,
}

/// Manda consulta y candidatos al trabajador, recoge un veredicto por
/// (candidato, verificador) y arbitra cada candidato por separado.
///
/// `rutas` empareja cada candidato con el fichero de la foto de referencia en
/// disco, que es lo que el verificador necesita mirar.
///
/// `python`/`dispositivo`/`registro`/`pesos` son los mismos cuatro datos que
/// ya calcula `Cola::lanzar_uno` para el trabajador de recuperación — este
/// spawn vivía aparte y nunca los recibía: arrancaba con `python3` a secas
/// (el intérprete del sistema, sin `torch` instalado — el de verdad vive en
/// el venv) y sin `LUMI_DEVICE`/`LUMI_REGISTRO_VERIF`/`LUMI_PESOS`, así que
/// `lumi_verify.py` caía a "cpu" y a las rutas relativas "registros/
/// verificadores" y "pesos", que bajo systemd no resuelven a nada. El
/// resultado no era un error visible: `import torch` fallaba en la primera
/// línea de `_cargar`, el proceso moría en milisegundos sin imprimir un solo
/// `Verificado`, y como el `stderr` del hijo se pedía `piped()` pero nunca se
/// leía, esa traza se perdía entera. Cada análisis con verificación
/// geométrica devolvía "ningún candidato verificado" — no porque la foto no
/// coincidiera, sino porque el verificador nunca llegó a cargar nada.
pub async fn afinar(
    nivel: &Nivel,
    consulta: &str,
    candidatos: Vec<Candidato>,
    rutas: &[(i64, String)],
    python: &Path,
    dispositivo: &str,
    registro: &Path,
    pesos: &Path,
) -> Result<Vec<Afinado>> {
    let mut hijo = tokio::process::Command::new(python)
        .arg(crate::assets::ruta("workers/lumi_verify.py"))
        .env("LUMI_DEVICE", dispositivo)
        .env("LUMI_REGISTRO_VERIF", registro)
        .env("LUMI_PESOS", pesos)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;

    let lista: Vec<serde_json::Value> = candidatos
        .iter()
        .zip(rutas.iter())
        .map(|(c, (id, ruta))| {
            serde_json::json!({ "id": id, "ruta": ruta, "lat": c.lat, "lng": c.lng })
        })
        .collect();
    let orden = serde_json::json!({
        "tipo": "verificar",
        "id": 0,
        "consulta": consulta,
        "candidatos": lista,
        "verificadores": nivel.geometricos,
    });

    if let Some(mut stdin) = hijo.stdin.take() {
        stdin.write_all(format!("{orden}\n").as_bytes()).await?;
        stdin.shutdown().await?;
    }

    let mut errores = String::new();
    if let Some(mut stderr) = hijo.stderr.take() {
        let _ = stderr.read_to_string(&mut errores).await;
    }

    let mut por_candidato: std::collections::HashMap<i64, Vec<Veredicto>> = Default::default();
    if let Some(stdout) = hijo.stdout.take() {
        let mut lineas = BufReader::new(stdout).lines();
        while let Some(linea) = lineas.next_line().await? {
            let Ok(msg) = serde_json::from_str::<lumi_proto::worker::Msg>(&linea) else {
                continue;
            };
            if let lumi_proto::worker::Msg::Verificado {
                candidato, verificador, inliers, lat, lng, ..
            } = msg
            {
                por_candidato
                    .entry(candidato)
                    .or_default()
                    .push(Veredicto { verificador, inliers, lat, lng });
            }
        }
    }
    let salida = hijo.wait().await;
    // Nada de esto tira el análisis abajo (`afinar` sigue devolviendo `Ok`,
    // vacío, y quien llama ya sabe caer a "sin verificación geométrica") pero
    // sin este log ese fallback es indistinguible de un verificador que de
    // verdad miró la foto y no encontró nada — que es justo lo que pasaba.
    if por_candidato.is_empty() && !errores.trim().is_empty() {
        tracing::warn!("verificación geométrica: el trabajador no verificó nada: {}", errores.trim());
    } else if let Ok(estado) = &salida {
        if !estado.success() && !errores.trim().is_empty() {
            tracing::warn!("verificación geométrica: {}", errores.trim());
        }
    }
    tracing::info!(
        "verificación geométrica: {} candidatos, {} verificadores, {} veredictos, salida {:?}",
        candidatos.len(),
        nivel.geometricos.len(),
        por_candidato.values().map(|v| v.len()).sum::<usize>(),
        salida.as_ref().map(|s| s.code()),
    );

    Ok(candidatos
        .into_iter()
        .zip(rutas.iter())
        .map(|(candidato, (id, _))| {
            let ganador = por_candidato.get(id).and_then(|v| arbitrar(v));
            Afinado { candidato, ganador }
        })
        .collect())
}
