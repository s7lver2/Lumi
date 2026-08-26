//! Lectura y aplicación del canal de actualizaciones. Rutas finas: solo
//! comprueban permisos y delegan en `crate::actualizacion`.

use crate::mantenimiento;
use crate::routes::auth::{bearer, require_admin};
use crate::App;
use axum::extract::State;
use axum::{http::HeaderMap, http::StatusCode, Json};

pub async fn get(
    State(app): State<App>,
    headers: HeaderMap,
) -> Result<Json<crate::actualizacion::EstadoActualizacion>, StatusCode> {
    require_admin(&app, &bearer(&headers))?;
    Ok(Json(crate::actualizacion::estado_cacheado(&app)))
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
pub async fn aplicar(State(app): State<App>, headers: HeaderMap) -> StatusCode {
    if require_admin(&app, &bearer(&headers)).is_err() {
        return StatusCode::FORBIDDEN;
    }
    let app2 = app.clone();
    tokio::spawn(async move {
        if let Err(e) = crate::actualizacion::aplicar(&app2).await {
            tracing::error!("actualización de lumid fallida: {e}");
            let _ = mantenimiento::set_activo(&app2, false);
        }
    });
    StatusCode::ACCEPTED
}
