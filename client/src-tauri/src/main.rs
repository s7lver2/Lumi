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

/// Lee un archivo local y lo devuelve como `data:` URL en base64 — el
/// webview no puede cargar una ruta de disco arbitraria directamente
/// (necesitaría configurar el scope de activos de Tauri), así que la imagen
/// ORIGINAL (antes de recortar) entra al editor de recorte por aquí. Es la
/// única foto que viaja por el canal de IPC sin recortar primero: una
/// excepción deliberada y puntual, no el camino general (el resultado ya
/// recortado, mucho más pequeño, es lo que de verdad sube al servidor).
#[tauri::command]
fn read_image_as_data_url(path: String) -> Result<String, String> {
    let bytes = std::fs::read(&path).map_err(|e| format!("{path}: {e}"))?;
    let lower = path.to_lowercase();
    let mime = if lower.ends_with(".png") {
        "image/png"
    } else if lower.ends_with(".webp") {
        "image/webp"
    } else {
        "image/jpeg"
    };
    use base64::Engine;
    Ok(format!("data:{mime};base64,{}", base64::engine::general_purpose::STANDARD.encode(&bytes)))
}

/// Compartido por los tres comandos de perfil de abajo: el recorte ya
/// llega hecho desde el editor de recorte de TS (un `<canvas>` exportado a
/// JPEG y codificado en base64), así que aquí solo hace falta decodificarlo
/// y mandarlo como multipart a `url_path`.
async fn subir_bytes(url_path: &str, data_base64: &str, state: &Shared) -> Result<(), String> {
    let (base, client, token) = {
        let c = state.lock().unwrap();
        (
            c.base.clone().ok_or("sin servidor vinculado")?,
            c.client.clone().ok_or("sin cliente")?,
            c.token.clone().ok_or("sin sesión")?,
        )
    };
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data_base64)
        .map_err(|e| e.to_string())?;
    let form = reqwest::multipart::Form::new()
        .part("file", reqwest::multipart::Part::bytes(bytes).file_name("recorte.jpg"));
    let res = client
        .post(format!("{base}{url_path}"))
        .bearer_auth(token)
        .multipart(form)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if res.status().is_success() {
        Ok(())
    } else {
        Err(res.text().await.unwrap_or_default())
    }
}

#[tauri::command]
async fn upload_avatar_bytes(data_base64: String, state: tauri::State<'_, Shared>) -> Result<(), String> {
    subir_bytes("/v1/me/avatar", &data_base64, &state).await
}

#[tauri::command]
async fn upload_server_avatar_bytes(data_base64: String, state: tauri::State<'_, Shared>) -> Result<(), String> {
    subir_bytes("/v1/admin/server-profile/avatar", &data_base64, &state).await
}

#[tauri::command]
async fn upload_server_banner_bytes(data_base64: String, state: tauri::State<'_, Shared>) -> Result<(), String> {
    subir_bytes("/v1/admin/server-profile/banner", &data_base64, &state).await
}

/// URL del canal de actualizaciones (Plan 1 de la spec). Cliente `reqwest`
/// propio y NO el `PinnedVerifier` de arriba: eso habla con el servidor
/// `lumid` emparejado, esto habla con Vercel, que valida contra las CA del
/// sistema como cualquier sitio normal.
const VERSIONES_URL: &str = "https://lumi.s7lver.xyz/api/versiones";

#[derive(serde::Serialize)]
#[serde(tag = "tipo", rename_all = "lowercase")]
enum EstadoActualizacion {
    Disponible { version: String, notas: String, url: String },
    Retirada,
    Error { motivo: String },
}

async fn manifiesto_verificado() -> Result<lumi_proto::actualizacion::Manifiesto, String> {
    let manifiesto: lumi_proto::actualizacion::Manifiesto = reqwest::Client::new()
        .get(VERSIONES_URL)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;
    manifiesto.comprobar().map_err(|e| e.to_string())?;
    Ok(manifiesto)
}

