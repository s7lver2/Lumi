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
    /// Nombre a resolver contra el set de SVG dibujados a mano de
    /// `AgenteIcono.tsx`.
    pub icono: String,
    pub modo: String,
    /// `false` cuando el motor que este agente necesita (siempre `vlm` hoy)
    /// no tiene sus pesos instalados en este servidor — la tarjeta se enseña
    /// bloqueada, no se retira de la lista.
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
        // Un agente que el banco de pruebas marcó "activo": false sigue en
        // el registro (se sigue evaluando) pero no se le ofrece al
        // investigador -- ver tools/evaluar_agentes.py.
        .filter(|a| a.activo)
        .map(|a| {
            // Un solo agente a la vez: reutiliza la misma cuenta agente→motor
            // que ya usa el panel de administración (`motores_de_agentes`),
            // que deduplica por CLASE de motor y no por agente.
            let necesarios = lumi_index::agentes::motores_de_agentes(
                std::slice::from_ref(&a.id), std::slice::from_ref(&a), &motores,
            );
            let motor = motores.iter().find(|m| m.clase == "vlm");
            let instalado = necesarios.iter().all(|id| instalados.contains(id));
            AgenteVista {
                id: a.id,
                nombre: a.nombre,
                icono: a.icono,
                modo: a.modo,
                instalado,
                requiere: if instalado { None } else { motor.map(|m| m.nombre.clone()) },
            }
        })
        .collect();
    Ok(Json(fuera))
}
