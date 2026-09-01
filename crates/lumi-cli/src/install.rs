//! Instalación: certificado autofirmado, unit de systemd, semilla de la clave
//! maestra y emisión de la clave de vinculación.
//!
//! Deja SOLO el daemon de control. Runtime de inferencia, base de datos y
//! modelos los instala el asistente desde la app: eso es lo que justifica el
//! runner de tareas del servidor.

use crate::{detect, ui};
use anyhow::{bail, Context, Result};
use lumi_proto::caps::{CapState, Mode};
use lumi_proto::crypto::{hash_password, MasterKey};
use lumi_proto::key::PairKey;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

pub const DATA: &str = "/var/lib/lumi";
const BIN: &str = "/usr/local/bin/lumid";

const UNIT: &str = "\
[Unit]
Description=Lumi control daemon
After=network-online.target
Wants=network-online.target

[Service]
ExecStart=/usr/local/bin/lumid
Restart=on-failure
RestartSec=3
User=root
StateDirectory=lumi
Environment=LUMI_DATA=/var/lib/lumi

[Install]
WantedBy=multi-user.target
";

/// Fijados a mano, no un ajuste: subir de versión es cambiar esta constante
/// y volver a calcular el sha256 del asset real, nunca copiarlo de una nota.
/// Igual que con cualquier otra firma en este sistema, no hay "instalar de
/// todas formas" si el hash no coincide.
const QDRANT_VERSION: &str = "v1.19.0";
const QDRANT_ASSET: &str = "qdrant-x86_64-unknown-linux-gnu.tar.gz";
const QDRANT_SHA256: &str = "e4405091f67d02f96fb941695ef8a6974e677632507ff7b04a3fcbb332ad9c19";
const QDRANT_DIR: &str = "/var/lib/lumi/qdrant";

const QDRANT_UNIT: &str = "\
[Unit]
Description=Qdrant vector database (Lumi)
After=network.target

[Service]
ExecStart=/var/lib/lumi/qdrant/qdrant
WorkingDirectory=/var/lib/lumi/qdrant
Restart=on-failure
RestartSec=3
User=root
Environment=QDRANT__STORAGE__STORAGE_PATH=/var/lib/lumi/qdrant/storage
Environment=QDRANT__SERVICE__HOST=127.0.0.1
Environment=QDRANT__TELEMETRY_DISABLED=true

[Install]
WantedBy=multi-user.target
";

