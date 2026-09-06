//! El CLI como cliente autenticado de `lumid` por red — para `lumi admin
//! ...`, que ya no toca el SQLite a mano (eso es `rescate.rs`, la escotilla
//! aparte). Mismo anclaje de huella que ya usa el cliente de escritorio
//! (`client/src-tauri/src/main.rs::PinnedVerifier`): un certificado
//! autofirmado no tiene cadena que validar contra una CA, así que se
//! verifica byte a byte contra la huella esperada, nunca contra el sistema
//! de confianza por defecto de TLS.

use crate::install::DATA;
use anyhow::{bail, Context, Result};
use lumi_proto::api::{LoginReq, LoginRes};
use lumi_proto::key::{fingerprint, ServerCard};
use serde::de::DeserializeOwned;
use serde::Serialize;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

/// A quién se conecta el CLI: dirección + huella del certificado que se
/// acepta. Nunca se construye a mano fuera de `resolver()` — es la única
/// función que decide de dónde sale cada campo.
pub struct Servidor {
    pub addr: String,
    pub fingerprint: String,
}

/// Sin `--card`: asume que corre en la MISMA máquina que `lumid` y lee su
/// certificado directamente del disco — no hace falta pedirle la huella por
/// red a algo que ya se puede leer. Con `--card`: la tarjeta pública trae
/// dirección y huella juntas (`lumi1s_...`), el mismo formato que ya
/// consume el cliente de escritorio al emparejarse — así se puede correr
/// este mismo binario desde otra máquina (incluida una instalación de
/// Windows contra un `lumid` en WSL) sin nada especial de por medio.
pub fn resolver(card: Option<&str>) -> Result<Servidor> {
    match card {
        Some(s) => {
            let c = ServerCard::parse(s).context("tarjeta de servidor inválida")?;
            Ok(Servidor { addr: c.addr, fingerprint: c.fingerprint })
        }
        None => {
            let der = std::fs::read(format!("{DATA}/cert.der"))
                .context("no se encontró el certificado local — ¿lumid está instalado aquí? si el servidor es remoto, usa --card")?;
            Ok(Servidor { addr: format!("127.0.0.1:{}", lumi_proto::PORT), fingerprint: fingerprint(&der) })
        }
    }
}

#[derive(Debug)]
struct AnclaHuella {
    fingerprint: String,
}

