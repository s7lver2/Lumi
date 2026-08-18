//! Ajustes de red configurables: puerto de escucha, host/puerto públicos (para
//! NAT/port-forwarding/proxy TCP transparente) y el listener QUIC opcional.
//! Mismo patrón que `mantenimiento.rs`: escalares sueltos en la tabla `meta`,
//! sin tabla propia — son cinco valores, no un dominio con su propio ciclo de
//! vida.

use crate::store::Store;
use serde::{Deserialize, Serialize};

pub const DEFAULT_BIND_PORT: u16 = lumi_proto::PORT;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Settings {
    pub bind_port: u16,
    /// `None` = usar la IP LAN autodetectada, como hoy.
    pub public_host: Option<String>,
    /// `None` = igual que `bind_port`.
    pub public_port: Option<u16>,
    pub quic_enabled: bool,
    pub quic_port: u16,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            bind_port: DEFAULT_BIND_PORT,
            public_host: None,
            public_port: None,
            quic_enabled: false,
            quic_port: DEFAULT_BIND_PORT,
        }
    }
}

pub fn leer(store: &Store) -> Settings {
    let d = Settings::default();
    Settings {
        bind_port: store.get_meta("red_bind_port").and_then(|v| v.parse().ok()).unwrap_or(d.bind_port),
        public_host: store.get_meta("red_public_host").filter(|v| !v.is_empty()),
        public_port: store.get_meta("red_public_port").and_then(|v| v.parse().ok()),
        quic_enabled: store.get_meta("red_quic_enabled").as_deref() == Some("1"),
        quic_port: store.get_meta("red_quic_port").and_then(|v| v.parse().ok()).unwrap_or(d.quic_port),
    }
}

pub fn guardar(store: &Store, s: &Settings) -> anyhow::Result<()> {
    store.set_meta("red_bind_port", &s.bind_port.to_string())?;
    store.set_meta("red_public_host", s.public_host.as_deref().unwrap_or(""))?;
    store.set_meta(
        "red_public_port",
        &s.public_port.map(|p| p.to_string()).unwrap_or_default(),
    )?;
    store.set_meta("red_quic_enabled", if s.quic_enabled { "1" } else { "0" })?;
    store.set_meta("red_quic_port", &s.quic_port.to_string())?;
    Ok(())
}

/// El `host:puerto` que se incrusta en claves/tarjetas nuevas. Si no hay
/// `public_host` guardado, cae a la IP LAN autodetectada — mismo cálculo que
/// ya hacía `lumi-cli` antes de que existiera este ajuste.
pub fn direccion_publica(store: &Store) -> String {
    let s = leer(store);
    let host = s.public_host.unwrap_or_else(|| local_ip().unwrap_or_else(|| "127.0.0.1".into()));
    let port = s.public_port.unwrap_or(s.bind_port);
    format!("{host}:{port}")
}

/// Duplica la lógica de `lumi-cli::install::local_ip` a propósito: son
/// binarios distintos que no se enlazan entre sí, y es una única llamada al
/// sistema, no una abstracción que merezca su propio crate compartido.
fn local_ip() -> Option<String> {
    use std::net::UdpSocket;
    let sock = UdpSocket::bind("0.0.0.0:0").ok()?;
    sock.connect("8.8.8.8:80").ok()?;
    sock.local_addr().ok().map(|a| a.ip().to_string())
}
