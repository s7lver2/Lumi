//! Salud del servidor: detección de problemas y arreglo de un clic donde es
//! seguro (ver `docs/superpowers/specs/2026-08-21-doctor-design.md`).

use crate::routes::auth::{bearer, require_admin};
use crate::App;
use axum::extract::{Path, Query, State};
use axum::{http::StatusCode, Json};
use lumi_proto::api::{MuestraHistorial, Problema, SaludView};
use std::time::Duration;

const UMBRAL_COLGADO: Duration = Duration::from_secs(10 * 60);
const DISCO_MIN_MB: u64 = 5000;
const GPU_TEMP_MAX_C: u32 = 85;

pub async fn salud(
    State(app): State<App>, headers: axum::http::HeaderMap,
) -> Result<Json<SaludView>, StatusCode> {
    require_admin(&app, &bearer(&headers))?;
    Ok(Json(SaludView { problemas: detectar(&app).await }))
}

/// El numerito de la barra lateral (`Resumen::problemas_doctor`) reutiliza
/// esto en vez de duplicar las cinco comprobaciones — un solo sitio que
/// decide qué es un problema, tanto si lo pide la pestaña Doctor como si lo
/// pide el resumen general.
pub async fn detectar(app: &App) -> Vec<Problema> {
    let mut problemas = Vec::new();

    for (dispositivo, analysis_id) in app.queue.colgados(UMBRAL_COLGADO) {
        problemas.push(Problema {
            id: format!("trabajador:{dispositivo}"),
            titulo: format!("El trabajador de \"{dispositivo}\" lleva más de 10 min sin avanzar en el análisis {analysis_id}"),
            detalle: "No manda progreso desde hace rato — puede seguir cargando un modelo grande, o haberse colgado.".into(),
            accion: Some("Reiniciar este trabajador".into()),
            enlace: None,
        });
    }

    // ponytail: reutiliza el ping ya existente en `qdrant::Cliente::vivo`
    // (usado hoy por `/v1/hello`) en vez de añadir un segundo helper con el
    // mismo timeout corto — el plan original proponía una función libre
    // nueva, pero ya había una equivalente.
    if !crate::qdrant::Cliente::nuevo().vivo().await {
        problemas.push(Problema {
            id: "qdrant".into(),
            titulo: "Qdrant no responde".into(),
            detalle: "La búsqueda por índices está caída — el resto del daemon sigue funcionando con normalidad.".into(),
            accion: Some("Reiniciar Qdrant".into()),
            enlace: None,
        });
    }

    let app2 = app.clone();
    if let Ok(s) = tokio::task::spawn_blocking(move || crate::telemetry::sample(&app2, None)).await {
        if s.disk_free_mb < DISCO_MIN_MB {
            problemas.push(Problema {
                id: "disco".into(),
                titulo: "El disco está casi lleno".into(),
                detalle: format!("Quedan {} MB libres.", s.disk_free_mb),
                accion: None,
                enlace: Some("hardware".into()),
            });
        }
        for g in &s.gpus {
            if g.temp_c.unwrap_or(0) > GPU_TEMP_MAX_C {
                problemas.push(Problema {
                    id: format!("gpu:{}", g.index),
                    titulo: format!("La GPU {} está cerca de su límite térmico", g.index),
                    detalle: format!("{}°C — considera bajar potencia o revisar refrigeración.", g.temp_c.unwrap_or(0)),
                    accion: None,
                    enlace: Some("hardware".into()),
                });
            }
        }
    }

    if reinicios_recientes(app).await >= 2 {
        problemas.push(Problema {
            id: "reinicios".into(),
            titulo: "El daemon se ha reiniciado más de una vez en la última hora".into(),
            detalle: "Puede ser un crash, o un reinicio manual — el log de ese momento tiene el motivo.".into(),
            accion: None,
            enlace: Some("doctor:logs".into()),
        });
    }

    problemas
}

/// Cuenta cuántas veces aparece la línea de arranque de `lumid` en la última
/// hora de `journalctl` — cada arranque limpio deja exactamente una, así que
/// dos o más significa que hubo al menos un reinicio de por medio. Si
/// `journalctl` no está disponible (dev en Windows, o sin systemd), esta
/// comprobación se omite en silencio: no es un problema del servidor, es que
/// no se puede saber.
async fn reinicios_recientes(_app: &App) -> u32 {
    let salida = tokio::process::Command::new("journalctl")
        .args(["-u", "lumid", "--since", "-1hour", "-o", "cat"])
        .output()
        .await;
    match salida {
        Ok(o) => String::from_utf8_lossy(&o.stdout)
            .lines()
            .filter(|l| l.contains("lumid escuchando en"))
            .count() as u32,
        Err(_) => 0,
    }
}

pub async fn arreglar_trabajador(
    State(app): State<App>, headers: axum::http::HeaderMap, Path(dispositivo): Path<String>,
) -> Result<StatusCode, StatusCode> {
    let admin = require_admin(&app, &bearer(&headers))?;
    if app.queue.forzar_reinicio(&dispositivo) {
        tracing::info!("trabajador de \"{dispositivo}\" reiniciado desde Doctor por el administrador {admin}");
        Ok(StatusCode::NO_CONTENT)
    } else {
        Err(StatusCode::NOT_FOUND)
    }
}

pub async fn arreglar_qdrant(
    State(app): State<App>, headers: axum::http::HeaderMap,
) -> Result<StatusCode, (StatusCode, String)> {
    let admin = require_admin(&app, &bearer(&headers)).map_err(|c| (c, "hace falta ser administrador".to_string()))?;
    let salida = tokio::process::Command::new("systemctl")
        .args(["restart", "qdrant"])
        .output()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    if salida.status.success() {
        tracing::info!("Qdrant reiniciado desde Doctor por el administrador {admin}");
        Ok(StatusCode::NO_CONTENT)
    } else {
        tracing::error!("no se pudo reiniciar Qdrant desde Doctor: {}", String::from_utf8_lossy(&salida.stderr));
        Err((StatusCode::INTERNAL_SERVER_ERROR, String::from_utf8_lossy(&salida.stderr).to_string()))
    }
}

#[derive(serde::Deserialize)]
pub struct RangoQuery {
    pub rango: Option<String>,
}

pub async fn historial(
    State(app): State<App>, headers: axum::http::HeaderMap, Query(q): Query<RangoQuery>,
) -> Result<Json<Vec<MuestraHistorial>>, StatusCode> {
    require_admin(&app, &bearer(&headers))?;
    let rango = q.rango.as_deref().unwrap_or("24h").to_string();
    let app2 = app.clone();
    let filas = tokio::task::spawn_blocking(move || crate::telemetry::historial(&app2, &rango))
        .await
        .unwrap_or_default();
    Ok(Json(filas))
}