/// `Err` significa "no se pudo comprobar" (sin red, manifiesto sin firmar o
/// con firma inválida) — el lado TS decide no pintar nada ante un error,
/// nunca una alarma. `Ok(None)` significa "se comprobó y no hay nada nuevo".
#[tauri::command]
async fn comprobar_actualizacion() -> Result<Option<EstadoActualizacion>, String> {
    let manifiesto = manifiesto_verificado().await?;

    let version_actual = env!("CARGO_PKG_VERSION");
    if manifiesto.version_retirada(lumi_proto::actualizacion::Producto::Cliente, version_actual) {
        return Ok(Some(EstadoActualizacion::Retirada));
    }
    let Some(publi) = manifiesto.mas_nueva(
        lumi_proto::actualizacion::Producto::Cliente,
        version_actual,
        "windows-x86_64",
    ) else {
        return Ok(None);
    };
    let url = publi
        .artefactos
        .iter()
        .find(|a| a.plataforma == "windows-x86_64")
        .map(|a| a.url.clone())
        .unwrap_or_default();
    Ok(Some(EstadoActualizacion::Disponible {
        version: publi.version.clone(),
        notas: publi.notas.clone(),
        url,
    }))
}

#[derive(serde::Serialize)]
struct PublicacionInfo {
    version: String,
    publicado: String,
    notas: String,
    retirada: bool,
}

/// Historial completo de publicaciones del cliente, más recientes primero
/// — a diferencia de `comprobar_actualizacion` (solo "¿hay algo nuevo?"),
/// esto es para la sección de Actualizaciones de Ajustes/Perfil, donde
/// tiene sentido ver qué cambió en cada versión, no solo la última.
#[tauri::command]
async fn historial_actualizaciones() -> Result<Vec<PublicacionInfo>, String> {
    let manifiesto = manifiesto_verificado().await?;
    let mut publicaciones: Vec<PublicacionInfo> = manifiesto
        .publicaciones
        .iter()
        .filter(|p| p.producto == lumi_proto::actualizacion::Producto::Cliente)
        .map(|p| PublicacionInfo {
            version: p.version.clone(),
            publicado: p.publicado.clone(),
            notas: p.notas.clone(),
            retirada: p.retirada,
        })
        .collect();
    publicaciones.sort_by(|a, b| b.publicado.cmp(&a.publicado));
    Ok(publicaciones)
}

/// La versión de este binario — la misma que ya se compara en `connect()`
/// contra `hello.version`, expuesta para pintarla en la barra de título.
#[tauri::command]
fn version_cliente() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

/// `true` solo cuando `installer.exe --silencioso` acaba de relanzar esta
/// app tras un downgrade/versión exacta (ver `silencioso.rs`) — la marca
/// vive en el entorno de este único proceso, nunca se guarda. Sin esto, el
/// chequeo normal de "¿hay algo más nuevo?" al arrancar deshacía el
/// downgrade en el acto.
#[tauri::command]
fn sin_autoactualizar_este_arranque() -> bool {
    std::env::var("LUMI_SIN_AUTOACTUALIZAR").is_ok()
}

/// Se llama una vez al arrancar (ver App.tsx) — si `installer.exe
/// --silencioso` dejó un error de la última actualización silenciosa, se
/// muestra aquí una sola vez (la lectura ya lo borra).
#[tauri::command]
fn error_actualizacion_pendiente() -> Option<String> {
    lumi_installer::bitacora::leer_y_borrar_marca_error("cliente").map(|e| e.motivo)
}

/// Cierra esta app y lanza `installer.exe --producto=cliente --silencioso`
/// con el PID propio, para que aplique `version_nueva` en segundo plano —
/// mismo binario que la instalación interactiva, sin ventana en este
/// camino. Vive junto al propio ejecutable — el instalador ya lo dejó ahí
/// en la instalación inicial (ver installer/src-tauri/src/comandos.rs).
#[tauri::command]
fn disparar_actualizacion_silenciosa(app: tauri::AppHandle, version_nueva: String) -> Result<(), String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let carpeta = exe.parent().ok_or("sin carpeta padre")?;
    let instalador = carpeta.join("installer.exe");
    let pid = std::process::id();
    let version_actual = env!("CARGO_PKG_VERSION");

    std::process::Command::new(instalador)
        .arg(format!("--producto=cliente"))
        .arg(format!("--pid={pid}"))
        .arg(format!("--version-actual={version_actual}"))
        .arg("--silencioso")
        .spawn()
        .map_err(|e| e.to_string())?;

    let _ = version_nueva; // informativo para quien lea el log; el camino --silencioso vuelve a resolver la version real contra el manifiesto
    app.exit(0);
    Ok(())
}

