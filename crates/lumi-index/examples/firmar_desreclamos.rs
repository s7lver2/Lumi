//! Generar la clave que firma `web/releases/desreclamos.json`, y firmar un
//! borrador de lista. Mismo patrón que `lumi actualizaciones generar-clave`/
//! `firmar` en `crates/lumi-cli/src/firmar.rs`, pero para el Indexer: la
//! clave privada no sale nunca de esta máquina — no se sube a Vercel ni se
//! commitea al repo.
//!
//! Uso:
//!   cargo run -p lumi-index --example firmar_desreclamos -- generar-clave
//!   cargo run -p lumi-index --example firmar_desreclamos -- fusionar-pendientes <borrador.json>
//!   cargo run -p lumi-index --example firmar_desreclamos -- firmar <borrador.json> <salida.json>
//!   cargo run -p lumi-index --example firmar_desreclamos -- vigilar [--intervalo-min N]
//!
//! El borrador es un JSON de la forma `{"lista":[["paquete","motivo"], ...]}`.
//!
//! `fusionar-pendientes`/`firmar` son la fase 3 de la liberación de teselas
//! (BUG_BOUNTY #38), a mano: descargar la cola, revisar el borrador, firmar,
//! comitear. `vigilar` es la fase 4: automatiza ese mismo trabajo mecánico
//! sin tocar la invariante de seguridad -- la clave privada nunca sale de
//! esta máquina, solo que ahora el bucle de "mirar si hay algo aprobado,
//! firmarlo, publicarlo" lo corre este proceso en vez de las manos del
//! operador. Deja corriendo `vigilar` en tu propio equipo (o un Pi, o un
//! servidor tuyo) y las liberaciones aprobadas en `/admin` se firman y
//! publican solas; `fusionar-pendientes`/`firmar` siguen aquí para quien
//! prefiera decidir cada firma a mano.

use std::path::PathBuf;

use ed25519_dalek::SigningKey;
use lumi_index::desreclamos::Desreclamos;

/// La cola pendiente que escribe `web/app/api/desreclamos/solicitar/route.ts`
/// y que decide `web/app/api/admin/liberaciones/[paquete]/route.ts`. Mismo
/// shape que `EntradaPendiente` en `web/lib/liberaciones.ts`. `estado`
/// ausente significa "pendiente" en ambos lados — la solicitud original
/// nunca lo escribe, y solo el panel admin lo pone a "aprobada"/"rechazada".
#[derive(serde::Deserialize, serde::Serialize, Clone)]
struct EntradaPendiente {
    paquete: String,
    quadkeys: Vec<String>,
    cuenta: String,
    fecha: String,
    #[serde(default)]
    estado: Option<String>,
}

impl EntradaPendiente {
    fn aprobada(&self) -> bool {
        self.estado.as_deref() == Some("aprobada")
    }
}

const URL_PENDIENTES: &str =
    "https://raw.githubusercontent.com/s7lver2/Lumi/main/web/releases/liberaciones-pendientes.json";

fn home_dir() -> PathBuf {
    std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .map(PathBuf::from)
        .expect("no se pudo determinar el directorio personal (falta HOME/USERPROFILE)")
}

fn ruta_clave() -> PathBuf {
    home_dir().join(".lumi-indexer").join("desreclamos.key")
}

fn generar_clave() {
    let ruta = ruta_clave();
    if ruta.exists() {
        panic!(
            "ya existe una clave en {} — bórrala a mano si de verdad quieres una nueva \
             (rotar invalida todo lo firmado con la anterior)",
            ruta.display()
        );
    }
    std::fs::create_dir_all(ruta.parent().unwrap()).unwrap();
    let secreta = SigningKey::generate(&mut rand::rngs::OsRng);
    std::fs::write(&ruta, secreta.to_bytes()).unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&ruta, std::fs::Permissions::from_mode(0o600)).unwrap();
    }
    let publica = secreta.verifying_key();
    println!("clave privada escrita en {}", ruta.display());
    println!();
    println!("pega esto en crates/lumi-index/src/desreclamos.rs, reemplazando CLAVE_PUBLICA:");
    println!();
    print!("pub const CLAVE_PUBLICA: [u8; 32] = [");
    for (i, b) in publica.to_bytes().iter().enumerate() {
        if i > 0 {
            print!(", ");
        }
        print!("{b}");
    }
    println!("];");
}

