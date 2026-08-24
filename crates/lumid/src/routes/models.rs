//! Rutas de gestión de modelos: aceptar licencias, lanzar descargas,
//! descubrir la tarea activa. La lectura de qué falta por nivel vive en la
//! Tarea 5 (`estado`), no aquí — aceptar y descargar son escritura.

use crate::routes::auth::{bearer, require_admin};
use crate::App;
use axum::extract::State;
use axum::{http::HeaderMap, http::StatusCode, Json};
use lumi_proto::api::AcceptLicensesReq;
use lumi_proto::api::ItemDescarga;

fn now() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs() as i64
}

pub async fn accept_licenses(
    State(app): State<App>,
    headers: HeaderMap,
    Json(req): Json<AcceptLicensesReq>,
) -> Result<StatusCode, StatusCode> {
    let quien = require_admin(&app, &bearer(&headers))?;
    let t = now();
    let conn = app.store.conn();
    for (licencia, para) in &req.licencias {
        let junto = para.join(",");
        conn.execute(
            "INSERT OR REPLACE INTO model_licenses (licencia, para, aceptada_por, aceptada_en)
             VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params![licencia, junto, quien, t],
        )
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        tracing::info!("licencia '{licencia}' aceptada por el administrador {quien} para {junto}");
    }
    Ok(StatusCode::NO_CONTENT)
}

/// `para` son los ids de lo que una tarea de descarga va a bajar. Se niega a
/// lanzar si falta alguno: es la comprobación que hace cumplirse la §5 de la
/// spec en el servidor, no solo en el gesto de la interfaz.
pub fn licencias_aceptadas(app: &App, para: &[String]) -> bool {
    let conn = app.store.conn();
    let Ok(mut stmt) = conn.prepare("SELECT para FROM model_licenses") else { return false };
    let Ok(filas) = stmt.query_map([], |r| r.get::<_, String>(0)) else { return false };
    let cubiertos: std::collections::HashSet<String> = filas
        .flatten()
        .flat_map(|p| p.split(',').map(str::to_string).collect::<Vec<_>>())
        .collect();
    para.iter().all(|id| cubiertos.contains(id))
}

fn resolver_items(app: &App, ids: &[String]) -> Vec<ItemDescarga> {
    let modelos = app.queue.modelos.lock().unwrap().clone();
    let verificadores = app.queue.verificadores.lock().unwrap().clone();
    let motores = app.queue.motores.lock().unwrap().clone();
    let recursos_geo = app.queue.recursos_geo.lock().unwrap().clone();
    let models_dir = app.store.get_meta("models_dir").unwrap_or_else(|| "runtime/pesos".to_string());

    let mut fuera = Vec::new();
    for id in ids {
        if let Some(m) = modelos.iter().find(|m| &m.id == id) {
            fuera.push(ItemDescarga {
                id: m.id.clone(), fichero_url: m.fichero_url.clone(),
                destino: format!("{models_dir}/{}/pesos.pth", m.id),
                licencia_texto: m.licencia_texto.clone(), sha256: m.sha256.clone(),
                gestion_propia: false,
            });
        } else if let Some(v) = verificadores.iter().find(|v| &v.id == id) {
            fuera.push(ItemDescarga {
                id: v.id.clone(), fichero_url: v.fichero_url.clone(),
                destino: format!("{models_dir}/{}/pesos.pth", v.id),
                licencia_texto: v.licencia_texto.clone(), sha256: v.sha256.clone(),
                gestion_propia: false,
            });
        } else if let Some(mo) = motores.iter().find(|mo| &mo.id == id) {
            fuera.push(ItemDescarga {
                id: mo.id.clone(), fichero_url: mo.fichero_url.clone(),
                destino: format!("{models_dir}/{}/model.safetensors", mo.id),
                licencia_texto: mo.licencia_texto.clone(), sha256: String::new(),
                gestion_propia: mo.gestion_propia,
            });
        } else if let Some(g) = recursos_geo.iter().find(|g| &g.id == id) {
            let nombre = if g.id == "paises" { "paises.json" } else { "koppen.bin" };
            fuera.push(ItemDescarga {
                id: g.id.clone(), fichero_url: g.fichero_url.clone(),
                destino: crate::assets::ruta("registros/geo").join(nombre).to_string_lossy().into_owned(),
                licencia_texto: g.licencia_texto.clone(), sha256: String::new(),
                gestion_propia: false,
            });
        }
    }
    fuera
}