/// Mismo camino que `disparar_actualizacion_silenciosa`, pero para igualar
/// una versión concreta (downgrade, o la versión de un servidor que no es
/// la última publicada) en vez de "la más nueva". Ver
/// docs/superpowers/specs/2026-08-26-compatibilidad-de-version-design.md.
#[tauri::command]
fn disparar_actualizacion_a_version(app: tauri::AppHandle, version_objetivo: String) -> Result<(), String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let carpeta = exe.parent().ok_or("sin carpeta padre")?;
    let instalador = carpeta.join("installer.exe");
    let pid = std::process::id();

    std::process::Command::new(instalador)
        .arg("--producto=cliente")
        .arg(format!("--pid={pid}"))
        .arg(format!("--version-objetivo={version_objetivo}"))
        .arg("--silencioso")
        .spawn()
        .map_err(|e| e.to_string())?;

    app.exit(0);
    Ok(())
}

fn client_for(fingerprint: &str) -> Result<reqwest::Client, String> {
    let cfg = rustls::ClientConfig::builder()
        .dangerous()
        .with_custom_certificate_verifier(Arc::new(PinnedVerifier { fingerprint: fingerprint.into() }))
        .with_no_client_auth();
    reqwest::Client::builder()
        .use_preconfigured_tls(cfg)
        // Sin esto, un servidor que deja de responder a media petición
        // (reinicio a destiempo, red que se cae) cuelga el `.send().await`
        // para siempre: sin error, sin timeout, sin forma de recuperarse
        // desde la interfaz. El login se queda en "Entrando" indefinidamente
        // y nada libera al usuario de esa pantalla.
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())
}

async fn connect(addr: &str, fingerprint: &str, state: &Shared) -> Result<serde_json::Value, String> {
    let client = client_for(fingerprint)?;
    let base = format!("https://{addr}");
    let hello: lumi_proto::api::Hello = client
        .get(format!("{base}/v1/hello"))
        .send()
        .await
        .map_err(|e| format!("no se pudo conectar: {e}"))?
        .json()
        .await
        .map_err(|e| e.to_string())?;

    // El cliente HTTP se guarda ANTES de comprobar la versión, no después:
    // si hay desajuste, la pantalla de bloqueo todavía necesita poder hacer
    // `POST /v1/version-mismatch` a través de este mismo `state` (comando
    // `request`, que exige `state.base`/`state.client` ya puestos). El
    // pairing no se da por completado (no se guarda `hello` en el store de
    // TS), pero el transporte HTTP sí queda listo.
    {
        let mut c = state.lock().unwrap();
        c.base = Some(base);
        c.client = Some(client);
    }

    let propia = env!("CARGO_PKG_VERSION");
    if lumi_proto::actualizacion::comparar(&hello.version, propia) != std::cmp::Ordering::Equal {
        return Err(format!("version incompatible|{propia}|{}", hello.version));
    }

    serde_json::to_value(&hello).map_err(|e| e.to_string())
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
            // El stream terminó (fin limpio o un frame con error en medio —
            // `while let Some(Ok(chunk))` sale igual en los dos casos). Sin
            // esta pausa, reconectar aquí no tenía ningún freno: si el
            // daemon se reinicia o la conexión da un hipo, este bucle
            // reintentaba al instante, una y otra vez, sin el respiro de 2s
            // que ya tenía la rama de "ni siquiera conectó". Eso es lo que
            // hacía parpadear los avisos de destino "personas" — el único
            // tipo cuya visibilidad se vuelve a resolver en cada conexión
            // nueva de este SSE.
            let _ = app.emit("telemetry-down", ());
            tokio::time::sleep(std::time::Duration::from_secs(2)).await;
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

/// El SSE de instalar un índice, reemitido como evento de Tauri. Mismo
/// puente que `start_queue_events`: el webview no puede poner la cabecera de
/// autorización con `EventSource`, así que Rust hace la conexión de verdad y
/// TS solo escucha `indices-progress`.
#[tauri::command]
async fn start_indices_events(
    token: String, app: tauri::AppHandle, state: tauri::State<'_, Shared>,
) -> Result<(), String> {
    use futures_util::StreamExt;
    use tauri::Emitter;
    let (base, client) = {
        let c = state.lock().unwrap();
        (c.base.clone().ok_or("sin servidor")?, c.client.clone().ok_or("sin cliente")?)
    };
    tokio::spawn(async move {
        let Ok(res) = client.get(format!("{base}/v1/indices/eventos")).bearer_auth(&token).send().await else {
            let _ = app.emit("indices-down", ());
            return;
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
                        let _ = app.emit("indices-progress", v);
                    }
                }
            }
        }
        let _ = app.emit("indices-down", ());
    });
    Ok(())
}

