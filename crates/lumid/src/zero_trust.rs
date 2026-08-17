//! Reglas de Zero Trust: la lista negra manda siempre (esté o no activo el
//! modo), la blanca deja pasar sin mirar la propia lista de la clave, y la
//! clase de dispositivo es una comprobación de cabeceras, no una prueba
//! criptográfica — un cliente que falsee su User-Agent la pasa igual.
//!
//! Todo lo que decide "sí/no" vive aquí, en funciones puras sobre datos ya
//! leídos: la única pieza que toca la base de datos o la red es
//! `zero_trust_gate`, el middleware que las junta.

use crate::App;
use axum::extract::{ConnectInfo, Request, State};
use axum::http::{HeaderMap, StatusCode};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use std::net::{IpAddr, SocketAddr};

pub fn zero_trust(app: &App) -> bool {
    app.store.get_meta("zero_trust").as_deref() == Some("1")
}

/// Activo por defecto: apagar el autoservicio es una decisión explícita del
/// administrador, no el estado de fábrica.
pub fn self_service_ip(app: &App) -> bool {
    app.store.get_meta("self_service_ip").as_deref() != Some("0")
}

pub fn set_zero_trust(app: &App, on: bool) -> anyhow::Result<()> {
    app.store.set_meta("zero_trust", if on { "1" } else { "0" })
}

pub fn set_self_service_ip(app: &App, on: bool) -> anyhow::Result<()> {
    app.store.set_meta("self_service_ip", if on { "1" } else { "0" })
}

pub fn allowlist(app: &App) -> Vec<String> {
    leer_lista(app, "ip_allowlist")
}

pub fn denylist(app: &App) -> Vec<String> {
    leer_lista(app, "ip_denylist")
}

fn leer_lista(app: &App, tabla: &str) -> Vec<String> {
    let c = app.store.conn();
    let Ok(mut q) = c.prepare(&format!("SELECT ip FROM {tabla} ORDER BY added_at")) else {
        return Vec::new();
    };
    let Ok(filas) = q.query_map([], |r| r.get(0)) else { return Vec::new() };
    filas.flatten().collect()
}

/// ¿Cae `ip` dentro de esta entrada? Acepta una IP suelta, un CIDR
/// (`a.b.c.d/n`), o un comodín por octeto (`192.168.*.*`) — la forma que
/// pide la interfaz para quien no piensa en máscaras de bits. No hace falta
/// que los `*` vayan al final: `10.*.5.*` también vale, aunque no tenga
/// CIDR equivalente.
///
/// ponytail: solo IPv4 entiende rangos y comodines. Un IPv6 en la entrada se
/// compara exacto — el día que haga falta un rango de IPv6 de verdad, se
/// amplía aquí; hoy sería complejidad sin un caso real que la pida.
pub fn ip_matches(entrada: &str, ip: &IpAddr) -> bool {
    let IpAddr::V4(ip) = ip else {
        return entrada.parse::<IpAddr>().as_ref() == Ok(ip);
    };
    if entrada.contains('*') {
        let octetos_entrada: Vec<&str> = entrada.split('.').collect();
        if octetos_entrada.len() != 4 {
            return false;
        }
        let octetos_ip = ip.octets();
        return octetos_entrada.iter().enumerate().all(|(i, o)| {
            *o == "*" || o.parse::<u8>().is_ok_and(|v| v == octetos_ip[i])
        });
    }
    match entrada.split_once('/') {
        None => entrada.parse::<std::net::Ipv4Addr>().is_ok_and(|e| e == *ip),
        Some((base, bits)) => {
            let Ok(base) = base.parse::<std::net::Ipv4Addr>() else { return false };
            let Ok(bits) = bits.parse::<u32>() else { return false };
            if bits > 32 {
                return false;
            }
            let mascara = if bits == 0 { 0 } else { u32::MAX << (32 - bits) };
            u32::from(base) & mascara == u32::from(*ip) & mascara
        }
    }
}

