//! El cliente NO confía en ninguna CA. Solo acepta el certificado cuya huella
//! coincide con la que viene dentro de la clave de vinculación. Si no coincide,
//! aborta: no hay diálogo de "¿confías?", porque ese diálogo es por donde entra
//! el atacante.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use lumi_proto::key::PairKey;
use std::sync::{Arc, Mutex};

#[derive(Debug)]
struct PinnedVerifier {
    fingerprint: String,
}

impl rustls::client::danger::ServerCertVerifier for PinnedVerifier {
    fn verify_server_cert(
        &self,
        end_entity: &rustls::pki_types::CertificateDer<'_>,
        _intermediates: &[rustls::pki_types::CertificateDer<'_>],
        _server_name: &rustls::pki_types::ServerName<'_>,
        _ocsp: &[u8],
        _now: rustls::pki_types::UnixTime,
    ) -> Result<rustls::client::danger::ServerCertVerified, rustls::Error> {
        if lumi_proto::key::fingerprint(end_entity.as_ref()) == self.fingerprint {
            Ok(rustls::client::danger::ServerCertVerified::assertion())
        } else {
            Err(rustls::Error::General("la huella del certificado no coincide".into()))
        }
    }
    fn verify_tls12_signature(
        &self, _m: &[u8], _c: &rustls::pki_types::CertificateDer<'_>,
        _d: &rustls::DigitallySignedStruct,
    ) -> Result<rustls::client::danger::HandshakeSignatureValid, rustls::Error> {
        Ok(rustls::client::danger::HandshakeSignatureValid::assertion())
    }
    fn verify_tls13_signature(
        &self, _m: &[u8], _c: &rustls::pki_types::CertificateDer<'_>,
        _d: &rustls::DigitallySignedStruct,
    ) -> Result<rustls::client::danger::HandshakeSignatureValid, rustls::Error> {
        Ok(rustls::client::danger::HandshakeSignatureValid::assertion())
    }
    fn supported_verify_schemes(&self) -> Vec<rustls::SignatureScheme> {
        rustls::crypto::ring::default_provider().signature_verification_algorithms.supported_schemes()
    }
}

#[derive(Default)]
struct Conn {
    base: Option<String>,
    client: Option<reqwest::Client>,
    /// El token de sesión vive aquí y no en las URLs del esquema `lumi://`:
    /// es un secreto, y las rutas acaban en logs y trazas de error.
    token: Option<String>,
}

/// Lo llama el lado TS cada vez que cambia la sesión. Sin esto, el esquema
/// `lumi://` no tendría con qué autenticarse contra el daemon.
#[tauri::command]
fn set_auth(token: Option<String>, state: tauri::State<'_, Shared>) {
    state.lock().unwrap().token = token;
}

/// Sube por RUTA, no por bytes: el archivo lo lee Rust y va directo al daemon
/// como multipart. Mandar 30 MB por el canal de IPC de Tauri costaría
/// serializarlos a JSON por el camino.
#[tauri::command]
async fn upload_images(
    case_id: i64, paths: Vec<String>, state: tauri::State<'_, Shared>,
) -> Result<String, String> {
    let (base, client, token) = {
        let c = state.lock().unwrap();
        (
            c.base.clone().ok_or("sin servidor vinculado")?,
            c.client.clone().ok_or("sin cliente")?,
            c.token.clone().ok_or("sin sesión")?,
        )
    };
    let mut form = reqwest::multipart::Form::new();
    for p in &paths {
        let bytes = std::fs::read(p).map_err(|e| format!("{p}: {e}"))?;
        let name = std::path::Path::new(p)
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| "sin-nombre".into());
        form = form.part(
            "file",
            reqwest::multipart::Part::bytes(bytes).file_name(name),
        );
    }
    let res = client
        .post(format!("{base}/v1/cases/{case_id}/images"))
        .bearer_auth(token)
        .multipart(form)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = res.status();
    let text = res.text().await.unwrap_or_default();
    if status.is_success() { Ok(text) } else { Err(text) }
}

type Shared = Arc<Mutex<Conn>>;

fn client_for(fingerprint: &str) -> Result<reqwest::Client, String> {
    let cfg = rustls::ClientConfig::builder()
        .dangerous()
        .with_custom_certificate_verifier(Arc::new(PinnedVerifier { fingerprint: fingerprint.into() }))
        .with_no_client_auth();
    reqwest::Client::builder()
        .use_preconfigured_tls(cfg)
        .build()
        .map_err(|e| e.to_string())
}

async fn connect(addr: &str, fingerprint: &str, state: &Shared) -> Result<serde_json::Value, String> {
    let client = client_for(fingerprint)?;
    let base = format!("https://{addr}");
    let hello: serde_json::Value = client
        .get(format!("{base}/v1/hello"))
        .send()
        .await
        .map_err(|e| format!("no se pudo conectar: {e}"))?
        .json()
        .await
        .map_err(|e| e.to_string())?;
    let mut c = state.lock().unwrap();
    c.base = Some(base);
    c.client = Some(client);
    Ok(hello)
}

