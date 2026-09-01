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

/// El mensaje que ve quien está bloqueado por mantenimiento: el que haya
/// puesto el admin a mano (`mantenimiento_mensaje`) tiene siempre prioridad
/// — es una decisión explícita suya — y el de sistema (el que pone el
/// propio flujo de actualización, ver `set_mensaje_sistema`) solo se
/// muestra cuando no hay uno de usuario, para no perderlo bajo un
/// "Actualizando a…" automático.
pub fn mensaje(app: &App) -> String {
    let usuario = app.store.get_meta("mantenimiento_mensaje").unwrap_or_default();
    if !usuario.trim().is_empty() {
        return usuario;
    }
    app.store.get_meta("mantenimiento_mensaje_sistema").unwrap_or_default()
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

/// Migración de una sola vez, a ejecutar al arrancar antes de construir
/// `App`: antes de que existiera `mantenimiento_mensaje_sistema`, el flujo
/// de actualización escribía su propio mensaje directo en
/// `mantenimiento_mensaje` — el mismo campo que ahora se trata como "puesto
/// por el admin a mano" y por eso gana prioridad siempre (ver `mensaje()`).
/// Un valor viejo así se queda contaminando esa prioridad para siempre, sin
/// que ninguna actualización nueva pueda desplazarlo. Se reconoce por el
/// prefijo exacto que ese flujo antiguo usaba y, si coincide, se traslada al
/// campo de sistema (donde sigue siendo el mismo dato, solo que ya no
/// bloquea al de verdad) en vez de perderse sin más.
pub fn migrar_mensaje_contaminado(store: &crate::store::Store) -> anyhow::Result<()> {
    if let Some(actual) = store.get_meta("mantenimiento_mensaje") {
        if actual.starts_with("Actualizando a ") {
            store.set_meta("mantenimiento_mensaje_sistema", &actual)?;
            store.set_meta("mantenimiento_mensaje", "")?;
        }
    }
    Ok(())
}

/// Mensaje "de sistema": lo pone el propio flujo de actualización, nunca el
/// admin a mano. Vive en su propia clave para no pisar `set_mensaje` — ver
/// la nota en `mensaje()` sobre la prioridad entre ambos.
pub fn set_mensaje_sistema(app: &App, msg: &str) -> anyhow::Result<()> {
    app.store.set_meta("mantenimiento_mensaje_sistema", msg)
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
