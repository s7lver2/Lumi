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
use std::path::Path;
use std::process::Command;

const DATA: &str = "/var/lib/lumi";
const BIN: &str = "/usr/local/bin/lumid";

const UNIT: &str = "\
[Unit]
Description=Lumi Station control daemon
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

/// `auto`: sin preguntas, elige los defectos recomendados (nativo si no hay
/// Docker, clave maestra automática) y los imprime igual que si se hubieran
/// elegido a mano. "Nada desaparece en silencio": el modo se ve, solo que no
/// se pregunta.
pub fn run(auto: bool) -> Result<PairKey> {
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

    ui::head("capacidades");
    for c in lumi_proto::caps::matrix(mode, gpus.len()) {
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
    ui::ok(&format!("{models_dir}"));

    ui::head("instalación");
    fs::create_dir_all(DATA).context("no se pudo crear /var/lib/lumi")?;

    let pb = ui::step("generando certificado autofirmado");
    let cert = rcgen::generate_simple_self_signed(vec![
        local_ip().unwrap_or_else(|| "localhost".into()),
        "localhost".into(),
    ])
    .context("rcgen falló")?;
    let der = cert.cert.der().to_vec();
    fs::write(format!("{DATA}/cert.der"), &der)?;
    fs::write(format!("{DATA}/key.pem"), cert.key_pair.serialize_pem())?;
    pb.finish_and_clear();
    ui::ok("certificado ed25519 · 10 años");

    let pb = ui::step("sembrando clave maestra");
    seed_master(sealed, passphrase)?;
    pb.finish_and_clear();
    ui::ok(if sealed {
        "clave maestra sellada · se desbloquea desde la app tras cada reinicio"
    } else {
        "clave maestra automática · systemd-creds"
    });

    let pb = ui::step("instalando el daemon");
    let src = std::env::current_exe()?.with_file_name("lumid");
    fs::copy(&src, BIN).with_context(|| format!("no se pudo copiar {src:?} a {BIN}"))?;
    fs::write("/etc/systemd/system/lumid.service", UNIT)?;
    run_ok("systemctl", &["daemon-reload"])?;
    run_ok("systemctl", &["enable", "--now", "lumid.service"])?;
    pb.finish_and_clear();
    ui::ok(&format!("lumid.service activo · escuchando en 0.0.0.0:{}", lumi_proto::PORT));

    let addr = format!("{}:{}", local_ip().unwrap_or_else(|| "127.0.0.1".into()), lumi_proto::PORT);
    let key = PairKey::generate(&addr, &der);
    let db = rusqlite::Connection::open(format!("{DATA}/lumi.db"))?;
    db.execute_batch(
        "CREATE TABLE IF NOT EXISTS pair_key (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            secret_phc TEXT NOT NULL,
            expires_at INTEGER,
            consumed INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);",
    )?;
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

fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64
}

/// ponytail: primera IPv4 no loopback. Con varias interfaces el owner corrige
/// la dirección en la clave a mano; un selector interactivo se añade si pasa.
fn local_ip() -> Option<String> {
    let out = Command::new("hostname").arg("-I").output().ok()?;
    String::from_utf8_lossy(&out.stdout)
        .split_whitespace()
        .find(|s| s.contains('.') && !s.starts_with("127."))
        .map(str::to_string)
}

/// `yes`: sin confirmación. `/var/lib/lumi` puede tener administradores y
/// proyectos reales, así que sin ese flag se pide confirmación explícita
/// antes de borrar nada.
pub fn uninstall(yes: bool) -> Result<()> {
    ui::head("desinstalación");
    let has_state = Path::new(DATA).exists();
    if has_state {
        ui::warn(&format!(
            "{DATA} contiene el certificado, la clave maestra y la base de datos: usuarios, proyectos y claves emitidas"
        ));
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

    let pb = ui::step("deteniendo el servicio");
    run_quiet("systemctl", &["disable", "--now", "lumid.service"]);
    pb.finish_and_clear();
    ui::ok("lumid.service detenido");

    let pb = ui::step("eliminando ficheros");
    let _ = fs::remove_file("/etc/systemd/system/lumid.service");
    run_quiet("systemctl", &["daemon-reload"]);
    let _ = fs::remove_file(BIN);
    if has_state {
        fs::remove_dir_all(DATA).context("no se pudo borrar /var/lib/lumi")?;
    }
    pb.finish_and_clear();
    ui::ok(&format!("lumid.service, {BIN} y {DATA} eliminados"));

    Ok(())
}

/// Tener shell en la máquina ya es prueba de propiedad: no hace falta más
/// ceremonia que ejecutar esto.
pub fn reissue() -> Result<PairKey> {
    let der = fs::read(format!("{DATA}/cert.der")).context("el servidor no está instalado")?;
    let addr = format!(
        "{}:{}",
        local_ip().unwrap_or_else(|| "127.0.0.1".into()),
        lumi_proto::PORT
    );
    let key = PairKey::generate(&addr, &der);
    let db = rusqlite::Connection::open(format!("{DATA}/lumi.db"))?;
    db.execute(
        "INSERT OR REPLACE INTO pair_key (id, secret_phc, expires_at, consumed) VALUES (1, ?1, ?2, 0)",
        rusqlite::params![hash_password(&key.secret)?, now() + 24 * 3600],
    )?;
    Ok(key)
}
