mod admin;
mod detect;
mod firmar;
mod install;
mod ui;

use clap::{Parser, Subcommand};
use std::path::PathBuf;

#[derive(Parser)]
#[command(name = "lumi", version, about = "Servidor Lumi")]
struct Cli {
    #[command(subcommand)]
    cmd: Cmd,
}

#[derive(Subcommand)]
enum Cmd {
    /// Instala el daemon y emite la clave de vinculación
    Install {
        /// Sin preguntas: modo nativo y clave maestra automática, los
        /// defectos recomendados. Se imprimen igual, solo que no se piden.
        #[arg(short = 'y', long)]
        yes: bool,
        /// Versión exacta de lumid a descargar del canal de actualizaciones
        /// firmado, en vez del binario ya compilado junto a este `lumi`
        /// (comportamiento por defecto, sin red). "latest" para la más
        /// reciente publicada.
        #[arg(long)]
        version: Option<String>,
        /// Imprime las versiones de lumid publicadas y termina, sin
        /// instalar nada.
        #[arg(long)]
        listar_versiones: bool,
    },
    /// Detiene el servicio y borra el binario y todo su estado en /var/lib/lumi
    Uninstall {
        /// Sin confirmación
        #[arg(short = 'y', long)]
        yes: bool,
        /// Borra también el venv de inferencia (torch ya descargado). Sin
        /// esta flag se conserva, para no forzar una descarga de ~2 GB en
        /// la siguiente instalación.
        #[arg(long)]
        pip: bool,
    },
    /// Muestra el entorno y el hardware detectados
    Status,
    /// Revoca la clave anterior y emite otra
    Key {
        #[command(subcommand)]
        action: KeyAction,
    },
    /// Imprime la tarjeta pública del servidor: lo que se reparte al equipo
    Card,
    /// Escotilla de emergencia sobre cuentas, desde el host
    Admin {
        #[command(subcommand)]
        action: AdminAction,
    },
    /// Firma del manifiesto de versiones (web/releases/versiones.json)
    Actualizaciones {
        #[command(subcommand)]
        action: ActualizacionAction,
    },
}

#[derive(Subcommand)]
enum KeyAction {
    Reissue,
}

#[derive(Subcommand)]
enum AdminAction {
    /// Genera una contraseña temporal y exige el cambio al entrar
    ResetPassword { username: String },
    /// Levanta el bloqueo de una cuenta
    Unblock { username: String },
    /// Lista las solicitudes de acceso
    Requests,
    /// Abre o cierra la aceptación de nuevas solicitudes de acceso
    AcceptRequests { on: String },
}

#[derive(Subcommand)]
enum ActualizacionAction {
    /// Genera la clave Ed25519 que firma releases y la guarda en ~/.lumi/release.key
    GenerarClave,
    /// Firma un borrador de manifiesto y escribe el resultado firmado
    Firmar { borrador: PathBuf, salida: PathBuf },
}

fn main() -> anyhow::Result<()> {
    match Cli::parse().cmd {
        Cmd::Status => {
            let e = detect::env();
            println!("{} · {}", e.os, e.kernel);
            println!("systemd  {}", e.systemd.as_deref().unwrap_or("ausente"));
            println!("driver   {}", e.driver.as_deref().unwrap_or("ausente"));
            println!("disco    {} MB libres", e.disk_free_mb);
            println!("puerto   {}", if e.port_free { "libre" } else { "ocupado" });
            for g in detect::gpus() {
                println!("gpu{}  {}  {} MB  {}", g.index, g.name, g.vram_total_mb, g.pcie);
            }
            println!("{}", detect::cpu_summary());
        }
        Cmd::Install { yes, version, listar_versiones } => {
            if listar_versiones {
                return install::listar_versiones();
            }
            let key = install::run(yes, version.as_deref())?;
            println!();
            println!("  ────────────────────────────────────────────────────────");
            println!("  Clave de vinculación · un solo uso · caduca en 24 h");
            println!();
            println!("  {key}");
            println!();
            println!("  Solo se muestra ahora. El servidor guarda su hash.");
            println!("  Perdida: lumi key reissue");
            println!("  ────────────────────────────────────────────────────────");
        }
        Cmd::Uninstall { yes, pip } => install::uninstall(yes, pip)?,
        Cmd::Key { action: KeyAction::Reissue } => {
            let key = install::reissue()?;
            println!("\n  {key}\n");
        }
        Cmd::Card => {
            let card = admin::card()?;
            println!();
            println!("  ────────────────────────────────────────────────────────");
            println!("  Tarjeta del servidor · pública · no caduca");
            println!();
            println!("  {card}");
            println!();
            println!("  Repártela al equipo. No es un secreto: sirve para que");
            println!("  cualquiera conecte verificado y pida acceso.");
            println!("  ────────────────────────────────────────────────────────");
        }
        Cmd::Admin { action } => match action {
            AdminAction::ResetPassword { username } => {
                let temp = admin::reset_password(&username)?;
                println!("\n  contraseña temporal de {username}: {temp}");
                println!("  Se pedirá cambiarla al entrar. Solo se muestra ahora.\n");
            }
            AdminAction::Unblock { username } => {
                admin::unblock(&username)?;
                println!("\n  {username} desbloqueado\n");
            }
            AdminAction::Requests => admin::requests()?,
            AdminAction::AcceptRequests { on } => {
                let on = match on.as_str() {
                    "on" => true,
                    "off" => false,
                    _ => anyhow::bail!("usa 'on' o 'off'"),
                };
                admin::accept(on)?;
                println!("\n  solicitudes de acceso: {}\n", if on { "abiertas" } else { "cerradas" });
            }
        },
        Cmd::Actualizaciones { action } => match action {
            ActualizacionAction::GenerarClave => firmar::generar_clave()?,
            ActualizacionAction::Firmar { borrador, salida } => firmar::firmar(&borrador, &salida)?,
        },
    }
    Ok(())
}
