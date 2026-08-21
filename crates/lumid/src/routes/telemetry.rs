use crate::routes::auth::{bearer, require_session};
use crate::{telemetry, App};
use axum::extract::State;
use axum::http::HeaderMap;
use axum::response::sse::{Event, KeepAlive, Sse};
use futures::stream::Stream;
use std::convert::Infallible;
use std::time::Duration;

pub async fn sse(State(app): State<App>, headers: HeaderMap) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    // Se resuelve UNA VEZ, no en cada muestra: quién es esta conexión no
    // cambia mientras el stream sigue abierto. `None` (sin token, o token
    // caducado) no rompe la telemetría — solo deja `avisos` vacío, el resto
    // de la muestra (GPU, cola, mantenimiento) sigue sin depender de esto,
    // igual que en `LOCKED`.
    let visto_por = require_session(&app, &bearer(&headers)).ok();
    let stream = async_stream::stream! {
        loop {
            // `sample()` inicializa NVML, refresca sysinfo y consulta la base
            // de datos: nada de eso es async de verdad, y este bucle corre
            // cada segundo por CADA cliente con esta conexión abierta (el
            // panel de escritorio la deja abierta todo el rato). Ejecutarlo
            // inline es el mismo síntoma que ya se arregló en `hardware.rs` —
            // aquí, en vez de una petición puntual, se repite sin parar y
            // escala con el número de usuarios conectados. `spawn_blocking`
            // lo manda al pool dedicado, que no compite con el resto de
            // peticiones ni con el accept loop.
            let app2 = app.clone();
            // Si la tarea bloqueante llega a entrar en pánico (no debería:
            // `sample()` no lo hace), se salta esta muestra en vez de
            // inventarse una — el `KeepAlive` de más abajo sostiene la
            // conexión igualmente.
            if let Ok(s) = tokio::task::spawn_blocking(move || telemetry::sample(&app2, visto_por)).await {
                yield Ok(Event::default().json_data(&s).unwrap_or_default());
            }
            tokio::time::sleep(Duration::from_secs(1)).await;
        }
    };
    Sse::new(stream).keep_alive(KeepAlive::default())
}
