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

#[tauri::command]
async fn pair(key: String, state: tauri::State<'_, Shared>) -> Result<serde_json::Value, String> {
    let pk = PairKey::parse(&key).map_err(|e| e.to_string())?;
    let client = client_for(&pk.fingerprint)?;
    let base = format!("https://{}", pk.addr);
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

fn main() {
    rustls::crypto::ring::default_provider().install_default().ok();
    tauri::Builder::default()
        .manage(Shared::default())
        .invoke_handler(tauri::generate_handler![pair, request])
        .run(tauri::generate_context!())
        .expect("error al arrancar Tauri");
}