#[tauri::command]
async fn pair(key: String, state: tauri::State<'_, Shared>) -> Result<serde_json::Value, String> {
    let pk = PairKey::parse(&key).map_err(|e| e.to_string())?;
    connect(&pk.addr, &pk.fingerprint, &state).await
}

/// Reestablece el cliente TLS anclado tras reabrir la app, sin la clave de
/// vinculación original: esa clave ya se gastó en el primer canje. Solo hace
/// falta la dirección y la huella, que sí sobreviven (se persisten en el
/// lado TS tras el primer `pair` con éxito).
#[tauri::command]
async fn reconnect(addr: String, fingerprint: String, state: tauri::State<'_, Shared>) -> Result<serde_json::Value, String> {
    connect(&addr, &fingerprint, &state).await
}

/// La tarjeta pública NO lleva secreto: solo dirección y huella. Se parsea en
/// Rust y no en TS para que el error sea el mismo que el de la clave de
/// vinculación, escrito una sola vez en `lumi-proto`.
#[tauri::command]
async fn pair_card(card: String, state: tauri::State<'_, Shared>) -> Result<serde_json::Value, String> {
    let c = lumi_proto::key::ServerCard::parse(&card).map_err(|e| e.to_string())?;
    connect(&c.addr, &c.fingerprint, &state).await
}

#[tauri::command]
async fn request(
    method: String, path: String, body: Option<String>,
    token: Option<String>, ticket: Option<String>,
    state: tauri::State<'_, Shared>,
) -> Result<String, String> {
    let (base, client) = {
        let c = state.lock().unwrap();
        (c.base.clone().ok_or("sin servidor vinculado")?, c.client.clone().ok_or("sin cliente")?)
    };
    let url = format!("{base}{path}");
    let mut rb = match method.as_str() {
        "POST" => client.post(url),
        "PATCH" => client.patch(url),
        "DELETE" => client.delete(url),
        _ => client.get(url),
    };
    if let Some(t) = token {
        rb = rb.bearer_auth(t);
    }
    // El ticket va en cabecera, nunca en la ruta: es un secreto.
    if let Some(t) = ticket {
        rb = rb.header("authorization", format!("Ticket {t}"));
    }
    if let Some(b) = body {
        rb = rb.header("content-type", "application/json").body(b);
    }
    let res = rb.send().await.map_err(|e| e.to_string())?;
    let status = res.status();
    let text = res.text().await.unwrap_or_default();
    if status.is_success() { Ok(text) } else { Err(text) }
}

/// SSE del daemon reemitido como evento de Tauri. El frontend solo escucha.
#[tauri::command]
async fn start_telemetry(
    token: String, app: tauri::AppHandle, state: tauri::State<'_, Shared>,
) -> Result<(), String> {
    use tauri::Emitter;
    let (base, client) = {
        let c = state.lock().unwrap();
        (c.base.clone().ok_or("sin servidor")?, c.client.clone().ok_or("sin cliente")?)
    };
    tokio::spawn(async move {
        loop {
            let res = client.get(format!("{base}/v1/telemetry")).bearer_auth(&token).send().await;
            let Ok(res) = res else {
                let _ = app.emit("telemetry-down", ());
                tokio::time::sleep(std::time::Duration::from_secs(2)).await;
                continue;
            };
            let mut stream = res.bytes_stream();
            use futures_util::StreamExt;
            let mut buf = String::new();
            while let Some(Ok(chunk)) = stream.next().await {
                buf.push_str(&String::from_utf8_lossy(&chunk));
                while let Some(i) = buf.find("\n\n") {
                    let frame = buf[..i].to_string();
                    buf.drain(..i + 2);
                    if let Some(d) = frame.strip_prefix("data: ") {
                        if let Ok(v) = serde_json::from_str::<serde_json::Value>(d) {
                            let _ = app.emit("telemetry", v);
                        }
                    }
                }
            }
            let _ = app.emit("telemetry-down", ());
        }
    });
    Ok(())
}

/// Igual que la telemetría, pero para el log de una tarea. El `from` permite
/// reengancharse en el punto exacto en que se cortó.
#[tauri::command]
async fn start_task_log(
    id: String, from: u64, token: String, app: tauri::AppHandle, state: tauri::State<'_, Shared>,
) -> Result<(), String> {
    use futures_util::StreamExt;
    use tauri::Emitter;
    let (base, client) = {
        let c = state.lock().unwrap();
        (c.base.clone().ok_or("sin servidor")?, c.client.clone().ok_or("sin cliente")?)
    };
    tokio::spawn(async move {
        let url = format!("{base}/v1/tasks/{id}/log?from={from}");
        let Ok(res) = client.get(url).bearer_auth(&token).send().await else {
            let _ = app.emit("task-log-down", ());
            return;
        };
        let mut stream = res.bytes_stream();
        let mut buf = String::new();
        while let Some(Ok(chunk)) = stream.next().await {
            buf.push_str(&String::from_utf8_lossy(&chunk));
            while let Some(i) = buf.find("\n\n") {
                let frame = buf[..i].to_string();
                buf.drain(..i + 2);
                let data: String = frame
                    .lines()
                    .filter_map(|l| l.strip_prefix("data: "))
                    .collect::<Vec<_>>()
                    .join("\n");
                if !data.is_empty() {
                    let _ = app.emit("task-log", data);
                }
            }
        }
        let _ = app.emit("task-log-down", ());
    });
    Ok(())
}

