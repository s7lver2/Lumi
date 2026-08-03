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

pub fn run(mode: Mode, sealed: bool, passphrase: Option<&str>) -> Result<PairKey> {
    if !Path::new("/run/systemd/system").exists() {
        bail!("este host no usa systemd; instala en modo Docker o en una máquina con systemd");
    }

    ui::head("entorno");
    let e = detect::env();
    ui::ok(&format!("{} · {}", e.os, e.kernel));
    match &e.driver {
        Some(d) => ui::ok(&format!("driver NVIDIA {d}")),
        None => ui::warn("sin driver NVIDIA: el servidor arrancará, pero sin inferencia"),
    }
    if !e.port_free {
        bail!("el puerto {} ya está ocupado", lumi_proto::PORT);
    }
    if e.ufw_active {
        ui::warn("ufw activo: se añadirá la regla para el puerto");
        let _ = Command::new("ufw")
            .args(["allow", &format!("{}/tcp", lumi_proto::PORT)])
            .status();
    }

    ui::head("hardware");
    let gpus = detect::gpus();
    for g in &gpus {
        println!("  gpu{}  {}  {} MB  {}", g.index, g.name, g.vram_total_mb, g.pcie);
    }
    println!("  {}", detect::cpu_summary());

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
        );",
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
            .spawn()
            .context("systemd-creds no disponible")?;
        use std::io::Write;
        out.stdin.as_ref().context("stdin")?.write_all(mk.as_bytes())?;
        let st = out.wait_with_output()?;
        if !st.status.success() {
            bail!("systemd-creds encrypt falló");
        }
    }
    Ok(())
}

fn run_ok(cmd: &str, args: &[&str]) -> Result<()> {
    let st = Command::new(cmd).args(args).status()?;
    if !st.success() {
        bail!("{cmd} {} falló", args.join(" "));
    }
    Ok(())
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
