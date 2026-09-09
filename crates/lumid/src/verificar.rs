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
use lumi_index::arbitro::{arbitrar_con_umbrales, Ganador, Veredicto};
use lumi_index::niveles::Nivel;
use lumi_index::registro::Verificador;
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
    verificadores: &[Verificador],
    store: &crate::store::Store,
    persistente: &crate::persistente::Persistente,
) -> Result<Vec<Afinado>> {
    // Instrumentación (Hallazgo 0 del spec de rendimiento): antes de esto no
    // había un solo `Instant` en toda la verificación, y en el repo convivían
    // dos cifras contradictorias en dos órdenes de magnitud para el mismo
    // verificador ("27s por par" en `lumi_verify.py` vs "150-600ms" en el spec
    // del 5b) sin forma de zanjarlo salvo cronometrar a mano contra el reloj
    // del journal. Este `elapsed` es la medida directa.
    let inicio = std::time::Instant::now();
    // Ajuste `verificacion_persistente` (`routes::rendimiento`): por defecto
    // ("0" o ausente) el comportamiento es exactamente el de siempre, abajo.
    // Activado, se reutiliza un proceso ya vivo en vez de lanzar uno nuevo
    // por análisis — mismo protocolo de entrada/salida, solo cambia quién
    // lo lanza y cuándo muere.
    if store.get_meta("verificacion_persistente").as_deref() == Some("1") {
        return afinar_persistente(
            nivel, consulta, candidatos, rutas, python, dispositivo, registro, pesos, verificadores, persistente,
        )
        .await;
    }

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
    let max_inliers = por_candidato
        .values()
        .flatten()
        .map(|v| v.inliers)
        .max()
        .unwrap_or(0);
    tracing::info!(
        "verificación geométrica: {} candidatos, {} verificadores, {} veredictos, máximo {} inliers (umbral {}), salida {:?}, {:.1}s",
        candidatos.len(),
        nivel.geometricos.len(),
        por_candidato.values().map(|v| v.len()).sum::<usize>(),
        max_inliers,
        lumi_index::arbitro::UMBRAL_INLIERS,
        salida.as_ref().map(|s| s.code()),
        inicio.elapsed().as_secs_f64(),
    );

    Ok(construir_afinados(candidatos, rutas, &por_candidato, verificadores))
}

/// El mismo trámite de siempre (mandar la orden, recoger un veredicto por
/// candidato, arbitrar) pero contra un proceso ya vivo en vez de lanzar uno
/// nuevo — `crate::persistente::Persistente::pedir` se encarga de lanzarlo si
/// hace falta y de relanzarlo si murió a mitad de una petición anterior.
async fn afinar_persistente(
    nivel: &Nivel,
    consulta: &str,
    candidatos: Vec<Candidato>,
    rutas: &[(i64, String)],
    python: &Path,
    dispositivo: &str,
    registro: &Path,
    pesos: &Path,
    verificadores: &[Verificador],
    persistente: &crate::persistente::Persistente,
) -> Result<Vec<Afinado>> {
    let inicio = std::time::Instant::now();
    let script = crate::assets::ruta("workers/lumi_verify.py");
    let lista: Vec<serde_json::Value> = candidatos
        .iter()
        .zip(rutas.iter())
        .map(|(c, (id, ruta))| serde_json::json!({ "id": id, "ruta": ruta, "lat": c.lat, "lng": c.lng }))
        .collect();
    let orden = serde_json::json!({
        "tipo": "verificar",
        "id": 0,
        "consulta": consulta,
        "candidatos": lista,
        "verificadores": nivel.geometricos,
    });
    let envs: [(&str, &Path); 3] = [("LUMI_DEVICE", Path::new(dispositivo)), ("LUMI_REGISTRO_VERIF", registro), ("LUMI_PESOS", pesos)];

    let mut por_candidato: std::collections::HashMap<i64, Vec<Veredicto>> = Default::default();
    match persistente.pedir(&orden, python, &script, &envs).await {
        Ok(msgs) => {
            for msg in msgs {
                if let lumi_proto::worker::Msg::Verificado { candidato, verificador, inliers, lat, lng, .. } = msg {
                    por_candidato.entry(candidato).or_default().push(Veredicto { verificador, inliers, lat, lng });
                }
            }
        }
        // Mismo trato que el modo no persistente: un trabajador que no
        // contesta no tumba el análisis, solo se queda sin verificación
        // geométrica — y se registra, para que no sea indistinguible de un
        // verificador que de verdad miró la foto y no encontró nada.
        Err(e) => tracing::warn!("verificación geométrica persistente: {e}"),
    }

    let max_inliers = por_candidato.values().flatten().map(|v| v.inliers).max().unwrap_or(0);
    tracing::info!(
        "verificación geométrica (persistente): {} candidatos, {} verificadores, {} veredictos, máximo {} inliers (umbral {}), {:.1}s",
        candidatos.len(),
        nivel.geometricos.len(),
        por_candidato.values().map(|v| v.len()).sum::<usize>(),
        max_inliers,
        lumi_index::arbitro::UMBRAL_INLIERS,
        inicio.elapsed().as_secs_f64(),
    );

    Ok(construir_afinados(candidatos, rutas, &por_candidato, verificadores))
}

fn construir_afinados(
    candidatos: Vec<Candidato>,
    rutas: &[(i64, String)],
    por_candidato: &std::collections::HashMap<i64, Vec<Veredicto>>,
    verificadores: &[Verificador],
) -> Vec<Afinado> {
    // Una tabla, no una búsqueda lineal por candidato: `verificadores` es la
    // lista entera del registro (todos los niveles), no solo los de este
    // nivel, así que sin esto se recorrería de más en cada candidato.
    let umbrales: std::collections::HashMap<&str, u32> = verificadores
        .iter()
        .map(|v| (v.id.as_str(), v.umbral_inliers.unwrap_or(lumi_index::arbitro::UMBRAL_INLIERS)))
        .collect();
    let umbral_de = |id: &str| umbrales.get(id).copied().unwrap_or(lumi_index::arbitro::UMBRAL_INLIERS);
    candidatos
        .into_iter()
        .zip(rutas.iter())
        .map(|(candidato, (id, _))| {
            let ganador = por_candidato.get(id).and_then(|v| arbitrar_con_umbrales(v, &umbral_de));
            Afinado { candidato, ganador }
        })
        .collect()
}