/// Reintenta la escritura hasta 5 veces con una pequeña espera entre
/// intentos: en Windows, un antivirus escaneando o OneDrive sincronizando
/// el fichero de salida devuelve `os error 1920` (bloqueo transitorio) en
/// vez de un fallo real, y no merece morir con panic a la primera.
fn escribir_con_reintentos(ruta: &std::path::Path, contenido: &str) {
    let mut ultimo_error = None;
    for intento in 1..=5 {
        match std::fs::write(ruta, contenido) {
            Ok(()) => return,
            Err(e) => {
                ultimo_error = Some(e);
                if intento < 5 {
                    std::thread::sleep(std::time::Duration::from_millis(300));
                }
            }
        }
    }
    panic!(
        "no se pudo escribir {} tras varios intentos — ¿está abierto en otro programa o \
         sincronizándose? cierra ese programa y reintenta ({})",
        ruta.display(),
        ultimo_error.unwrap()
    );
}

fn cargar_clave() -> SigningKey {
    let ruta = ruta_clave();
    let bytes = std::fs::read(&ruta).unwrap_or_else(|_| {
        panic!("no se pudo leer {} — ejecuta antes 'generar-clave'", ruta.display())
    });
    let arr: [u8; 32] = bytes.try_into().expect("la clave no mide 32 bytes");
    SigningKey::from_bytes(&arr)
}

// ---------------------------------------------------------- vigilar --
//
// A diferencia de `fusionar-pendientes`/`firmar` (offline, sobre ficheros
// locales, sin credenciales de escritura), `vigilar` necesita comitear al
// repo por sí sola -- por eso hace falta un token de GitHub aparte, con
// permiso de escritura sobre ESTE repo. Es un secreto local más, igual que
// `desreclamos.key`: nunca en el repo, nunca en Vercel. Se lee de la
// variable de entorno si está (cómoda para probar), y si no de un fichero
// junto a la clave -- para dejar `vigilar` corriendo de fondo sin depender
// de que la variable siga puesta en esa sesión de terminal.

const REPO: &str = "s7lver2/Lumi";
const RUTA_PENDIENTES: &str = "web/releases/liberaciones-pendientes.json";
const RUTA_DESRECLAMOS: &str = "web/releases/desreclamos.json";

fn ruta_token_push() -> PathBuf {
    home_dir().join(".lumi-indexer").join("github-push.token")
}

fn token_push() -> String {
    if let Ok(t) = std::env::var("LUMI_GITHUB_PUSH_TOKEN") {
        if !t.trim().is_empty() {
            return t.trim().to_string();
        }
    }
    let ruta = ruta_token_push();
    std::fs::read_to_string(&ruta)
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| {
            panic!(
                "falta un token de GitHub con permiso de escritura sobre {REPO} -- \
                 crea uno (classic, scope 'repo' o 'public_repo') en \
                 https://github.com/settings/tokens y ponlo en la variable de entorno \
                 LUMI_GITHUB_PUSH_TOKEN, o guárdalo en {} (una sola línea, sin comillas)",
                ruta.display()
            )
        })
}

/// Contenido y `sha` actuales de un fichero del repo, vía la API de
/// contenidos de GitHub -- el mismo `sha` hay que devolverlo en el `PUT`
/// para que GitHub sepa que no se está pisando un cambio que no se ha visto.
struct ContenidoRepo {
    texto: String,
    sha: String,
}

fn leer_contenido(token: &str, ruta: &str) -> Result<ContenidoRepo, String> {
    #[derive(serde::Deserialize)]
    struct Resp {
        content: String,
        sha: String,
    }
    let url = format!("https://api.github.com/repos/{REPO}/contents/{ruta}");
    let r = ureq::get(&url)
        .set("authorization", &format!("Bearer {token}"))
        .set("user-agent", "lumi-vigilar")
        .set("accept", "application/vnd.github+json")
        .call()
        .map_err(|e| format!("no se pudo leer {ruta}: {e}"))?;
    let resp: Resp = r.into_json().map_err(|e| format!("{ruta}: respuesta inesperada: {e}"))?;
    use base64::{engine::general_purpose::STANDARD, Engine};
    let bytes = STANDARD
        .decode(resp.content.replace('\n', ""))
        .map_err(|e| format!("{ruta}: contenido no es base64 válido: {e}"))?;
    let texto = String::from_utf8(bytes).map_err(|e| format!("{ruta}: no es UTF-8: {e}"))?;
    Ok(ContenidoRepo { texto, sha: resp.sha })
}