/// `auto`: sin preguntas, elige los defectos recomendados (nativo si no hay
/// Docker, clave maestra automática) y los imprime igual que si se hubieran
/// elegido a mano. "Nada desaparece en silencio": el modo se ve, solo que no
/// se pregunta.
pub fn run(auto: bool, version: Option<&str>) -> Result<PairKey> {
    if !Path::new("/run/systemd/system").exists() {
        bail!("este host no usa systemd; instala en modo Docker o en una máquina con systemd");
    }

    ui::head("entorno");
    let e = detect::env();
    ui::ok(&format!("{} · {}", e.os, e.kernel));
    match &e.driver {
        Some(d) => ui::ok(&format!("driver NVIDIA {d}")),
        None => {
            ui::warn("sin driver NVIDIA: el servidor arrancará, pero sin inferencia");
            offer_driver_install(&e.kernel, auto)?;
        }
    }
    if !e.port_free {
        bail!("el puerto {} ya está ocupado", lumi_proto::PORT);
    }
    if e.ufw_active {
        ui::warn("ufw activo: se añadirá la regla para el puerto");
        run_quiet("ufw", &["allow", &format!("{}/tcp", lumi_proto::PORT)]);
    }

    ui::head("hardware");
    let gpus = detect::gpus();
    for g in &gpus {
        println!("  gpu{}  {}  {} MB  {}", g.index, g.name, g.vram_total_mb, g.pcie);
    }
    println!("  {}", detect::cpu_summary());

    let in_docker = Path::new("/.dockerenv").exists();
    ui::head("modo");
    let mode = if in_docker {
        // Ya se está ejecutando dentro de un contenedor: no hay elección real.
        println!("  {} docker   (detectado: /.dockerenv presente)", console::style("›").cyan());
        Mode::Docker
    } else if auto {
        println!("  {} nativo   (automático — recomendado)", console::style("›").cyan());
        Mode::Native
    } else {
        let opts = [
            ("nativo", "recomendado — sharding, offload, telemetría completa"),
            ("docker", "capacidades recortadas, ver más abajo"),
        ];
        if ui::choose("modo", &opts, 0)? == 0 { Mode::Native } else { Mode::Docker }
    };

    ui::head("clave maestra");
    let (sealed, passphrase) = if auto {
        println!("  {} automática   (systemd-creds · arranca sola tras reiniciar)", console::style("›").cyan());
        (false, None)
    } else {
        let opts = [
            ("automática", "arranca sola tras reiniciar"),
            ("sellada", "un admin desbloquea desde la app en cada arranque"),
        ];
        if ui::choose("clave maestra", &opts, 0)? == 0 {
            (false, None)
        } else {
            print!("  frase de desbloqueo: ");
            use std::io::Write;
            std::io::stdout().flush()?;
            let mut line = String::new();
            std::io::stdin().read_line(&mut line)?;
            let pw = line.trim().to_string();
            if pw.is_empty() {
                bail!("el modo sellado necesita una frase no vacía");
            }
            (true, Some(pw))
        }
    };
    let passphrase = passphrase.as_deref();

    ui::head("almacenamiento");
    let default_models_dir = format!("{DATA}/runtime");
    let models_dir = if auto {
        println!("  {} {default_models_dir}   (automático — recomendado)", console::style("›").cyan());
        default_models_dir
    } else {
        let input: String = dialoguer::Input::with_theme(&dialoguer::theme::ColorfulTheme::default())
            .with_prompt("dónde se descargarán el entorno de Python y los modelos")
            .default(default_models_dir.clone())
            .interact_text()?;
        let input = input.trim().to_string();
        if !input.starts_with('/') {
            bail!("la ruta debe ser absoluta (empezar por /)");
        }
        input
    };
    fs::create_dir_all(&models_dir)
        .with_context(|| format!("no se pudo crear {models_dir}: revisa permisos o espacio en disco"))?;
    ui::ok(&models_dir);

    ui::head("instalación");
    fs::create_dir_all(DATA).context("no se pudo crear /var/lib/lumi")?;

    // Ni el certificado ni la clave maestra se regeneran si ya existen —
    // esto es lo que hace seguro volver a correr `lumi install` sobre una
    // instalación real (para fijar otra versión de lumid, por ejemplo).
    // Regenerar el certificado cambia su huella y desempareja a todo
    // cliente que ya la tuviera pineada; regenerar la clave maestra deja
    // indescifrable cualquier dato sellado con la anterior. Ninguna de las
    // dos cosas se nota en el momento — el fallo aparece después, como
    // "se perdieron los servidores guardados" o peor.
    let ruta_cert = format!("{DATA}/cert.der");
    let pb = ui::step("certificado TLS");
    let der = if Path::new(&ruta_cert).exists() {
        pb.finish_and_clear();
        ui::ok("certificado existente conservado (no se reemparejan los clientes ya emparejados)");
        fs::read(&ruta_cert).context("no se pudo leer el certificado existente")?
    } else {
        let cert = rcgen::generate_simple_self_signed(vec![
            local_ip().unwrap_or_else(|| "localhost".into()),
            "localhost".into(),
        ])
        .context("rcgen falló")?;
        let der = cert.cert.der().to_vec();
        fs::write(&ruta_cert, &der)?;
        fs::write(format!("{DATA}/key.pem"), cert.key_pair.serialize_pem())?;
        pb.finish_and_clear();
        ui::ok("certificado ed25519 · 10 años (nuevo)");
        der
    };

    let ya_sembrada = Path::new(&format!("{DATA}/master.cred")).exists()
        || Path::new(&format!("{DATA}/master.salt")).exists();
    let pb = ui::step("clave maestra");
    if ya_sembrada {
        pb.finish_and_clear();
        ui::ok("clave maestra existente conservada (los datos sellados con ella siguen siendo legibles)");
    } else {
        seed_master(sealed, passphrase)?;
        pb.finish_and_clear();
        ui::ok(if sealed {
            "clave maestra sellada · se desbloquea desde la app tras cada reinicio (nueva)"
        } else {
            "clave maestra automática · systemd-creds (nueva)"
        });
    }

    let pb = ui::step("copiando registros/ y workers/");
    copiar_assets()?;
    pb.finish_and_clear();
    ui::ok("registros y workers copiados a /var/lib/lumi");

    let pb = ui::step("instalando el daemon");
    match version {
        Some(v) => descargar_lumid(v)?,
        None => {
            let src = std::env::current_exe()?.with_file_name("lumid");
            let bytes = fs::read(&src).with_context(|| format!("no se pudo leer {src:?}"))?;
            lumi_installer::aplicar::escribir_binario_atomico(Path::new(BIN), &bytes)
                .map_err(|e| anyhow::anyhow!(e.to_string()))
                .with_context(|| format!("no se pudo copiar {src:?} a {BIN}"))?;
        }
    }
    // Reinstalar conserva `/var/lib/lumi` (certificado, clave maestra,
    // registros) por diseño, pero un puerto de red personalizado desde una
    // vida anterior también sobrevivía a través de `meta` — y como la clave
    // que se emite más abajo SIEMPRE anuncia el puerto por defecto
    // (`lumi_proto::PORT`), esa combinación dejaba la clave recién impresa
    // apuntando a un puerto donde lumid ya no iba a escuchar tras
    // reiniciar. Se resetea ANTES de (re)arrancar el servicio, para que
    // arranque ya con el puerto por defecto y la clave coincida.
    if let Ok(db) = rusqlite::Connection::open(format!("{DATA}/lumi.db")) {
        let _ = db.execute("DELETE FROM meta WHERE k LIKE 'red\\_%' ESCAPE '\\'", []);
    }
    fs::write("/etc/systemd/system/lumid.service", UNIT)?;
    run_ok("systemctl", &["daemon-reload"])?;
    run_ok("systemctl", &["enable", "lumid.service"])?;
    // `enable --now` es idempotente respecto a "arrancar": si el servicio ya
    // estaba activo (reinstalar para fijar otra versión, el caso que
    // importa aquí), "arrancarlo" no hace nada — el proceso viejo se queda
    // en memoria con el binario viejo cargado, aunque el archivo en disco
    // ya sea el nuevo. `restart` sí lo relanza siempre, esté activo o no.
    run_ok("systemctl", &["restart", "lumid.service"])?;
    pb.finish_and_clear();
    ui::ok(&format!("lumid.service activo · escuchando en 0.0.0.0:{}", lumi_proto::PORT));

    let pb = ui::step("instalando Qdrant");
    let qdrant_vivo = instalar_qdrant()?;
    pb.finish_and_clear();
    if qdrant_vivo {
        ui::ok("qdrant.service activo · escuchando en 127.0.0.1:6333");
    } else {
        ui::warn("qdrant.service arrancó pero no responde todavía; revisa journalctl -u qdrant");
    }

    ui::head("capacidades");
    for c in lumi_proto::caps::matrix(mode, gpus.len(), qdrant_vivo, &lumi_proto::caps::HardwareCaps::default()) {
        match c.state {
            CapState::On => ui::ok(&c.label),
            _ => {
                ui::warn(&format!("{} · recortada", c.label));
                if let Some(r) = c.reason {
                    println!("      {r}");
                }
            }
        }
    }

    // lumid.service acaba de arrancar (paso anterior) y abre este mismo
    // fichero por su cuenta: sin busy_timeout, esta conexión puede llegar
    // a la vez y morir al instante con "database is locked" en vez de
    // esperar a que lumid termine su propio arranque (migraciones,
    // catálogo, detección de hardware...). 5s se quedaba corto en la
    // práctica; 30s da margen sin bloquear para siempre si algo real se
    // atasca.
    let db = rusqlite::Connection::open(format!("{DATA}/lumi.db"))?;
    db.busy_timeout(std::time::Duration::from_secs(30))?;
    db.execute_batch(
        "CREATE TABLE IF NOT EXISTS pair_key (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            secret_phc TEXT NOT NULL,
            expires_at INTEGER,
            consumed INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);",
    )?;
    let addr = format!("{}:{}", local_ip().unwrap_or_else(|| "127.0.0.1".into()), lumi_proto::PORT);
    let key = PairKey::generate(&addr, &der);
    let expires = if std::env::var("LUMI_NO_EXPIRY").is_ok() {
        None
    } else {
        Some(now() + 24 * 3600)
    };
    db.execute(
        "INSERT OR REPLACE INTO pair_key (id, secret_phc, expires_at, consumed) VALUES (1, ?1, ?2, 0)",
        rusqlite::params![hash_password(&key.secret)?, expires],
    )?;
    // lumid lo lee al lanzar la tarea de runtime en vez del venv fijo bajo
    // /var/lib/lumi: el owner puede querer los pesos en otro disco/volumen.
    db.execute(
        "INSERT OR REPLACE INTO meta (k, v) VALUES ('models_dir', ?1)",
        [&models_dir],
    )?;

    Ok(key)
}

