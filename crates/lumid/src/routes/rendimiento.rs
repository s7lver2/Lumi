//! GET/PATCH de los dos interruptores de "proceso persistente" (verificación
//! geométrica y agentes) — mismo estilo que `routes::models::get_provider_token`
//! / `set_provider_token`: se guardan como meta clave-valor en `Store`, no en
//! una tabla nueva. `crate::queue::worker` (recuperación) ya es persistente
//! siempre y no tiene ajuste — aquí solo viven los dos casos que sí son
//! opcionales.

use crate::routes::auth::{bearer, require_admin};
use crate::App;
use axum::extract::State;
use axum::{http::HeaderMap, http::StatusCode, Json};
use lumi_proto::api::{PatchRendimientoReq, RendimientoSettings};

const CLAVE_VERIFICACION: &str = "verificacion_persistente";
const CLAVE_AGENTES: &str = "agentes_persistente";

const DESC_ON: &str = "activado: mantiene los modelos cargados en VRAM entre análisis — respuestas mucho más rápidas, pero consume esa memoria todo el tiempo, incluso sin trabajo pendiente.";
const DESC_OFF: &str = "desactivado: cada análisis carga y descarga sus modelos — más lento, pero sin huella de memoria en reposo.";

fn leer_bool(app: &App, clave: &str) -> bool {
    app.store.get_meta(clave).as_deref() == Some("1")
}

fn desc(activo: bool) -> String {
    if activo { DESC_ON.into() } else { DESC_OFF.into() }
}

fn settings(app: &App) -> RendimientoSettings {
    let verificacion_persistente = leer_bool(app, CLAVE_VERIFICACION);
    let agentes_persistente = leer_bool(app, CLAVE_AGENTES);
    RendimientoSettings {
        verificacion_persistente_desc: desc(verificacion_persistente),
        verificacion_persistente,
        agentes_persistente_desc: desc(agentes_persistente),
        agentes_persistente,
    }
}

pub async fn get(State(app): State<App>, headers: HeaderMap) -> Result<Json<RendimientoSettings>, StatusCode> {
    require_admin(&app, &bearer(&headers))?;
    Ok(Json(settings(&app)))
}

pub async fn patch(
    State(app): State<App>,
    headers: HeaderMap,
    Json(req): Json<PatchRendimientoReq>,
) -> Result<Json<RendimientoSettings>, StatusCode> {
    let admin = require_admin(&app, &bearer(&headers))?;
    if let Some(v) = req.verificacion_persistente {
        app.store
            .set_meta(CLAVE_VERIFICACION, if v { "1" } else { "0" })
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        tracing::info!("verificación persistente {} por el administrador {admin}", if v { "activada" } else { "desactivada" });
    }
    if let Some(v) = req.agentes_persistente {
        app.store
            .set_meta(CLAVE_AGENTES, if v { "1" } else { "0" })
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        tracing::info!("agentes persistente {} por el administrador {admin}", if v { "activados" } else { "desactivados" });
    }
    // ponytail: un cambio en caliente no relanza ni mata un proceso
    // persistente que ya estuviera vivo — `verificar::afinar` y
    // `agentar::preguntar` solo miran este ajuste al decidir si lanzan uno
    // nuevo o reutilizan el que tengan. Surte efecto en el próximo análisis
    // que necesite arrancar un proceso, que es la mayoría de los casos reales
    // (activar/desactivar esto no es algo que se haga a diario); simplifica
    // mucho no tener que derribar un proceso vivo desde esta ruta.
    Ok(Json(settings(&app)))
}