impl rustls::client::danger::ServerCertVerifier for AnclaHuella {
    fn verify_server_cert(
        &self,
        end_entity: &rustls::pki_types::CertificateDer<'_>,
        _intermediates: &[rustls::pki_types::CertificateDer<'_>],
        _server_name: &rustls::pki_types::ServerName<'_>,
        _ocsp: &[u8],
        _now: rustls::pki_types::UnixTime,
    ) -> Result<rustls::client::danger::ServerCertVerified, rustls::Error> {
        if fingerprint(end_entity.as_ref()) == self.fingerprint {
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

fn cliente(servidor: &Servidor) -> Result<reqwest::blocking::Client> {
    let cfg = rustls::ClientConfig::builder()
        .dangerous()
        .with_custom_certificate_verifier(Arc::new(AnclaHuella { fingerprint: servidor.fingerprint.clone() }))
        .with_no_client_auth();
    reqwest::blocking::Client::builder()
        .use_preconfigured_tls(cfg)
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .context("no se pudo construir el cliente HTTPS")
}

fn base(servidor: &Servidor) -> String {
    format!("https://{}", servidor.addr)
}

fn home_dir() -> PathBuf {
    std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .map(PathBuf::from)
        .expect("no se pudo determinar el directorio personal (falta HOME/USERPROFILE)")
}

fn ruta_sesion() -> PathBuf {
    home_dir().join(".lumi").join("session")
}

const SESION_TTL_S: i64 = 15 * 60;

#[derive(serde::Serialize, serde::Deserialize)]
struct SesionGuardada {
    addr: String,
    fingerprint: String,
    token: String,
    expira: i64,
}

fn ahora() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs() as i64
}

/// Sesión ya guardada para ESTE servidor exacto (misma dirección Y misma
/// huella — cambiar de servidor no debe reusar el token de otro) y que no
/// haya caducado. `None` en cualquier otro caso: se pide login de nuevo.
fn sesion_en_cache(servidor: &Servidor) -> Option<String> {
    let texto = std::fs::read_to_string(ruta_sesion()).ok()?;
    let s: SesionGuardada = serde_json::from_str(&texto).ok()?;
    if s.addr == servidor.addr && s.fingerprint == servidor.fingerprint && s.expira > ahora() {
        Some(s.token)
    } else {
        None
    }
}

fn guardar_sesion(servidor: &Servidor, token: &str) -> Result<()> {
    let ruta = ruta_sesion();
    std::fs::create_dir_all(ruta.parent().unwrap())?;
    let s = SesionGuardada {
        addr: servidor.addr.clone(),
        fingerprint: servidor.fingerprint.clone(),
        token: token.to_string(),
        expira: ahora() + SESION_TTL_S,
    };
    std::fs::write(&ruta, serde_json::to_string(&s)?)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&ruta, std::fs::Permissions::from_mode(0o600))?;
    }
    Ok(())
}

/// Pide usuario y contraseña por terminal y hace login contra `lumid`. No
/// se llama directo desde los comandos: pasa siempre por `token()`, que
/// primero mira si ya hay una sesión válida en caché.
fn iniciar_sesion(servidor: &Servidor) -> Result<String> {
    let usuario: String = dialoguer::Input::new().with_prompt("usuario").interact_text()?;
    let contrasena = dialoguer::Password::new().with_prompt("contraseña").interact()?;
    let res: LoginRes = cliente(servidor)?
        .post(format!("{}/v1/auth/login", base(servidor)))
        .json(&LoginReq { username: usuario, password: contrasena, device: None })
        .send()
        .context("no se pudo conectar con lumid")?
        .error_for_status()
        .context("usuario o contraseña incorrectos")?
        .json()
        .context("respuesta de login ilegible")?;
    if res.must_change_password {
        bail!("esa cuenta tiene un cambio de contraseña pendiente — entra primero desde el cliente para completarlo");
    }
    if !res.is_admin {
        bail!("{} no es administrador en este servidor", res.username);
    }
    guardar_sesion(servidor, &res.token)?;
    Ok(res.token)
}

fn token(servidor: &Servidor) -> Result<String> {
    if let Some(t) = sesion_en_cache(servidor) {
        return Ok(t);
    }
    iniciar_sesion(servidor)
}

/// Falla con el cuerpo de la respuesta si el estado no es de éxito — sin
/// esto, un 400/403 del servidor solo decía "HTTP status server error"
/// (el genérico de `reqwest`), sin el motivo real que `lumid` sí manda en
/// el cuerpo.
fn comprobar(r: reqwest::blocking::Response) -> Result<reqwest::blocking::Response> {
    if r.status().is_success() {
        return Ok(r);
    }
    let estado = r.status();
    let cuerpo = r.text().unwrap_or_default();
    bail!("{estado}: {cuerpo}")
}

pub fn get_json<T: DeserializeOwned>(servidor: &Servidor, path: &str) -> Result<T> {
    let t = token(servidor)?;
    let r = cliente(servidor)?
        .get(format!("{}{path}", base(servidor)))
        .bearer_auth(t)
        .send()
        .context("no se pudo conectar con lumid")?;
    Ok(comprobar(r)?.json()?)
}

pub fn patch_json<B: Serialize, T: DeserializeOwned>(servidor: &Servidor, path: &str, body: &B) -> Result<T> {
    let t = token(servidor)?;
    let r = cliente(servidor)?
        .patch(format!("{}{path}", base(servidor)))
        .bearer_auth(t)
        .json(body)
        .send()
        .context("no se pudo conectar con lumid")?;
    Ok(comprobar(r)?.json()?)
}

/// Como `patch_json`, pero para rutas que contestan sin cuerpo (204) — un
/// `.json()` a secas sobre una respuesta vacía fallaría con "EOF while
/// parsing a value".
pub fn patch_sin_respuesta<B: Serialize>(servidor: &Servidor, path: &str, body: &B) -> Result<()> {
    let t = token(servidor)?;
    let r = cliente(servidor)?
        .patch(format!("{}{path}", base(servidor)))
        .bearer_auth(t)
        .json(body)
        .send()
        .context("no se pudo conectar con lumid")?;
    comprobar(r)?;
    Ok(())
}

pub fn post_sin_cuerpo<T: DeserializeOwned>(servidor: &Servidor, path: &str) -> Result<T> {
    let t = token(servidor)?;
    let r = cliente(servidor)?
        .post(format!("{}{path}", base(servidor)))
        .bearer_auth(t)
        .send()
        .context("no se pudo conectar con lumid")?;
    Ok(comprobar(r)?.json()?)
}