/// Descarga y verifica una publicación de `lumid` del canal de
/// actualizaciones firmado (el mismo `lumi-installer` que usa el instalador
/// de Windows para cliente/Indexer) en vez de copiar el binario que ya
/// estuviera compilado junto a este `lumi` — para poder fijar una versión
/// concreta, o "latest" para la más reciente publicada.
fn descargar_lumid(version: &str) -> Result<()> {
    let manifiesto = lumi_installer::manifiesto::obtener_verificado()
        .map_err(|e| anyhow::anyhow!(e.to_string()))?;
    let encontrada = if version == "latest" {
        manifiesto.mas_nueva(lumi_proto::actualizacion::Producto::Lumid, "0.0.0", "linux-x86_64")
    } else {
        manifiesto.version_exacta(lumi_proto::actualizacion::Producto::Lumid, version, "linux-x86_64")
    };
    let publicacion = encontrada
        .ok_or_else(|| anyhow::anyhow!("no hay publicación de lumid para la versión {version}"))?
        .clone();

    lumi_installer::aplicar::aplicar_producto(&publicacion, "linux-x86_64", Path::new(BIN), |_| {})
        .map_err(|e| anyhow::anyhow!(e.to_string()))?;

    // `aplicar_producto` solo escribe los bytes — el bit de ejecución no
    // sobrevive a una copia genérica, y sin él `systemctl start` falla con
    // "Permission denied" sin más explicación.
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(BIN, fs::Permissions::from_mode(0o755))?;
    }
    Ok(())
}

