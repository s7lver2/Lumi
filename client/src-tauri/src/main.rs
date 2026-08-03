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

#[tauri::command]
async fn request(
    method: String, path: String, body: Option<String>, token: Option<String>,
    state: tauri::State<'_, Shared>,
) -> Result<String, String> {
    let (base, client) = {
        let c = state.lock().unwrap();
        (c.base.clone().ok_or("sin servidor vinculado")?, c.client.clone().ok_or("sin cliente")?)
    };
    let mut rb = match method.as_str() {
        "POST" => client.post(format!("{base}{path}")),
        _ => client.get(format!("{base}{path}")),
    };
    if let Some(t) = token {
        rb = rb.bearer_auth(t);
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

fn main() {
    rustls::crypto::ring::default_provider().install_default().ok();
    tauri::Builder::default()
        .manage(Shared::default())
        .invoke_handler(tauri::generate_handler![pair, reconnect, request, start_telemetry, start_task_log])
        .run(tauri::generate_context!())
        .expect("error al arrancar Tauri");
}
