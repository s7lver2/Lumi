//! Modo mantenimiento: por defecto bloquea toda la API salvo un núcleo fijo
//! y quien ya es administrador; el propio admin decide qué servicios
//! reactivar. `/v1/auth/login` es la única ruta que este módulo NO gatea
//! directamente — necesita saber si la cuenta es admin, y eso solo se sabe
//! tras verificar la contraseña dentro del propio handler de login
//! (`routes::auth::login`), así que la restricción de login vive allí.
//!
//! Mismo patrón que `zero_trust.rs`: funciones puras sobre datos ya leídos,
//! y un único middleware que las junta.

use crate::App;
use axum::extract::{Request, State};
use axum::http::{HeaderMap, StatusCode};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};

pub fn activo(app: &App) -> bool {
    app.store.get_meta("mantenimiento").as_deref() == Some("1")
}

pub fn mensaje(app: &App) -> String {
    app.store.get_meta("mantenimiento_mensaje").unwrap_or_default()
}

pub fn bloquea_login(app: &App) -> bool {
    app.store.get_meta("mantenimiento_bloquea_login").as_deref() == Some("1")
}

pub fn servicios_habilitados(app: &App) -> Vec<String> {
    app.store
        .get_meta("mantenimiento_servicios")
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

pub fn set_activo(app: &App, on: bool) -> anyhow::Result<()> {
    app.store.set_meta("mantenimiento", if on { "1" } else { "0" })
}

pub fn set_mensaje(app: &App, msg: &str) -> anyhow::Result<()> {
    app.store.set_meta("mantenimiento_mensaje", msg)
}

pub fn set_bloquea_login(app: &App, on: bool) -> anyhow::Result<()> {
    app.store.set_meta("mantenimiento_bloquea_login", if on { "1" } else { "0" })
}

pub fn set_servicios(app: &App, ids: &[String]) -> anyhow::Result<()> {
    app.store.set_meta("mantenimiento_servicios", &serde_json::to_string(ids)?)
}

/// Rutas que SIEMPRE se dejan pasar hacia el handler, tenga o no permiso su
/// llamante: sin ellas ni un admin podría revertir el modo, ni un usuario
/// normal podría saber quién es o cerrar su sesión. `/v1/auth/login` va
/// aparte: no es que esté "siempre permitido", es que su propia restricción
/// vive dentro del handler (ver `routes::auth::login`), así que aquí solo
/// se le deja llegar.
fn es_nucleo(path: &str) -> bool {
    path == "/v1/auth/login"
        || path == "/v1/hello"
        || path == "/v1/auth/me"
        || path == "/v1/auth/change-password"
        || path == "/v1/me/sessions"
        || path.starts_with("/v1/sessions/")
        || path.starts_with("/v1/admin/security")
        // Mismo criterio que en `LOCKED`: la telemetría no depende de nada
        // más, y es además el transporte por el que la tira de aviso llega
        // a toda la app — bloquearla apagaría el propio aviso.
        || path == "/v1/telemetry"
}

/// `None` = la ruta no pertenece a ningún servicio personalizable, y por
/// tanto NO se puede reactivar por separado — queda bloqueada junto con
/// todo lo demás mientras el modo esté activo. Fail-closed a propósito: es
/// más seguro que una ruta nueva, olvidada aquí, se quede bloqueada a que se
/// cuele sin querer.
pub fn servicio_de_ruta(path: &str) -> Option<&'static str> {
    const SERVICIOS: &[(&str, &str)] = &[
        ("/v1/admin/models", "modelos"),
        ("/v1/indices", "indices"),
        ("/v1/map", "mapa"),
        ("/v1/queue", "cola"),
        ("/v1/tasks", "cola"),
        ("/v1/projects", "proyectos"),
        ("/v1/images", "proyectos"),
        ("/v1/cases", "proyectos"),
        ("/v1/analyses", "proyectos"),
        ("/v1/me/invites", "proyectos"),
        ("/v1/invites", "proyectos"),
        ("/v1/me/usage", "proyectos"),
        ("/v1/access-requests", "personas"),
        ("/v1/accounts", "personas"),
        ("/v1/admin/access-requests", "personas"),
        ("/v1/admin/users", "personas"),
        ("/v1/users/search", "personas"),
        ("/v1/me/api-keys", "claves"),
        ("/v1/admin/api-keys", "claves"),
        ("/v1/api-keys", "claves"),
    ];
    SERVICIOS.iter().find(|(prefijo, _)| path.starts_with(prefijo)).map(|(_, id)| *id)
}

/// El único punto de aplicación del gateo genérico: se cuelga como capa de
/// TODO el router en `main.rs`, junto a `zero_trust_gate`. El orden entre
/// ambas capas no importa — cada una decide de forma independiente y
/// cualquiera puede cortar la petición antes del handler.
pub async fn mantenimiento_gate(
    State(app): State<App>,
    headers: HeaderMap,
    req: Request,
    next: Next,
) -> Response {
    if !activo(&app) {
        return next.run(req).await;
    }
    let path = req.uri().path();
    if es_nucleo(path) {
        return next.run(req).await;
    }
    let token = crate::routes::auth::bearer(&headers);
    if crate::routes::auth::require_session(&app, &token).is_ok_and(|(_, is_admin)| is_admin) {
        return next.run(req).await;
    }
    let habilitados = servicios_habilitados(&app);
    let permitido = servicio_de_ruta(path).is_some_and(|id| habilitados.iter().any(|h| h == id));
    if permitido {
        return next.run(req).await;
    }
    let msg = mensaje(&app);
    let cuerpo = if msg.trim().is_empty() { "Servidor en mantenimiento.".to_string() } else { msg };
    (StatusCode::SERVICE_UNAVAILABLE, cuerpo).into_response()
}
