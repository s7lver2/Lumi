//! Lista de agentes para la pantalla 1 del modo Agentes: quién existe en el
//! registro y si su motor ya está instalado en este servidor. Cualquier
//! sesión válida puede leerla — no es información administrativa, es lo que
//! el investigador necesita para elegir un agente.

use crate::routes::auth::{bearer, require_session};
use crate::App;
use axum::extract::State;
use axum::{http::HeaderMap, http::StatusCode, Json};

type Fail = (StatusCode, String);

#[derive(serde::Serialize)]
pub struct AgenteVista {
    pub id: String,
    pub nombre: String,
    pub motor: String,
    pub pregunta: String,
    pub etiquetas: Vec<String>,
    pub umbral_confianza: f64,
    /// `false` cuando el motor que este agente necesita (`vlm`, `ocr` o
    /// `profundidad`) no tiene sus pesos instalados en este servidor — la
    /// tarjeta se enseña bloqueada, no se retira de la lista.
    pub instalado: bool,
    /// El nombre del motor que hace falta descargar. `None` cuando
    /// `instalado` es `true`, o cuando el registro de motores no trae ningún
    /// motor de esa clase (no se puede pedir descargar lo que no existe).
    pub requiere: Option<String>,
}

pub async fn listar(
    State(app): State<App>,
    headers: HeaderMap,
) -> Result<Json<Vec<AgenteVista>>, Fail> {
    require_session(&app, &bearer(&headers)).map_err(|c| (c, "sesión inválida".to_string()))?;

    let agentes = app.queue.agentes.lock().unwrap().clone();
    let motores = app.queue.motores.lock().unwrap().clone();
    let instalados = crate::routes::models::instalados_dir(&app);

    let fuera = agentes
        .into_iter()
        .map(|a| {
            // Un solo agente a la vez: reutiliza la misma cuenta agente→motor
            // que ya usa el panel de administración (`motores_de_agentes`),
            // que deduplica por CLASE de motor y no por agente.
            let necesarios = lumi_index::agentes::motores_de_agentes(
                std::slice::from_ref(&a.id), std::slice::from_ref(&a), &motores,
            );
            let motor = motores.iter().find(|m| m.clase == a.motor);
            let instalado = necesarios.iter().all(|id| instalados.contains(id));
            AgenteVista {
                id: a.id,
                nombre: a.nombre,
                motor: a.motor,
                pregunta: a.pregunta,
                etiquetas: a.etiquetas,
                umbral_confianza: a.umbral_confianza,
                instalado,
                requiere: if instalado { None } else { motor.map(|m| m.nombre.clone()) },
            }
        })
        .collect();
    Ok(Json(fuera))
}
