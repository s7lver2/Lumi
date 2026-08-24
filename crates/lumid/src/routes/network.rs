//! Ajustes de red del panel: puerto de escucha, host/puerto públicos y el
//! interruptor de QUIC. Reiniciar es la única acción con efectos de verdad:
//! el resto son lecturas/escrituras normales sobre `meta`.

use crate::routes::auth::{bearer, require_admin};
use crate::{red, App};
use axum::{extract::State, http::HeaderMap, http::StatusCode, Json};
use lumi_proto::key::ServerCard;
use serde::Serialize;
use std::time::Duration;

#[derive(Serialize)]
pub struct NetworkView {
    settings: red::Settings,
    server_card: String,
    /// `Some(motivo)` si "Reiniciar ahora" debe salir deshabilitado.
    restart_blocked_reason: Option<String>,
}

fn tarjeta(app: &App) -> String {
    let der = std::fs::read(app.dir.join("cert.der")).unwrap_or_default();
    ServerCard::new(&red::direccion_publica(&app.store), &der).to_string()
}

fn motivo_bloqueo(app: &App) -> Option<String> {
    let en_curso: i64 = app
        .store
        .conn()
        .query_row("SELECT COUNT(*) FROM analyses WHERE state = 'en_curso'", [], |r| r.get(0))
        .unwrap_or(0);
    if en_curso > 0 {
        Some(format!(
            "hay {en_curso} análisis en curso; reiniciar ahora los cortaría a medias"
        ))
    } else {
        None
    }
}

pub async fn get(State(app): State<App>, headers: HeaderMap) -> Result<Json<NetworkView>, StatusCode> {
    require_admin(&app, &bearer(&headers))?;
    Ok(Json(NetworkView {
        settings: red::leer(&app.store),
        server_card: tarjeta(&app),
        restart_blocked_reason: motivo_bloqueo(&app),
    }))
}

pub async fn patch(
    State(app): State<App>,
    headers: HeaderMap,
    Json(s): Json<red::Settings>,
) -> Result<Json<NetworkView>, (StatusCode, String)> {
    let admin = require_admin(&app, &bearer(&headers)).map_err(|c| (c, "hace falta ser administrador".to_string()))?;
    red::guardar(&app.store, &s).map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    tracing::info!("ajustes de red cambiados por el administrador {admin}: puerto {}", s.bind_port);
    Ok(Json(NetworkView {
        settings: red::leer(&app.store),
        server_card: tarjeta(&app),
        restart_blocked_reason: motivo_bloqueo(&app),
    }))
}

/// Espera antes de reiniciar de verdad, para dar tiempo a que el aviso por
/// SSE llegue a cualquier sesión conectada mientras el daemon todavía
/// responde en la dirección vieja.
const AVISO_ANTES_DE_REINICIAR: Duration = Duration::from_secs(5);

pub async fn restart(State(app): State<App>, headers: HeaderMap) -> Result<StatusCode, (StatusCode, String)> {
    let admin = require_admin(&app, &bearer(&headers)).map_err(|c| (c, "hace falta ser administrador".to_string()))?;
    if let Some(motivo) = motivo_bloqueo(&app) {
        return Err((StatusCode::CONFLICT, motivo));
    }
    tracing::info!("reinicio del servidor pedido por el administrador {admin}");
    let nuevo_addr = red::direccion_publica(&app.store);
    // Difunde a TODAS las sesiones conectadas (el filtro por user_id lo hace
    // cada handler de SSE en `routes::queue::events`, no aquí).
    app.queue.difundir(lumi_proto::api::Cambio::Red { user_id: 0, nuevo_addr });
    tokio::spawn(async move {
        tokio::time::sleep(AVISO_ANTES_DE_REINICIAR).await;
        // Salida con código distinto de cero A PROPÓSITO: la unit de systemd
        // usa `Restart=on-failure`, así que un `exit(0)` no relanzaría el
        // proceso. Esto no es un fallo real, es la única palanca que
        // systemd entiende como "vuelve a arrancarme".
        std::process::exit(1);
    });
    Ok(StatusCode::NO_CONTENT)
}