fn escribir_contenido(token: &str, ruta: &str, sha: &str, contenido: &str, mensaje: &str) -> Result<(), String> {
    use base64::{engine::general_purpose::STANDARD, Engine};
    let url = format!("https://api.github.com/repos/{REPO}/contents/{ruta}");
    let cuerpo = serde_json::json!({
        "message": mensaje,
        "content": STANDARD.encode(contenido),
        "sha": sha,
    });
    ureq::put(&url)
        .set("authorization", &format!("Bearer {token}"))
        .set("user-agent", "lumi-vigilar")
        .set("accept", "application/vnd.github+json")
        .send_json(cuerpo)
        .map_err(|e| format!("no se pudo escribir {ruta}: {e}"))?;
    Ok(())
}

/// Una pasada: mira si hay algo aprobado que aún no esté en
/// `desreclamos.json`, lo firma, lo publica, y limpia esas entradas de la
/// cola. Nunca toca lo pendiente ni lo rechazado -- solo lo que el panel
/// admin ya decidió. Cualquier fallo de red o de la API se propaga como
/// `Err` para que `vigilar` lo registre y reintente en la siguiente pasada,
/// nunca para que el proceso entero muera por un fallo transitorio.
fn pasada(token: &str, secreta: &SigningKey) -> Result<(), String> {
    let pendientes_raw = leer_contenido(token, RUTA_PENDIENTES)?;
    let pendientes: Vec<EntradaPendiente> = serde_json::from_str(&pendientes_raw.texto)
        .map_err(|e| format!("{RUTA_PENDIENTES} no es una cola válida: {e}"))?;

    let desreclamos_raw = leer_contenido(token, RUTA_DESRECLAMOS)?;
    let mut actual: Desreclamos = serde_json::from_str(&desreclamos_raw.texto)
        .map_err(|e| format!("{RUTA_DESRECLAMOS} no es un documento válido: {e}"))?;
    let ya: std::collections::HashSet<String> = actual.lista.iter().map(|(p, _)| p.clone()).collect();

    let nuevas: Vec<&EntradaPendiente> =
        pendientes.iter().filter(|p| p.aprobada() && !ya.contains(&p.paquete)).collect();
    if nuevas.is_empty() {
        println!("[vigilar] nada nuevo que firmar");
        return Ok(());
    }

    for p in &nuevas {
        let motivo = format!(
            "liberación aprobada en /admin -- pedida por {} el {} ({} teselas)",
            p.cuenta,
            p.fecha,
            p.quadkeys.len()
        );
        actual.lista.push((p.paquete.clone(), motivo));
    }
    actual.firmar(secreta);
    let paquetes: Vec<String> = nuevas.iter().map(|p| p.paquete.clone()).collect();
    escribir_contenido(
        token,
        RUTA_DESRECLAMOS,
        &desreclamos_raw.sha,
        &serde_json::to_string_pretty(&actual).unwrap(),
        &format!("firma automática: {}", paquetes.join(", ")),
    )?;

    // Se relee la cola justo antes de escribirla, con su `sha` fresco --
    // pudo cambiar entre la lectura de arriba y este punto (alguien decidió
    // otra solicitud en `/admin` mientras tanto). Solo se quitan las que
    // esta pasada acaba de firmar; cualquier otra decisión reciente se
    // conserva tal cual.
    let pendientes_raw2 = leer_contenido(token, RUTA_PENDIENTES)?;
    let mut pendientes2: Vec<EntradaPendiente> = serde_json::from_str(&pendientes_raw2.texto)
        .map_err(|e| format!("{RUTA_PENDIENTES} no es una cola válida: {e}"))?;
    pendientes2.retain(|p| !paquetes.contains(&p.paquete));
    escribir_contenido(
        token,
        RUTA_PENDIENTES,
        &pendientes_raw2.sha,
        &serde_json::to_string_pretty(&pendientes2).unwrap(),
        &format!("liberaciones firmadas: {}", paquetes.join(", ")),
    )?;

    println!("[vigilar] firmadas {} liberación(es): {}", paquetes.len(), paquetes.join(", "));
    Ok(())
}

fn vigilar(intervalo_min: u64) {
    let token = token_push();
    let secreta = cargar_clave();
    println!("[vigilar] arrancando, comprobando cada {intervalo_min} min -- Ctrl+C para parar");
    loop {
        if let Err(e) = pasada(&token, &secreta) {
            eprintln!("[vigilar] fallo en esta pasada, se reintenta en la siguiente: {e}");
        }
        std::thread::sleep(std::time::Duration::from_secs(intervalo_min * 60));
    }
}

