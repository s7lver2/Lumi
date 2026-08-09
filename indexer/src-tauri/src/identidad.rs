//! Quién eres, y con qué firmas.
//!
//! Flujo de dispositivo y no redirección: un binario de escritorio no puede
//! guardar un secreto de cliente, y abrir un puerto local para recibir la
//! vuelta del navegador es un servidor más que mantener y un cortafuegos más
//! que explicar.
//!
//! La cuenta dice DÓNDE vive un paquete; la clave dice QUIÉN lo hizo. Van
//! separadas a propósito: un repositorio transferido no cambia de autor.

use anyhow::{anyhow, Result};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};

use crate::keys::Claves;
use crate::store::Almacen;

/// Aplicación pública registrada para el flujo de dispositivo. No es un
/// secreto: el flujo existe precisamente para no necesitar ninguno.
const CLIENTE_GITHUB: &str = "Ov23lifjQZpSg7TObgKV";

pub const AJUSTE_CUENTA: &str = "identidad_cuenta";
pub const AJUSTE_SECRETA: &str = "identidad_clave_secreta";
pub const AJUSTE_ARCHIVADAS: &str = "identidad_claves_archivadas";
/// Las doce palabras, selladas con la maestra igual que la clave. Se guardan
/// para que «ver respaldo» en Ajustes pueda volver a enseñarlas: derivarlas de
/// la clave es imposible, y una copia que solo existe en una pantalla que ya
/// se cerró no es una copia.
pub const AJUSTE_RESPALDO: &str = "identidad_respaldo";

/// `.json()` directo, cuando el proveedor responde con un cuerpo de error en
/// vez del esperado, sale como «error decoding response body» — verdad pero
/// inútil. Esto lee el texto primero y, si no encaja, cita el cuerpo real
/// (recortado) para que el fallo se pueda diagnosticar sin adivinar.
async fn leer_json<T: for<'de> Deserialize<'de>>(resp: reqwest::Response) -> Result<T> {
    let estado = resp.status();
    let cuerpo = resp.text().await?;
    serde_json::from_str(&cuerpo).map_err(|_| {
        let recorte: String = cuerpo.chars().take(200).collect();
        anyhow!("el proveedor respondió {estado}: {recorte}")
    })
}

