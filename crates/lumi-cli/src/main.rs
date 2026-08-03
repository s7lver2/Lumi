mod detect;
mod install;
mod ui;

use clap::{Parser, Subcommand};

#[derive(Parser)]
#[command(name = "lumi", version, about = "Servidor Lumi Station")]
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
    },
    /// Detiene el servicio y borra el binario y todo su estado en /var/lib/lumi
    Uninstall {
        /// Sin confirmación
        #[arg(short = 'y', long)]
        yes: bool,
    },
    /// Muestra el entorno y el hardware detectados
    Status,
    /// Revoca la clave anterior y emite otra
    Key {
        #[command(subcommand)]
        action: KeyAction,
    },
}

#[derive(Subcommand)]
enum KeyAction {
    Reissue,
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
        Cmd::Install { yes } => {
            let key = install::run(yes)?;
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
        Cmd::Uninstall { yes } => install::uninstall(yes)?,
        Cmd::Key { action: KeyAction::Reissue } => {
            let key = install::reissue()?;
            println!("\n  {key}\n");
        }
    }
    Ok(())
}
