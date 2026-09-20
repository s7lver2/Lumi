//! GET/PATCH del interruptor de "proceso persistente" de verificación
//! geométrica — mismo estilo que `routes::models::get_provider_token`
//! / `set_provider_token`: se guarda como meta clave-valor en `Store`, no en
//! una tabla nueva. `crate::queue::worker` (recuperación) ya es persistente
//! siempre y no tiene ajuste — aquí solo vive el caso que sí es opcional.

use crate::routes::auth::{bearer, require_admin};
use crate::App;
use axum::extract::State;
use axum::{http::HeaderMap, http::StatusCode, Json};
use lumi_proto::api::{PatchRendimientoReq, RendimientoSettings};

const CLAVE_VERIFICACION: &str = "verificacion_persistente";
const CLAVE_LIMPIEZA_PRESION: &str = "limpieza_por_presion";

const DESC_ON: &str = "activado: mantiene los modelos cargados en VRAM entre análisis — respuestas mucho más rápidas, pero consume esa memoria todo el tiempo, incluso sin trabajo pendiente.";
const DESC_OFF: &str = "desactivado: cada análisis carga y descarga sus modelos — más lento, pero sin huella de memoria en reposo.";

const DESC_LIMPIEZA_ON: &str = "activado: si la memoria disponible está al límite justo antes de cargar un modelo nuevo, se desalojan todos los modelos cargados sin esperar los 10 minutos de inactividad.";
const DESC_LIMPIEZA_OFF: &str = "desactivado: solo se desaloja por inactividad, nunca por presión de memoria en el momento de cargar un modelo.";

fn leer_bool(app: &App, clave: &str) -> bool {
    app.store.get_meta(clave).as_deref() == Some("1")
}

/// Igual que `leer_bool`, pero para ajustes que quieren nacer ACTIVADOS: la
/// AUSENCIA de la clave (nunca se tocó desde `PATCH`) cuenta como "activado",
/// no como "desactivado" — solo un `"0"` explícito lo apaga.
fn leer_bool_activo_por_defecto(app: &App, clave: &str) -> bool {
    app.store.get_meta(clave).as_deref() != Some("0")
}

fn desc(activo: bool) -> String {
    if activo { DESC_ON.into() } else { DESC_OFF.into() }
}

fn desc_limpieza(activo: bool) -> String {
    if activo { DESC_LIMPIEZA_ON.into() } else { DESC_LIMPIEZA_OFF.into() }
}

// W4 (tanda 5, revisado tras la fe de erratas -- ya solo habla de
// verificación, no de agentes, que se borraron en la Fase 0 de Darkroom):
// con M1 aplicado (tanda 1, `quizas_purgar_por_presion` desaloja según el
// tamaño real del modelo entrante, no una constante fija de 512 MB), activar
// esta persistencia por defecto ya no reproduce el escenario de OOM de
// septiembre que la motivó apagada -- y sin agentes, el pico de memoria de
// un VLM de 8B que preocupaba a W4 ya ni siquiera puede darse aquí: lo único
// persistente sería el verificador geométrico (ALIKED/LightGlue/RoMa), mucho
// más ligero.
//
// Aun así el defecto de fábrica se queda APAGADO en este plan: es una
// decisión de producto sobre la máquina real del dueño (cuánta memoria pide
// de verdad cada proceso, con y sin persistencia -- Parte 8, ítem 0 del
// spec), no algo que quien ejecuta este plan deba adivinar sin esos números.
// Pendiente: medir en el host real y decidir si este valor de fábrica pasa
// a activado.
fn settings(app: &App) -> RendimientoSettings {
    let verificacion_persistente = leer_bool(app, CLAVE_VERIFICACION);
    let limpieza_por_presion = leer_bool_activo_por_defecto(app, CLAVE_LIMPIEZA_PRESION);
    RendimientoSettings {
        verificacion_persistente_desc: desc(verificacion_persistente),
        verificacion_persistente,
        limpieza_por_presion_desc: desc_limpieza(limpieza_por_presion),
        limpieza_por_presion,
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
    if let Some(v) = req.limpieza_por_presion {
        app.store
            .set_meta(CLAVE_LIMPIEZA_PRESION, if v { "1" } else { "0" })
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        tracing::info!("limpieza por presión de memoria {} por el administrador {admin}", if v { "activada" } else { "desactivada" });
    }
    // ponytail: un cambio en caliente no relanza ni mata un proceso
    // persistente que ya estuviera vivo — `verificar::afinar` solo mira este
    // ajuste al decidir si lanza uno nuevo o reutiliza el que tenga. Surte
    // efecto en el próximo análisis que necesite arrancar un proceso, que es
    // la mayoría de los casos reales (activar/desactivar esto no es algo que
    // se haga a diario); simplifica mucho no tener que derribar un proceso
    // vivo desde esta ruta.
    Ok(Json(settings(&app)))
}
