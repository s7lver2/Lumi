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

pub fn head(title: &str) {
    println!("\n{}", style(title).bold());
}