#[derive(Serialize, Clone)]
pub struct CodigoDispositivo {
    pub codigo: String,
    pub url: String,
    /// Cada cuántos segundos permite sondear el proveedor.
    pub intervalo: u64,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct Sesion {
    pub proveedor: String,
    pub cuenta: String,
    pub avatar: String,
    pub desde: String,
    pub huella: String,
    pub permisos: Vec<String>,
}

/// La huella que se enseña al usuario. Base58 en grupos de cuatro, igual que
/// el fingerprint del subsistema 1: se compara de un vistazo o no se compara.
///
/// ponytail: un base58 real necesitaría una caja aparte solo para esto; con
/// dieciséis carácteres de un base64 sin `+/=` el usuario obtiene la misma
/// comparación visual, y el crate de más no compensa. Salida si algún día
/// hace falta interoperar con un formato base58 real: usar el crate `bs58`.
pub fn huella(publica: &[u8; 32]) -> String {
    let s = bs58_corto(publica);
    s.as_bytes()
        .chunks(4)
        .map(|c| String::from_utf8_lossy(c).to_string())
        .collect::<Vec<_>>()
        .join("·")
}

fn bs58_corto(b: &[u8; 32]) -> String {
    use sha2::{Digest, Sha256};
    let h = Sha256::digest(b);
    STANDARD.encode(&h[..12]).replace(['+', '/', '='], "")
}

/// Genera clave y respaldo. Las doce palabras son la ÚNICA copia: no hay
/// recuperación, y por eso se enseñan en el mismo momento con una casilla
/// explícita.
pub fn crear_clave(claves: &Claves<'_>) -> Result<Vec<String>> {
    use rand::RngCore;
    let mut entropia = [0u8; 16];
    rand::thread_rng().fill_bytes(&mut entropia);
    let m = bip39::Mnemonic::from_entropy_in(bip39::Language::Spanish, &entropia)?;
    let semilla = m.to_seed("");
    let secreta: [u8; 32] = semilla[..32].try_into().expect("la semilla mide 64 bytes");
    claves.guardar(AJUSTE_SECRETA, &STANDARD.encode(secreta))?;
    let palabras: Vec<String> = m.words().map(|w| w.to_string()).collect();
    claves.guardar(AJUSTE_RESPALDO, &palabras.join(" "))?;
    Ok(palabras)
}

/// El respaldo guardado, si lo hay. Sin clave todavía, crea una: pedir el
/// respaldo es el momento en que la identidad de firma empieza a existir.
pub fn respaldo(claves: &Claves<'_>) -> Result<Vec<String>> {
    match claves.leer(AJUSTE_RESPALDO)? {
        Some(s) if !s.is_empty() => Ok(s.split(' ').map(|w| w.to_string()).collect()),
        _ => crear_clave(claves),
    }
}

/// La huella de la clave guardada, si la hay. La interfaz la enseña tal cual.
pub fn huella_actual(claves: &Claves<'_>) -> Option<String> {
    let secreta = leer_clave(claves).ok()?;
    Some(huella(&ed25519_dalek::SigningKey::from_bytes(&secreta).verifying_key().to_bytes()))
}

pub fn leer_clave(claves: &Claves<'_>) -> Result<[u8; 32]> {
    let b64 = claves
        .leer(AJUSTE_SECRETA)?
        .ok_or_else(|| anyhow!("no hay clave de firma: conecta una cuenta en Ajustes"))?;
    STANDARD
        .decode(b64)?
        .try_into()
        .map_err(|_| anyhow!("la clave de firma está corrupta"))
}

/// Rotar archiva la vieja en vez de borrarla: lo ya publicado conserva su
/// firma y se tiene que poder seguir comprobando.
pub fn rotar(claves: &Claves<'_>) -> Result<Vec<String>> {
    if let Some(vieja) = claves.leer(AJUSTE_SECRETA)? {
        let mut archivo: Vec<String> = claves
            .leer(AJUSTE_ARCHIVADAS)?
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default();
        archivo.push(vieja);
        claves.guardar(AJUSTE_ARCHIVADAS, &serde_json::to_string(&archivo)?)?;
    }
    crear_clave(claves)
}

/// Pide un código de dispositivo. `scope` pide exactamente lo que la interfaz
/// enseña en Ajustes, ni un permiso más.
pub async fn arrancar(proveedor: &str) -> Result<(CodigoDispositivo, String)> {
    if proveedor != "github" {
        return Err(anyhow!("de momento solo GitHub tiene flujo de dispositivo"));
    }
    #[derive(Deserialize)]
    struct R {
        device_code: String,
        user_code: String,
        verification_uri: String,
        interval: u64,
    }
    let resp = reqwest::Client::new()
        .post("https://github.com/login/device/code")
        .header("accept", "application/json")
        .form(&[("client_id", CLIENTE_GITHUB), ("scope", "public_repo")])
        .send()
        .await?;
    let r: R = leer_json(resp).await?;
    // El device_code vuelve junto al código visible: quien llama lo guarda en
    // el estado en memoria del comando, entre `arrancar` y `sondear`.
    Ok((
        CodigoDispositivo { codigo: r.user_code, url: r.verification_uri, intervalo: r.interval },
        r.device_code,
    ))
}

#[derive(Deserialize)]
struct RespuestaSondeo {
    access_token: Option<String>,
    error: Option<String>,
}

#[derive(Deserialize)]
struct Usuario {
    login: String,
    avatar_url: String,
}

/// Códigos documentados por GitHub para el flujo de dispositivo, en un
/// mensaje que dice qué hacer, no solo cómo se llama el error.
fn mensaje_error_dispositivo(codigo: &str) -> String {
    match codigo {
        "expired_token" => "el código caducó antes de terminar en el navegador: pide uno nuevo".into(),
        "access_denied" => "se canceló el acceso desde el navegador".into(),
        "incorrect_client_credentials" | "unauthorized_client" =>
            "GitHub no reconoce esta aplicación: revisa el Client ID en Ajustes".into(),
        "incorrect_device_code" => "el código de dispositivo no es válido".into(),
        _ => format!("GitHub rechazó el inicio de sesión: {codigo}"),
    }
}

/// El proveedor del testigo de acceso en `Claves`, que ya cifra con la
/// maestra local — el testigo de GitHub no es distinto de una clave de API de
/// cualquier otro origen a efectos de dónde vive.
pub const PROVEEDOR_TESTIGO: &str = "identidad_testigo_github";

/// `slow_down` no es un error ni un "todavía no" cualquiera: el protocolo
/// exige que quien sondea sume 5 segundos a su intervalo y siga desde ahí.
/// Ignorarlo dejaba la pantalla en «esperando…» para siempre, incluso después
/// de autorizar: si el primer sondeo llega un pelín pronto, GitHub responde
/// `slow_down` a partir de ahí sin parar y nunca llega a soltar el testigo.
pub enum Sondeo {
    Pendiente,
    MasDespacio,
    Lista(Sesion, String),
}

/// Sondea una vez. Cuando hay sesión, vuelve también el testigo: quien llama
/// decide dónde guardarlo (y aquí no se guarda porque este módulo no toca
/// `Claves` sin que se lo pidan explícitamente).
pub async fn sondear(device_code: &str) -> Result<Sondeo> {
    let cliente = reqwest::Client::new();
    let resp = cliente
        .post("https://github.com/login/oauth/access_token")
        .header("accept", "application/json")
        .form(&[
            ("client_id", CLIENTE_GITHUB),
            ("device_code", device_code),
            ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
        ])
        .send()
        .await?;
    let r: RespuestaSondeo = leer_json(resp).await?;
    log::info!(
        "sondeo de dispositivo ({}…): {}",
        &device_code[..device_code.len().min(8)],
        r.error.as_deref().unwrap_or("token recibido"),
    );
    let Some(token) = r.access_token else {
        return match r.error.as_deref() {
            None | Some("authorization_pending") => Ok(Sondeo::Pendiente),
            Some("slow_down") => Ok(Sondeo::MasDespacio),
            // Cualquier otro código es definitivo — seguir sondeando dejaría
            // la pantalla en «esperando…» para siempre en vez de decir que
            // hay que reintentar desde el principio.
            Some(e) => Err(anyhow!("{}", mensaje_error_dispositivo(e))),
        };
    };
    let resp = cliente
        .get("https://api.github.com/user")
        .bearer_auth(&token)
        .header("user-agent", "lumi-indexer")
        .send()
        .await?;
    let u: Usuario = leer_json(resp).await?;
    Ok(Sondeo::Lista(
        Sesion {
            proveedor: "github".into(),
            cuenta: u.login,
            avatar: u.avatar_url,
            desde: ahora(),
            huella: String::new(),
            permisos: vec!["public_repo".into()],
        },
        token,
    ))
}

/// Segundos desde época en texto, igual que `chrono_ahora()` en `lib.rs`:
/// esta app no arrastra `chrono` por una sola marca de tiempo.
pub fn ahora() -> String {
    let s = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    format!("{s}")
}

/// La sesión activa vive en claro en `ajustes` (cuenta y avatar no son
/// secretos); el testigo va cifrado en `Claves`, como cualquier clave de
/// proveedor.
pub fn guardar_sesion(almacen: &Almacen, claves: &Claves<'_>, s: &Sesion, testigo: &str) -> Result<()> {
    almacen.guardar_ajuste(AJUSTE_CUENTA, &serde_json::to_string(s)?)?;
    claves.guardar(PROVEEDOR_TESTIGO, testigo)
}

pub fn leer_sesion(almacen: &Almacen) -> Result<Option<Sesion>> {
    Ok(almacen
        .leer_ajuste(AJUSTE_CUENTA)?
        .and_then(|s| serde_json::from_str(&s).ok()))
}

pub fn cerrar_sesion(almacen: &Almacen, claves: &Claves<'_>) -> Result<()> {
    almacen.borrar_ajuste(AJUSTE_CUENTA)?;
    claves.guardar(PROVEEDOR_TESTIGO, "")
}

/// Lo consume `publicar.rs`, que todavía no existe.
#[allow(dead_code)]
pub fn leer_testigo(claves: &Claves<'_>) -> Result<String> {
    claves
        .leer(PROVEEDOR_TESTIGO)?
        .filter(|t| !t.is_empty())
        .ok_or_else(|| anyhow!("no hay sesión: conecta una cuenta en Ajustes"))
}