/// El SSE de la cola, reemitido como evento de Tauri.
///
/// El webview no puede usar `EventSource`: no sabe poner la cabecera de
/// autorización, y el esquema `lumi://` devuelve respuestas completas, no
/// flujos. Se hace igual que la telemetría, con el mismo bucle de reconexión.
///
/// Y hay una razón de más para reconectar: mientras esta conexión está abierta,
/// el daemon cuenta a esta persona como presente. Un hueco aquí es un hueco en
/// su presencia, y con el segundo plano apagado eso le pausa su propio trabajo.
#[tauri::command]
async fn start_queue_events(
    token: String, app: tauri::AppHandle, state: tauri::State<'_, Shared>,
) -> Result<(), String> {
    use futures_util::StreamExt;
    use tauri::Emitter;
    let (base, client) = {
        let c = state.lock().unwrap();
        (c.base.clone().ok_or("sin servidor")?, c.client.clone().ok_or("sin cliente")?)
    };
    tokio::spawn(async move {
        loop {
            let res = client.get(format!("{base}/v1/queue/events")).bearer_auth(&token).send().await;
            let Ok(res) = res else {
                let _ = app.emit("queue-down", ());
                tokio::time::sleep(std::time::Duration::from_secs(2)).await;
                continue;
            };
            let mut stream = res.bytes_stream();
            let mut buf = String::new();
            while let Some(Ok(chunk)) = stream.next().await {
                buf.push_str(&String::from_utf8_lossy(&chunk));
                while let Some(i) = buf.find("\n\n") {
                    let frame = buf[..i].to_string();
                    buf.drain(..i + 2);
                    if let Some(d) = frame.strip_prefix("data: ") {
                        if let Ok(v) = serde_json::from_str::<serde_json::Value>(d) {
                            let _ = app.emit("queue-change", v);
                        }
                    }
                }
            }
            let _ = app.emit("queue-down", ());
            tokio::time::sleep(std::time::Duration::from_secs(2)).await;
        }
    });
    Ok(())
}

fn main() {
    rustls::crypto::ring::default_provider().install_default().ok();
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(Shared::default())
        // Bytes del daemon al webview sin que el webview vea el certificado.
        // En Windows el webview lo pide como http://lumi.localhost/<ruta>; en
        // el resto, como lumi://localhost/<ruta>. En los dos casos llega aquí.
        .register_asynchronous_uri_scheme_protocol("lumi", |ctx, request, responder| {
            use tauri::Manager;
            let state = ctx.app_handle().state::<Shared>();
            let (base, client, token) = {
                let c = state.lock().unwrap();
                (c.base.clone(), c.client.clone(), c.token.clone())
            };
            let path = request.uri().path().to_string();
            tauri::async_runtime::spawn(async move {
                let fallo = |code: u16, msg: &str| {
                    http::Response::builder()
                        .status(code)
                        .header("content-type", "text/plain; charset=utf-8")
                        .body(msg.as_bytes().to_vec())
                        .unwrap()
                };
                let (Some(base), Some(client)) = (base, client) else {
                    responder.respond(fallo(503, "sin servidor vinculado"));
                    return;
                };
                let mut rb = client.get(format!("{base}{path}"));
                if let Some(t) = token {
                    rb = rb.bearer_auth(t);
                }
                match rb.send().await {
                    Ok(res) => {
                        let status = res.status().as_u16();
                        let ctype = res
                            .headers()
                            .get("content-type")
                            .and_then(|v| v.to_str().ok())
                            .unwrap_or("application/octet-stream")
                            .to_string();
                        let body = res.bytes().await.unwrap_or_default().to_vec();
                        responder.respond(
                            http::Response::builder()
                                .status(status)
                                .header("content-type", ctype)
                                // El webview de un esquema propio tiene otro
                                // origen que la app: sin esto, MapLibre no
                                // puede leer las teselas.
                                .header("access-control-allow-origin", "*")
                                .body(body)
                                .unwrap(),
                        );
                    }
                    Err(e) => responder.respond(fallo(502, &e.to_string())),
                }
            });
        })
        .invoke_handler(tauri::generate_handler![
            pair, pair_card, reconnect, request, start_telemetry, start_task_log,
            start_queue_events, set_auth, upload_images
        ])
        .run(tauri::generate_context!())
        .expect("error al arrancar Tauri");
}
