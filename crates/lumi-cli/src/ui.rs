//! Salida de terminal. Spinner braille en la línea activa, check al
//! completar, barra de bloques para descargas. Solo se mueve la línea en
//! curso: lo terminado se queda quieto.

use console::style;
use indicatif::{ProgressBar, ProgressStyle};
use std::time::Duration;

const BRAILLE: &[&str] = &["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

pub fn step(label: &str) -> ProgressBar {
    let pb = ProgressBar::new_spinner();
    pb.set_style(
        ProgressStyle::with_template("  {spinner} {msg}")
            .unwrap()
            .tick_strings(BRAILLE),
    );
    pb.set_message(label.to_string());
    pb.enable_steady_tick(Duration::from_millis(72));
    pb
}

pub fn bar(label: &str, total: u64) -> ProgressBar {
    let pb = ProgressBar::new(total);
    pb.set_style(
        ProgressStyle::with_template(
            "  {msg}\n  {bar:40.cyan/black} {percent:>3}%  {bytes}/{total_bytes} · {binary_bytes_per_sec} · {eta}",
        )
        .unwrap()
        .progress_chars("██░"),
    );
    pb.set_message(label.to_string());
    pb
}

pub fn ok(msg: &str) {
    println!("  {} {msg}", style("✓").green());
}

pub fn warn(msg: &str) {
    println!("  {} {msg}", style("!").yellow());
}

/// Cabecera de sección con separador, como en el mockup: `── entorno ──…`.
const LINE_WIDTH: usize = 58;

pub fn head(title: &str) {
    let dashes = LINE_WIDTH.saturating_sub(title.chars().count() + 4);
    println!("\n{} {} {}", style("──").dim(), style(title).bold(), style("─".repeat(dashes)).dim());
}

/// Elección navegable con flechas ↑↓, Enter para confirmar. `dialoguer` ya
/// resuelve el modo crudo de terminal y el redibujado; no hace falta
/// reinventar la lectura de teclado. Si la terminal no soporta modo crudo
/// (pipe, CI), cae a `default` en vez de fallar la instalación entera.
pub fn choose(options: &[(&str, &str)], default: usize) -> std::io::Result<usize> {
    let items: Vec<String> = options
        .iter()
        .map(|(label, hint)| {
            if hint.is_empty() {
                (*label).to_string()
            } else {
                format!("{label}   {}", style(hint).dim())
            }
        })
        .collect();
    dialoguer::Select::with_theme(&dialoguer::theme::ColorfulTheme::default())
        .items(&items)
        .default(default)
        .interact_opt()
        .map(|sel| sel.unwrap_or(default))
        .or_else(|_| {
            warn("terminal sin modo interactivo: se usa el defecto recomendado");
            Ok(default)
        })
}