/// Todo el histórico de `lumid` publicado, más reciente primero — para
/// `lumi install --listar-versiones`, saber qué pasarle a `--version` sin
/// tener que adivinar mirando el manifiesto a mano.
pub fn listar_versiones() -> Result<()> {
    let manifiesto = lumi_installer::manifiesto::obtener_verificado()
        .map_err(|e| anyhow::anyhow!(e.to_string()))?;
    let mut publicaciones: Vec<_> = manifiesto
        .publicaciones
        .iter()
        .filter(|p| p.producto == lumi_proto::actualizacion::Producto::Lumid)
        .filter(|p| p.artefactos.iter().any(|a| a.plataforma == "linux-x86_64"))
        .collect();
    publicaciones.sort_by(|a, b| b.publicado.cmp(&a.publicado));

    if publicaciones.is_empty() {
        println!("sin publicaciones de lumid todavía");
        return Ok(());
    }
    for p in publicaciones {
        let marca = if p.retirada { " (retirada)" } else { "" };
        println!("{:<10} {}{}", p.version, p.publicado, marca);
        if !p.notas.is_empty() {
            println!("           {}", p.notas);
        }
    }
    Ok(())
}

fn seed_master(sealed: bool, passphrase: Option<&str>) -> Result<()> {
    if sealed {
        let pw = passphrase.context("el modo sellado necesita una frase")?;
        let mut salt = [0u8; 16];
        rand::RngCore::fill_bytes(&mut rand::thread_rng(), &mut salt);
        // Solo se guarda la sal: la maestra se deriva en cada desbloqueo y
        // nunca toca el disco.
        fs::write(format!("{DATA}/master.salt"), salt)?;
        let _ = MasterKey::derive(pw, &salt)?; // valida que la derivación funciona
    } else {
        let mk = MasterKey::random();
        let path = format!("{DATA}/master.cred");
        let out = Command::new("systemd-creds")
            .args(["encrypt", "--name=lumi-master", "-", &path])
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .context("systemd-creds no disponible")?;
        use std::io::Write;
        out.stdin.as_ref().context("stdin")?.write_all(mk.as_bytes())?;
        let out = out.wait_with_output()?;
        if !out.status.success() {
            bail!(
                "systemd-creds encrypt falló: {}",
                String::from_utf8_lossy(&out.stderr).trim()
            );
        }
        // El aviso de "credential secret no está en medio cifrado" es
        // informativo, no un fallo: se descarta a propósito para no romper
        // la salida limpia del instalador.
    }
    Ok(())
}