#[derive(serde::Deserialize)]
pub struct DownloadReq {
    pub items: Vec<String>,
}

pub async fn download(
    State(app): State<App>,
    headers: HeaderMap,
    Json(req): Json<DownloadReq>,
) -> Result<Json<lumi_proto::api::TaskStatus>, (StatusCode, String)> {
    let admin = require_admin(&app, &bearer(&headers))
        .map_err(|c| (c, "hace falta ser administrador".to_string()))?;

    if !licencias_aceptadas(&app, &req.items) {
        return Err((StatusCode::BAD_REQUEST, "faltan licencias por aceptar para lo que se pidió".to_string()));
    }

    let items = resolver_items(&app, &req.items);
    if items.iter().any(|i| i.fichero_url.is_empty() && !i.gestion_propia) {
        return Err((StatusCode::BAD_REQUEST, "alguno de estos pesos no tiene URL de descarga: modo guía, no se puede pedir aquí".to_string()));
    }

    let id = crate::tasks::spawn_model_download(&app, items)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    tracing::info!("descarga de modelos pedida por el administrador {admin}: {:?}", req.items);

    // Clonar app e id para el sondeo en segundo plano
    let app2 = app.clone();
    let id2 = id.clone();
    tokio::spawn(async move {
        loop {
            tokio::time::sleep(std::time::Duration::from_secs(2)).await;
            match crate::tasks::status(&app2, &id2) {
                Some(s) if !s.running => {
                    app2.queue.recargar();
                    break;
                }
                Some(_) => continue,
                None => break,
            }
        }
    });

    crate::tasks::status(&app, &id)
        .map(Json)
        .ok_or((StatusCode::INTERNAL_SERVER_ERROR, "no se pudo leer el estado recién creado".to_string()))
}

pub async fn model_task(
    State(app): State<App>,
    headers: HeaderMap,
) -> Result<Json<Option<lumi_proto::api::TareaModelo>>, StatusCode> {
    require_admin(&app, &bearer(&headers))?;
    let Some(id) = app.store.get_meta("model_task_id") else { return Ok(Json(None)) };
    let Some(status) = crate::tasks::status(&app, &id) else { return Ok(Json(None)) };
    if !status.running {
        return Ok(Json(None));
    }
    // Última línea @progreso del log, para el ítem y el porcentaje actuales
    // — el mismo log que ya se sirve por SSE, sin protocolo nuevo.
    let log = std::fs::read_to_string(crate::tasks::log_path(&app.dir, &id)).unwrap_or_default();
    let ultima = log.lines().rev().find(|l| l.starts_with("@progreso "));
    let (item_actual, pct) = ultima
        .and_then(|l| serde_json::from_str::<serde_json::Value>(&l[10..]).ok())
        .map(|v| (
            v.get("item").and_then(|x| x.as_str()).map(str::to_string),
            v.get("pct").and_then(|x| x.as_u64()).map(|p| p as u32),
        ))
        .unwrap_or((None, None));
    Ok(Json(Some(lumi_proto::api::TareaModelo { id, item_actual, pct })))
}

#[derive(serde::Serialize)]
pub struct NivelEstado {
    pub id: String,
    pub nombre: String,
    pub resolucion: lumi_index::niveles::Resolucion,
}

// Instalado = LICENCIA.txt presente junto al peso — el mismo criterio que
// lumi_pesos._licencia exige para cargar, así que "instalado" aquí nunca
// puede decir sí cuando Python diría que no. Compartido entre `estado`
// (necesita el conjunto entero, por nivel) y `hay_alguno_instalado` (solo
// necesita saber si hay algo, para el Resumen).
fn instalados_dir(app: &App) -> std::collections::HashSet<String> {
    let modelos_dir = app.store.get_meta("models_dir").unwrap_or_else(|| "runtime/pesos".to_string());
    std::fs::read_dir(&modelos_dir)
        .map(|rd| {
            rd.flatten()
                .filter(|e| e.path().join("LICENCIA.txt").exists())
                .filter_map(|e| e.file_name().into_string().ok())
                .collect()
        })
        .unwrap_or_default()
}

