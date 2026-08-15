//! El puente con el trabajador de verificación geométrica.
//!
//! El trabajador solo cuenta inliers; quien decide es `lumi_index::arbitro`,
//! aquí en Rust, porque el arbitraje es lógica pura y está probado con
//! `cargo test`. Es la misma frontera que ya rige la recuperación: Python
//! mira píxeles, Rust decide y atribuye.

use std::process::Stdio;

use anyhow::Result;
use lumi_index::agrupar::Candidato;
use lumi_index::arbitro::{arbitrar, Ganador, Veredicto};
use lumi_index::niveles::Nivel;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

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
pub async fn afinar(
    nivel: &Nivel,
    consulta: &str,
    candidatos: Vec<Candidato>,
    rutas: &[(i64, String)],
) -> Result<Vec<Afinado>> {
    let mut hijo = tokio::process::Command::new("python3")
        .arg(crate::assets::ruta("workers/lumi_verify.py"))
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
    let _ = hijo.wait().await;

    Ok(candidatos
        .into_iter()
        .zip(rutas.iter())
        .map(|(candidato, (id, _))| {
            let ganador = por_candidato.get(id).and_then(|v| arbitrar(v));
            Afinado { candidato, ganador }
        })
        .collect())
}