/// Ofrece instalar el driver NVIDIA cuando falta. En WSL2 el driver vive en
/// Windows, no dentro de la distro: un paquete `nvidia-driver-*` aquí no
/// engancharía ninguna GPU real, así que en vez de ofrecer una instalación
/// que no haría nada se explica dónde instalarlo de verdad. `auto` nunca
/// pregunta: instalar un driver de kernel es una acción pesada (puede pedir
/// reinicio) y no entra en "los defectos recomendados sin preguntar".
fn offer_driver_install(kernel: &str, auto: bool) -> Result<()> {
    if detect::is_wsl(kernel) {
        ui::warn("WSL2 detectado: el driver se instala en Windows, no aquí");
        println!("      https://developer.nvidia.com/cuda/wsl · reinicia WSL después (wsl --shutdown)");
        return Ok(());
    }
    if auto {
        return Ok(());
    }
    if !detect::has_cmd("ubuntu-drivers") {
        ui::warn("sin ubuntu-drivers: instala el driver a mano para tu distribución");
        return Ok(());
    }
    let install_now = dialoguer::Confirm::with_theme(&dialoguer::theme::ColorfulTheme::default())
        .with_prompt("instalar el driver NVIDIA recomendado ahora (ubuntu-drivers autoinstall)")
        .default(false)
        .interact()
        .unwrap_or(false);
    if !install_now {
        return Ok(());
    }
    let pb = ui::step("instalando el driver NVIDIA");
    let out = Command::new("ubuntu-drivers").arg("autoinstall").output()?;
    pb.finish_and_clear();
    if !out.status.success() {
        ui::warn(&format!(
            "ubuntu-drivers autoinstall falló: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        ));
        return Ok(());
    }
    ui::ok("driver instalado · hace falta reiniciar la máquina para que cargue el módulo del kernel");
    Ok(())
}

/// Baja, verifica e instala Qdrant como su propia unidad systemd, y espera a
/// que responda antes de devolver el control. Idempotente: si el binario ya
/// está en su sitio no vuelve a descargar 30 MB por cada reinstalación.
/// Devuelve si al final quedó vivo — un fallo aquí no aborta la instalación
/// de Station entera, se enseña como capacidad recortada como cualquier otra.
fn instalar_qdrant() -> Result<bool> {
    fs::create_dir_all(format!("{QDRANT_DIR}/storage")).context("no se pudo crear el directorio de Qdrant")?;
    let bin = format!("{QDRANT_DIR}/qdrant");
    if !Path::new(&bin).exists() {
        let tarball = format!("{QDRANT_DIR}/{QDRANT_ASSET}");
        let url = format!(
            "https://github.com/qdrant/qdrant/releases/download/{QDRANT_VERSION}/{QDRANT_ASSET}"
        );
        run_ok("curl", &["-fsSL", "-o", &tarball, &url]).context("no se pudo descargar Qdrant")?;

        let bytes = fs::read(&tarball).context("no se pudo leer el tarball de Qdrant recién bajado")?;
        use sha2::{Digest, Sha256};
        let hash = format!("{:x}", Sha256::digest(&bytes));
        if hash != QDRANT_SHA256 {
            let _ = fs::remove_file(&tarball);
            bail!("el sha256 de Qdrant no coincide (esperado {QDRANT_SHA256}, obtenido {hash}) — nada se instala");
        }

        run_ok("tar", &["-xzf", &tarball, "-C", QDRANT_DIR]).context("no se pudo extraer Qdrant")?;
        let _ = fs::remove_file(&tarball);
    }

    fs::write("/etc/systemd/system/qdrant.service", QDRANT_UNIT)?;
    run_ok("systemctl", &["daemon-reload"])?;
    run_ok("systemctl", &["enable", "--now", "qdrant.service"])?;

    // Arrancar el proceso no es lo mismo que estar listo para servir: se
    // sondea /readyz un puñado de veces en vez de asumir que el primer
    // intento ya vale.
    for _ in 0..10 {
        std::thread::sleep(std::time::Duration::from_millis(500));
        if run_quiet_status("curl", &["-fsS", "-o", "/dev/null", "http://127.0.0.1:6333/readyz"]) {
            return Ok(true);
        }
    }
    Ok(false)
}

/// `registros/` y `workers/` no son parte del binario: son datos y scripts
/// de Python que `lumid` necesita leer en tiempo de ejecución. Como servicio
/// de systemd, su directorio de trabajo es `/` y no el checkout desde el que
/// se compiló, así que una ruta relativa a secas ("registros/niveles") nunca
/// encuentra nada — `crate::assets::ruta` (en `lumid`) ya sabe buscar aquí
/// primero. Se copian en CADA instalación, no solo la primera: así
/// `lumi install` después de un `git pull` deja el registro al día sin más
/// pasos, en vez de exigir acordarse de sincronizar algo a mano.
fn copiar_assets() -> Result<()> {
    let raiz = PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/../.."));
    for nombre in ["registros", "workers"] {
        let origen = raiz.join(nombre);
        if !origen.exists() {
            // No debería pasar en un checkout real; no es motivo para abortar
            // la instalación entera si de algún modo falta.
            continue;
        }
        copiar_dir_recursivo(&origen, &Path::new(DATA).join(nombre))
            .with_context(|| format!("no se pudo copiar {nombre}/ a {DATA}/{nombre}"))?;
    }
    Ok(())
}

fn copiar_dir_recursivo(origen: &Path, destino: &Path) -> Result<()> {
    fs::create_dir_all(destino)?;
    for entrada in fs::read_dir(origen)?.flatten() {
        let ruta = entrada.path();
        let destino_hijo = destino.join(entrada.file_name());
        if ruta.is_dir() {
            copiar_dir_recursivo(&ruta, &destino_hijo)?;
        } else {
            fs::copy(&ruta, &destino_hijo)?;
        }
    }
    Ok(())
}

fn run_ok(cmd: &str, args: &[&str]) -> Result<()> {
    let out = Command::new(cmd).args(args).output()?;
    if !out.status.success() {
        bail!("{cmd} {} falló: {}", args.join(" "), String::from_utf8_lossy(&out.stderr).trim());
    }
    Ok(())
}

/// Como `run_ok`, pero un fallo no aborta la instalación: se usa para pasos
/// de conveniencia (regla de ufw) que no son estrictamente necesarios.
fn run_quiet(cmd: &str, args: &[&str]) {
    let _ = Command::new(cmd).args(args).output();
}

/// Como `run_quiet`, pero devuelve si salió bien en vez de tragarse el
/// resultado — para sondeos donde el fallo es una respuesta válida, no un
/// error que reportar.
fn run_quiet_status(cmd: &str, args: &[&str]) -> bool {
    Command::new(cmd).args(args).output().is_ok_and(|o| o.status.success())
}

fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64
}

/// ponytail: primera IPv4 no loopback. Con varias interfaces el owner corrige
/// la dirección en la clave a mano; un selector interactivo se añade si pasa.
pub fn local_ip() -> Option<String> {
    let out = Command::new("hostname").arg("-I").output().ok()?;
    String::from_utf8_lossy(&out.stdout)
        .split_whitespace()
        .find(|s| s.contains('.') && !s.starts_with("127."))
        .map(str::to_string)
}

/// Igual que `lumid::red::direccion_publica`, pero por SQL directa: este
/// binario no enlaza con `lumid`. Si no hay ajuste guardado (servidor recién
/// instalado, o admin que nunca tocó "Red"), cae al mismo cálculo de
/// siempre: IP LAN + `lumi_proto::PORT`.
pub fn direccion_publica(db: &rusqlite::Connection) -> String {
    let leer = |k: &str| -> Option<String> {
        db.query_row("SELECT v FROM meta WHERE k = ?1", [k], |r| r.get(0)).ok()
    };
    let host = leer("red_public_host")
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| local_ip().unwrap_or_else(|| "127.0.0.1".into()));
    let port = leer("red_public_port")
        .and_then(|v| v.parse::<u16>().ok())
        .or_else(|| leer("red_bind_port").and_then(|v| v.parse().ok()))
        .unwrap_or(lumi_proto::PORT);
    format!("{host}:{port}")
}