/// Para el chequeo de "primeros pasos" del Resumen.
pub fn hay_alguno_instalado(app: &App) -> bool {
    !instalados_dir(app).is_empty()
}

pub async fn estado(
    State(app): State<App>,
    headers: HeaderMap,
) -> Result<Json<Vec<NivelEstado>>, StatusCode> {
    require_admin(&app, &bearer(&headers))?;
    let niveles = app.queue.niveles.lock().unwrap().clone();
    let instalados = instalados_dir(&app);

    let fuera = niveles
        .iter()
        .map(|n| NivelEstado {
            id: n.id.clone(), nombre: n.nombre.clone(),
            resolucion: lumi_index::niveles::resolver_composicion(n, &instalados),
        })
        .collect();
    Ok(Json(fuera))
}

// ponytail: en claro en `meta`, nunca devuelto al cliente — el mismo
// riesgo y el mismo tratamiento que `map_key` en routes/map.rs. Cifrar
// esto y no aquello sería proteger un secreto y no el otro sin ninguna
// diferencia real de amenaza entre los dos.
pub async fn get_provider_token(
    State(app): State<App>,
    headers: HeaderMap,
) -> Result<Json<lumi_proto::api::ProviderTokenState>, StatusCode> {
    require_admin(&app, &bearer(&headers))?;
    Ok(Json(lumi_proto::api::ProviderTokenState {
        has_token: app.store.get_meta("model_provider_token").is_some(),
    }))
}

pub async fn set_provider_token(
    State(app): State<App>,
    headers: HeaderMap,
    Json(req): Json<lumi_proto::api::ProviderTokenReq>,
) -> Result<Json<lumi_proto::api::ProviderTokenState>, StatusCode> {
    let admin = require_admin(&app, &bearer(&headers))?;
    if let Some(t) = req.token {
        if t.is_empty() {
            let _ = app.store.conn().execute("DELETE FROM meta WHERE k = 'model_provider_token'", []);
            tracing::info!("token de proveedor de modelos borrado por el administrador {admin}");
        } else {
            app.store.set_meta("model_provider_token", t.trim()).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
            tracing::info!("token de proveedor de modelos actualizado por el administrador {admin}");
        }
    }
    Ok(Json(lumi_proto::api::ProviderTokenState {
        has_token: app.store.get_meta("model_provider_token").is_some(),
    }))
}

#[derive(serde::Serialize)]
pub struct MetaPeso {
    pub id: String,
    pub nombre: String,
    pub licencia: String,
    pub licencia_texto: String,
    pub puerta: Option<String>,
}

pub async fn metadatos(
    State(app): State<App>,
    headers: HeaderMap,
) -> Result<Json<Vec<MetaPeso>>, StatusCode> {
    require_admin(&app, &bearer(&headers))?;
    let mut fuera = Vec::new();
    for m in app.queue.modelos.lock().unwrap().iter() {
        fuera.push(MetaPeso { id: m.id.clone(), nombre: m.nombre.clone(), licencia: m.licencia.clone(), licencia_texto: m.licencia_texto.clone(), puerta: m.puerta.clone() });
    }
    for v in app.queue.verificadores.lock().unwrap().iter() {
        fuera.push(MetaPeso { id: v.id.clone(), nombre: v.nombre.clone(), licencia: v.licencia.clone(), licencia_texto: v.licencia_texto.clone(), puerta: v.puerta.clone() });
    }
    for mo in app.queue.motores.lock().unwrap().iter() {
        fuera.push(MetaPeso { id: mo.id.clone(), nombre: mo.nombre.clone(), licencia: mo.licencia.clone(), licencia_texto: mo.licencia_texto.clone(), puerta: mo.puerta.clone() });
    }
    for g in app.queue.recursos_geo.lock().unwrap().iter() {
        fuera.push(MetaPeso { id: g.id.clone(), nombre: g.nombre.clone(), licencia: g.licencia.clone(), licencia_texto: g.licencia_texto.clone(), puerta: g.puerta.clone() });
    }
    Ok(Json(fuera))
}