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
    // `telemetry::muestrear_en_vivo` es quien de verdad llama a `sample()`
    // (NVML, sysinfo, `Disks::new_with_refreshed_list`, 5 consultas a la
    // base) -- UNA vez por segundo pase lo que pase, no una vez por CADA
    // conexión SSE abierta. Antes ese bucle vivía aquí mismo y el coste se
    // multiplicaba por cliente conectado (medido: 8,3ms de mediana solo en
    // `Nvml::init()`, más el resto). Esta conexión solo escucha el `watch` y
    // rellena `avisos`, que es lo único que de verdad depende de quién
    // pregunta.
    let mut rx = app.telemetria.subscribe();
    let stream = async_stream::stream! {
        loop {
            // El `watch` empieza en `None` hasta el primer tick de
            // `muestrear_en_vivo` -- se espera sin mandar nada en vez de
            // emitir una muestra a medias.
            let base = rx.borrow_and_update().clone();
            if let Some(base) = base {
                let app2 = app.clone();
                // Solo `avisos_para` corre aquí, no la muestra entera: unas
                // pocas consultas SQLite por conexión, no NVML+sysinfo+discos.
                if let Ok(avisos) = tokio::task::spawn_blocking(move || telemetry::avisos_para(&app2, visto_por)).await {
                    let s = lumi_proto::api::Sample { avisos, ..base };
                    yield Ok(Event::default().json_data(&s).unwrap_or_default());
                }
            }
            if rx.changed().await.is_err() {
                // El `Sender` se soltó (el daemon está cerrando) -- sin más
                // muestras que esperar, se cae al `KeepAlive` de abajo, que
                // sostiene la conexión igual que antes ante cualquier hueco.
                tokio::time::sleep(Duration::from_secs(1)).await;
            }
        }
    };
    Sse::new(stream).keep_alive(KeepAlive::default())
}