/// El venv de inferencia (torch descargado, ~2 GB) vive bajo `models_dir`,
/// leído de la misma base que usó la instalación. Si no se puede leer, el
/// valor por defecto que puso `run` es la mejor suposición.
fn models_dir() -> PathBuf {
    rusqlite::Connection::open(format!("{DATA}/lumi.db"))
        .ok()
        .and_then(|c| c.query_row("SELECT v FROM meta WHERE k = 'models_dir'", [], |r| r.get::<_, String>(0)).ok())
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(format!("{DATA}/runtime")))
}

/// `yes`: sin confirmación. `/var/lib/lumi` puede tener administradores y
/// proyectos reales, así que sin ese flag se pide confirmación explícita
/// antes de borrar nada. `pip`: además de lo anterior, borra también el venv
/// con los paquetes ya descargados; sin esta flag se preserva, para no
/// forzar una descarga de ~2 GB en la siguiente instalación solo porque se
/// desinstaló para probar otra cosa.
pub fn uninstall(yes: bool, pip: bool) -> Result<()> {
    ui::head("desinstalación");
    let has_state = Path::new(DATA).exists();
    let runtime = models_dir();
    // Solo hay algo que preservar si el runtime vive DENTRO de DATA (el
    // caso por defecto, `{DATA}/runtime`): si el owner lo puso en otro
    // disco, borrar DATA nunca lo tocó y no hace falta ninguna excepción.
    let runtime_inside_data = has_state && runtime.starts_with(DATA);
    if has_state {
        ui::warn(&format!(
            "{DATA} contiene el certificado, la clave maestra y la base de datos: usuarios, proyectos y claves emitidas"
        ));
        if !pip {
            let where_ = if runtime_inside_data { "se conserva".to_string() } else { format!("en {}, no se toca", runtime.display()) };
            ui::warn(&format!("el runtime de inferencia (venv con torch ya descargado) {where_}: usa --pip para borrarlo también"));
        }
    } else {
        ui::warn(&format!("{DATA} no existe: puede que ya esté desinstalado"));
    }

    if !yes {
        let confirmed = dialoguer::Confirm::with_theme(&dialoguer::theme::ColorfulTheme::default())
            .with_prompt("borrar el servicio y todo su estado, sin poder deshacerlo")
            .default(false)
            .interact()
            .unwrap_or(false);
        if !confirmed {
            bail!("cancelado, nada se ha tocado");
        }
    }

    let pb = ui::step("deteniendo los servicios");
    run_quiet("systemctl", &["disable", "--now", "lumid.service"]);
    run_quiet("systemctl", &["disable", "--now", "qdrant.service"]);
    pb.finish_and_clear();
    ui::ok("lumid.service y qdrant.service detenidos");

    let pb = ui::step("eliminando ficheros");
    let _ = fs::remove_file("/etc/systemd/system/lumid.service");
    let _ = fs::remove_file("/etc/systemd/system/qdrant.service");
    run_quiet("systemctl", &["daemon-reload"]);
    let _ = fs::remove_file(BIN);
    if has_state {
        if pip || !runtime_inside_data {
            fs::remove_dir_all(DATA).context("no se pudo borrar /var/lib/lumi")?;
        } else {
            // Borra todo dentro de DATA salvo el subárbol del runtime.
            for entry in fs::read_dir(DATA).context("no se pudo leer /var/lib/lumi")? {
                let entry = entry?;
                if entry.path() == runtime {
                    continue;
                }
                if entry.path().is_dir() {
                    fs::remove_dir_all(entry.path())?;
                } else {
                    fs::remove_file(entry.path())?;
                }
            }
        }
        if pip && !runtime_inside_data {
            let _ = fs::remove_dir_all(&runtime);
        }
    }
    pb.finish_and_clear();
    let extra = if pip { ", runtime incluido" } else { "" };
    ui::ok(&format!("lumid.service, {BIN} y {DATA} eliminados{extra}"));

    Ok(())
}

/// Tener shell en la máquina ya es prueba de propiedad: no hace falta más
/// ceremonia que ejecutar esto.
pub fn reissue() -> Result<PairKey> {
    let der = fs::read(format!("{DATA}/cert.der")).context("el servidor no está instalado")?;
    // lumid.service está corriendo (esto es un reissue en caliente, no una
    // instalación) y tiene su propia conexión abierta al mismo fichero: el
    // mismo busy_timeout que en `run()`, misma razón.
    let db = rusqlite::Connection::open(format!("{DATA}/lumi.db"))?;
    db.busy_timeout(std::time::Duration::from_secs(30))?;
    let addr = direccion_publica(&db);
    let key = PairKey::generate(&addr, &der);
    db.execute(
        "INSERT OR REPLACE INTO pair_key (id, secret_phc, expires_at, consumed) VALUES (1, ?1, ?2, 0)",
        rusqlite::params![hash_password(&key.secret)?, now() + 24 * 3600],
    )?;
    Ok(key)
}
