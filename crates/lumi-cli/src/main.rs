mod detect;

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
    Install,
    /// Muestra el entorno y el hardware detectados
    Status,
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
        Cmd::Install => println!("pendiente: tarea 6"),
    }
    Ok(())
}
