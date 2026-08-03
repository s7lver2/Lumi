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

/// Elección con valor por defecto marcado con `›`, igual que "modo" y "clave
/// maestra" en el mockup. Enter acepta el defecto; también admite escribir la
/// etiqueta o el número. Reintenta en caso de entrada inválida.
pub fn choose(options: &[(&str, &str)], default: usize) -> std::io::Result<usize> {
    loop {
        for (i, (label, hint)) in options.iter().enumerate() {
            let marker = if i == default { style("›").cyan() } else { style(" ").dim() };
            let hint = if hint.is_empty() { String::new() } else { format!("   {}", style(hint).dim()) };
            println!("  {marker} {label}{hint}");
        }
        print!("  elige [1-{}] · Enter = {}: ", options.len(), options[default].0);
        use std::io::Write;
        std::io::stdout().flush()?;
        let mut line = String::new();
        std::io::stdin().read_line(&mut line)?;
        let input = line.trim();
        if input.is_empty() {
            return Ok(default);
        }
        if let Ok(n) = input.parse::<usize>() {
            if n >= 1 && n <= options.len() {
                return Ok(n - 1);
            }
        }
        if let Some(i) = options.iter().position(|(label, _)| label.eq_ignore_ascii_case(input)) {
            return Ok(i);
        }
        warn("opción no reconocida, inténtalo otra vez");
    }
}