/// Mismo puente que `start_indices_events`: el webview no puede autenticar
/// un `EventSource`, así que Rust hace la conexión real y TS solo escucha
/// `admin-events`.
#[tauri::command]
async fn start_admin_events(
    token: String, app: tauri::AppHandle, state: tauri::State<'_, Shared>,
) -> Result<(), String> {
    use futures_util::StreamExt;
    use tauri::Emitter;
    let (base, client) = {
        let c = state.lock().unwrap();
        (c.base.clone().ok_or("sin servidor")?, c.client.clone().ok_or("sin cliente")?)
    };
    tokio::spawn(async move {
        let Ok(res) = client.get(format!("{base}/v1/admin/events")).bearer_auth(&token).send().await else {
            return;
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
                        let _ = app.emit("admin-events", v);
                    }
                }
            }
        }
    });
    Ok(())
}

/// Mismo puente que `start_admin_events`, pero para `/v1/admin/logs/stream`.
/// A diferencia de los otros SSE, aquí el `data:` de cada frame es texto
/// plano (una línea de log), no JSON — así que se reenvía tal cual, y se
/// distingue el frame de error por su `event: error` para emitirlo aparte.
#[tauri::command]
async fn start_logs_stream(
    token: String, app: tauri::AppHandle, state: tauri::State<'_, Shared>,
) -> Result<(), String> {
    use futures_util::StreamExt;
    use tauri::Emitter;
    let (base, client) = {
        let c = state.lock().unwrap();
        (c.base.clone().ok_or("sin servidor")?, c.client.clone().ok_or("sin cliente")?)
    };
    tokio::spawn(async move {
        let Ok(res) = client.get(format!("{base}/v1/admin/logs/stream")).bearer_auth(&token).send().await else {
            let _ = app.emit("logs-down", ());
            return;
        };
        let mut stream = res.bytes_stream();
        let mut buf = String::new();
        while let Some(Ok(chunk)) = stream.next().await {
            buf.push_str(&String::from_utf8_lossy(&chunk));
            while let Some(i) = buf.find("\n\n") {
                let frame = buf[..i].to_string();
                buf.drain(..i + 2);
                let es_error = frame.lines().any(|l| l == "event: error");
                let dato: String = frame
                    .lines()
                    .filter_map(|l| l.strip_prefix("data: "))
                    .collect::<Vec<_>>()
                    .join("\n");
                if dato.is_empty() {
                    continue;
                }
                let _ = app.emit(if es_error { "logs-error" } else { "logs-line" }, dato);
            }
        }
        let _ = app.emit("logs-down", ());
    });
    Ok(())
}

fn main() {
    rustls::crypto::ring::default_provider().install_default().ok();
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
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
            // `.path()` a secas se comía la query string entera: cualquier ruta
            // de este esquema que dependiera de un parámetro (como el `?theme=`
            // de las vistas previas de mapa) llegaba al daemon sin él y volvía
            // vacía o con un 400, sin que hubiera ningún error visible más allá
            // de un lienzo en blanco.
            let path = request
                .uri()
                .path_and_query()
                .map(|pq| pq.as_str().to_string())
                .unwrap_or_else(|| request.uri().path().to_string());
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
            start_queue_events, start_indices_events, start_admin_events, start_logs_stream, set_auth,
            upload_images, read_image_as_data_url, upload_avatar_bytes, upload_server_avatar_bytes,
            upload_server_banner_bytes, comprobar_actualizacion, error_actualizacion_pendiente, disparar_actualizacion_silenciosa,
            disparar_actualizacion_a_version, version_cliente, historial_actualizaciones,
            sin_autoactualizar_este_arranque
        ])
        .run(tauri::generate_context!())
        .expect("error al arrancar Tauri");
}