pub fn ip_in_list(lista: &[String], ip: &IpAddr) -> bool {
    lista.iter().any(|e| ip_matches(e, ip))
}

/// Clasificación heurística por cabeceras. El orden importa: un navegador
/// móvil también trae "Mozilla", así que "móvil" se comprueba antes.
pub fn clasificar_dispositivo(headers: &HeaderMap) -> &'static str {
    let ua = headers
        .get("user-agent")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_lowercase();
    if ua.contains("android") || ua.contains("iphone") || ua.contains("ipad") {
        "movil"
    } else if ua.contains("mozilla") {
        "navegador"
    } else if ua.contains("curl") || ua.contains("python") || ua.contains("node") || ua.is_empty() {
        "cli"
    } else {
        "servidor"
    }
}

/// `None` si el token no pertenece a una clave de API viva: una sesión de
/// login normal, o un token que no existe, no tiene reglas propias que
/// aplicar aquí — `require_session` (en `routes::auth`) es quien decide por
/// su cuenta si el token vale.
fn reglas_de_la_clave(app: &App, token: &str) -> Option<(Vec<String>, Vec<String>)> {
    let (ips, devices): (Option<String>, Option<String>) = app
        .store
        .conn()
        .query_row(
            "SELECT ips, devices FROM sessions WHERE token = ?1 AND kind = 'api_key'",
            [lumi_proto::crypto::hash_token(token)],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .ok()?;
    let parse = |s: Option<String>| s.and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default();
    Some((parse(ips), parse(devices)))
}

/// El único punto de aplicación: se cuelga como capa de TODO el router en
/// `main.rs`. Sin token de clave de API, o con Zero Trust apagado, no hace
/// nada más que comprobar la lista negra.
pub async fn zero_trust_gate(
    State(app): State<App>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    req: Request,
    next: Next,
) -> Response {
    let ip = addr.ip();
    // La negra manda siempre, esté o no Zero Trust activo: una IP conocida
    // como hostil se bloquea sin condiciones.
    if ip_in_list(&denylist(&app), &ip) {
        return (StatusCode::FORBIDDEN, "IP bloqueada").into_response();
    }
    if !zero_trust(&app) {
        return next.run(req).await;
    }
    let token = crate::routes::auth::bearer(&headers);
    if let Some((ips, devices)) = reglas_de_la_clave(&app, &token) {
        if ip_in_list(&allowlist(&app), &ip) {
            return next.run(req).await;
        }
        if !ips.is_empty() && !ip_in_list(&ips, &ip) {
            return (StatusCode::FORBIDDEN, "IP no autorizada para esta clave").into_response();
        }
        if !devices.is_empty() {
            let clase = clasificar_dispositivo(&headers);
            if !devices.iter().any(|d| d == clase) {
                return (StatusCode::FORBIDDEN, "dispositivo no permitido para esta clave").into_response();
            }
        }
    }
    next.run(req).await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ip(s: &str) -> IpAddr { s.parse().unwrap() }

    #[test]
    fn comodin_por_octeto() {
        assert!(ip_matches("192.168.*.*", &ip("192.168.1.42")));
        assert!(!ip_matches("192.168.*.*", &ip("192.169.1.42")));
        // No hace falta que los comodines vayan al final.
        assert!(ip_matches("10.*.5.*", &ip("10.99.5.7")));
        assert!(!ip_matches("10.*.5.*", &ip("10.99.6.7")));
    }

    #[test]
    fn comodin_exige_cuatro_octetos() {
        assert!(!ip_matches("192.168.*", &ip("192.168.1.1")));
    }

    #[test]
    fn cidr_y_exacta_siguen_igual() {
        assert!(ip_matches("192.168.0.0/16", &ip("192.168.1.1")));
        assert!(!ip_matches("192.168.0.0/16", &ip("192.169.1.1")));
        assert!(ip_matches("10.0.0.1", &ip("10.0.0.1")));
    }
}