/// Trae la cola pendiente y añade al borrador las que el panel admin ya
/// aprobó (`estado == "aprobada"`; ausente o "pendiente"/"rechazada" NO se
/// trae — antes de que existiera el panel esta función traía todo lo que no
/// estuviera ya en el borrador, así que ahora la aprobación humana en
/// `/admin` es la puerta real, no una revisión posterior a mano), sin
/// duplicar un `paquete` que el borrador ya trae (ya fusionado en una pasada
/// anterior, o añadido a mano por el operador). El motivo se compone solo,
/// con la cuenta y la fecha de la solicitud, para que quede rastro de quién
/// la pidió sin tener que ir a buscarlo.
fn fusionar_pendientes(borrador: &std::path::Path) {
    let texto = std::fs::read_to_string(borrador)
        .unwrap_or_else(|e| panic!("no se pudo leer {}: {e}", borrador.display()));
    let mut d: Desreclamos = serde_json::from_str(&texto)
        .unwrap_or_else(|e| panic!("{} no es un borrador válido: {e}", borrador.display()));

    let pendientes: Vec<EntradaPendiente> = ureq::get(URL_PENDIENTES)
        .call()
        .unwrap_or_else(|e| panic!("no se pudo descargar {URL_PENDIENTES}: {e}"))
        .into_json()
        .unwrap_or_else(|e| panic!("{URL_PENDIENTES} no es una cola de pendientes válida: {e}"));

    let ya_en_borrador: std::collections::HashSet<String> =
        d.lista.iter().map(|(paquete, _)| paquete.clone()).collect();

    let mut añadidos = 0;
    let mut saltados = 0;
    for p in &pendientes {
        if !p.aprobada() || ya_en_borrador.contains(&p.paquete) {
            saltados += 1;
            continue;
        }
        let motivo = format!(
            "liberación pedida por {} el {} ({} teselas)",
            p.cuenta,
            p.fecha,
            p.quadkeys.len()
        );
        d.lista.push((p.paquete.clone(), motivo));
        añadidos += 1;
    }

    escribir_con_reintentos(borrador, &serde_json::to_string_pretty(&d).unwrap());
    println!(
        "fusionadas {añadidos} solicitudes pendientes en {} ({saltados} ya estaban)",
        borrador.display()
    );
    if añadidos > 0 {
        println!(
            "revisa {} a mano antes de firmar, y no olvides vaciar \
             web/releases/liberaciones-pendientes.json y comitearlo junto \
             con la salida firmada cuando termines",
            borrador.display()
        );
    }
}

fn firmar(borrador: &std::path::Path, salida: &std::path::Path) {
    let texto = std::fs::read_to_string(borrador)
        .unwrap_or_else(|e| panic!("no se pudo leer {}: {e}", borrador.display()));
    let mut d: Desreclamos = serde_json::from_str(&texto)
        .unwrap_or_else(|e| panic!("{} no es un borrador válido: {e}", borrador.display()));
    d.firmar(&cargar_clave());
    let salida_texto = serde_json::to_string_pretty(&d).unwrap();
    escribir_con_reintentos(salida, &salida_texto);
    println!("firmado: {} ({} entradas)", salida.display(), d.lista.len());
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    match args.get(1).map(String::as_str) {
        Some("generar-clave") => generar_clave(),
        Some("fusionar-pendientes") => {
            let borrador = args.get(2).expect("falta <borrador.json>");
            fusionar_pendientes(std::path::Path::new(borrador));
        }
        Some("firmar") => {
            let borrador = args.get(2).expect("falta <borrador.json>");
            let salida = args.get(3).expect("falta <salida.json>");
            firmar(std::path::Path::new(borrador), std::path::Path::new(salida));
        }
        Some("vigilar") => {
            let intervalo_min = args
                .iter()
                .position(|a| a == "--intervalo-min")
                .and_then(|i| args.get(i + 1))
                .and_then(|s| s.parse::<u64>().ok())
                .unwrap_or(15);
            vigilar(intervalo_min);
        }
        _ => {
            eprintln!(
                "uso: firmar_desreclamos generar-clave \
                 | fusionar-pendientes <borrador.json> \
                 | firmar <borrador.json> <salida.json> \
                 | vigilar [--intervalo-min N]"
            );
            std::process::exit(1);
        }
    }
}
