//! Carga el certificado autofirmado que dejó el instalador y calcula su
//! huella, que es la que el cliente compara contra la que trae la clave.

use anyhow::{Context, Result};
use axum_server::tls_rustls::RustlsConfig;
use std::path::Path;

pub async fn load(dir: &Path) -> Result<(RustlsConfig, String)> {
    let der = std::fs::read(dir.join("cert.der")).context("falta cert.der: ejecuta lumi install")?;
    let fingerprint = lumi_proto::key::fingerprint(&der);
    let pem = pem_wrap(&der);
    let key = std::fs::read(dir.join("key.pem")).context("falta key.pem")?;
    let cfg = RustlsConfig::from_pem(pem.into_bytes(), key).await?;
    Ok((cfg, fingerprint))
}

fn pem_wrap(der: &[u8]) -> String {
    use std::fmt::Write;
    // ponytail: base64 a mano evita una dependencia solo para esto.
    let b64 = base64_std(der);
    let mut s = String::from("-----BEGIN CERTIFICATE-----\n");
    for chunk in b64.as_bytes().chunks(64) {
        let _ = writeln!(s, "{}", std::str::from_utf8(chunk).unwrap());
    }
    s.push_str("-----END CERTIFICATE-----\n");
    s
}

fn base64_std(data: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(data.len().div_ceil(3) * 4);
    for c in data.chunks(3) {
        let b = [c[0], *c.get(1).unwrap_or(&0), *c.get(2).unwrap_or(&0)];
        let n = u32::from_be_bytes([0, b[0], b[1], b[2]]);
        for i in 0..4 {
            if i <= c.len() {
                out.push(T[((n >> (18 - 6 * i)) & 63) as usize] as char);
            } else {
                out.push('=');
            }
        }
    }
    out
}
