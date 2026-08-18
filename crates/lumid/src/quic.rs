//! Listener QUIC/HTTP-3 opcional. Sirve solo `/v1/hello` — ver la nota
//! ponytail en el plan de implementación de esta feature para el porqué.
//! Mismo certificado que el listener TCP+TLS: la huella que ancla la clave
//! de vinculación es una sola, no una por transporte.

use crate::App;
use bytes::Bytes;
use rustls_pki_types::{CertificateDer, PrivateKeyDer};
use std::sync::Arc;

fn cargar_identidad(dir: &std::path::Path) -> anyhow::Result<(Vec<CertificateDer<'static>>, PrivateKeyDer<'static>)> {
    let der = std::fs::read(dir.join("cert.der"))?;
    let cert = CertificateDer::from(der).into_owned();
    let key_pem = std::fs::read(dir.join("key.pem"))?;
    let mut reader = std::io::Cursor::new(key_pem);
    let key = rustls_pemfile::pkcs8_private_keys(&mut reader)
        .next()
        .ok_or_else(|| anyhow::anyhow!("key.pem sin clave PKCS8"))??;
    Ok((vec![cert], PrivateKeyDer::Pkcs8(key)))
}

pub async fn arrancar_si_procede(app: App) -> anyhow::Result<()> {
    let s = crate::red::leer(&app.store);
    if !s.quic_enabled {
        return Ok(());
    }
    let (certs, key) = cargar_identidad(&app.dir)?;
    let mut rustls_cfg = rustls::ServerConfig::builder()
        .with_no_client_auth()
        .with_single_cert(certs, key)?;
    rustls_cfg.alpn_protocols = vec![b"h3".to_vec()];
    let quic_cfg = quinn::crypto::rustls::QuicServerConfig::try_from(rustls_cfg)?;
    let server_cfg = quinn::ServerConfig::with_crypto(Arc::new(quic_cfg));
    let addr: std::net::SocketAddr = ([0, 0, 0, 0], s.quic_port).into();
    let endpoint = quinn::Endpoint::server(server_cfg, addr)?;
    tracing::info!("lumid (QUIC/HTTP-3, solo /v1/hello) escuchando en udp:{}", s.quic_port);

    let hello_json = serde_json::to_vec(&app_hello(&app).await)?;
    while let Some(conectando) = endpoint.accept().await {
        let hello_json = hello_json.clone();
        tokio::spawn(async move {
            if let Err(e) = atender(conectando, hello_json).await {
                tracing::warn!("conexión QUIC caída: {e}");
            }
        });
    }
    Ok(())
}

async fn atender(conectando: quinn::Incoming, hello_json: Vec<u8>) -> anyhow::Result<()> {
    let conn = conectando.await?;
    let mut h3_conn = h3::server::Connection::<_, Bytes>::new(h3_quinn::Connection::new(conn)).await?;
    while let Some(resolver) = h3_conn.accept().await? {
        let (_req, mut stream) = resolver.resolve_request().await?;
        let resp = http::Response::builder()
            .status(200)
            .header("content-type", "application/json")
            .body(())?;
        stream.send_response(resp).await?;
        stream.send_data(Bytes::from(hello_json.clone())).await?;
        stream.finish().await?;
    }
    Ok(())
}

/// `/v1/hello` no cambia mientras el proceso vive (capacidades, huella,
/// versión) salvo por el estado de bloqueo — que sobre QUIC no hace falta
/// perseguir en vivo todavía: es una única ruta de prueba de que el
/// transporte funciona, no la superficie completa.
async fn app_hello(app: &App) -> lumi_proto::api::Hello {
    let hw = crate::hardware::capacidades().await;
    lumi_proto::api::Hello {
        version: env!("CARGO_PKG_VERSION").into(),
        state: app.store.state(),
        mode: app.mode,
        locked: app.master.read().await.is_none(),
        fingerprint: app.fingerprint.clone(),
        capabilities: lumi_proto::caps::matrix(app.mode, app.gpus.len(), false, &hw),
        gpus: app.gpus.clone(),
    }
}
