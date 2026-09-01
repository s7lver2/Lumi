//! Lectura y aplicación del canal de actualizaciones. Rutas finas: solo
//! comprueban permisos y delegan en `crate::actualizacion`.

use crate::mantenimiento;
use crate::routes::auth::{bearer, require_admin};
use crate::App;
use axum::extract::State;
use axum::{http::HeaderMap, http::StatusCode, Json};
use serde::Deserialize;

#[derive(Debug, Deserialize)]
pub struct AplicarReq {
    /// `None` (o cuerpo vacío) = la más nueva disponible, igual que antes;
    /// `Some(v)` = esa versión concreta, downgrade incluido (#71).
    #[serde(default)]
    pub version: Option<String>,
}

pub async fn get(
    State(app): State<App>,
    headers: HeaderMap,
) -> Result<Json<crate::actualizacion::EstadoActualizacion>, StatusCode> {
    require_admin(&app, &bearer(&headers))?;
    Ok(Json(crate::actualizacion::estado_cacheado(&app)))
}

/// Todas las publicaciones de `lumid`, más recientes primero — a
/// diferencia de `get` (solo "¿hay algo más nuevo?"), es lo que alimenta el
/// selector de versión del panel para instalar cualquiera, no solo la
/// última (#71).
pub async fn historial(
    State(app): State<App>,
    headers: HeaderMap,
) -> Result<Json<Vec<crate::actualizacion::PublicacionHistorial>>, (StatusCode, String)> {
    require_admin(&app, &bearer(&headers)).map_err(|s| (s, String::new()))?;
    crate::actualizacion::historial().await.map(Json).map_err(|e| (StatusCode::BAD_GATEWAY, e))
}

pub async fn comprobar_ahora(
    State(app): State<App>,
    headers: HeaderMap,
) -> Result<Json<crate::actualizacion::EstadoActualizacion>, StatusCode> {
    require_admin(&app, &bearer(&headers))?;
    crate::actualizacion::comprobar_y_cachear(&app).await;
    Ok(Json(crate::actualizacion::estado_cacheado(&app)))
}

/// Dispara la actualización en segundo plano y responde de inmediato: puede
/// tardar horas (esperando a que la cola vacíe) y el proceso muere al
/// reiniciar systemd al final, así que no hay una respuesta HTTP "limpia"
/// posible al terminar. El panel sigue el progreso sondeando `GET
/// /v1/admin/actualizacion`.
pub async fn aplicar(State(app): State<App>, headers: HeaderMap, Json(req): Json<AplicarReq>) -> StatusCode {
    if require_admin(&app, &bearer(&headers)).is_err() {
        return StatusCode::FORBIDDEN;
    }
    crate::actualizacion::set_aplicando(&app, true);
    // Un fallo del intento ANTERIOR no debe seguir mostrándose como si
    // fuera del que acaba de arrancar — se limpia aquí, no solo al fallar,
    // para que un reintento que sí funciona no arrastre el error viejo.
    crate::actualizacion::set_error_aplicar(&app, "");
    let app2 = app.clone();
    tokio::spawn(async move {
        if let Err(e) = crate::actualizacion::aplicar(&app2, req.version.as_deref()).await {
            tracing::error!("actualización de lumid fallida: {e}");
            let _ = mantenimiento::set_activo(&app2, false);
            // El mensaje de sistema ("Actualizando a…") no debe quedar
            // pegado si la actualización falla o hace timeout (#72) — el
            // caso de ColaAtascada ya se limpia a sí mismo dentro de
            // `aplicar`, pero cualquier otro error (descarga, hash,
            // escritura, backup) solo se ve aquí.
            let _ = mantenimiento::set_mensaje_sistema(&app2, "");
            // Antes este error solo llegaba al log: el botón se reactivaba,
            // mantenimiento se apagaba, y el admin no tenía ninguna pista de
            // que la actualización había fallado de verdad.
            crate::actualizacion::set_error_aplicar(&app2, &e.to_string());
            crate::actualizacion::set_aplicando(&app2, false);
        }
        // Si `aplicar` tiene éxito, el proceso se reinicia (`systemctl
        // restart`) antes de llegar aquí — el flag `aplicando` no necesita
        // limpiarse en ese caso porque el propio proceso muere con él.
    });
    StatusCode::ACCEPTED
}
