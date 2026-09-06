//! La escotilla de verdad: para cuando `lumid` ni siquiera responde y
//! `lumi admin` (autenticado por red, ver `admin.rs`/`red.rs`) no tiene con
//! qué hablar. Toca el SQLite directamente — es la única forma de que
//! funcione con el servidor parado — pero a diferencia de lo que hacía
//! antes `lumi admin`, esto:
//!
//! 1. se niega si `lumid` está corriendo (usa la ruta autenticada para eso),
//! 2. pide reescribir el nombre del usuario objetivo para confirmar, y
//! 3. deja un rastro en `rescate.log`: cuándo, qué, a quién, y qué usuario
//!    Unix lo hizo (`SUDO_USER`).
//!
//! "Tener shell en la máquina ya es prueba de propiedad" seguía siendo
//! cierto, pero sin rastro ninguno era indistinguible de un comando
//! cualquiera — y un comando cualquiera no debería poder tomar una cuenta
//! entera sin dejar ni una línea de por qué.

use crate::install::DATA;
use anyhow::{bail, Context, Result};
use lumi_proto::crypto::hash_password;
use rand::RngCore;
use std::io::Write;

fn lumid_activo() -> bool {
    std::process::Command::new("systemctl")
        .args(["is-active", "--quiet", "lumid"])
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

fn exigir_lumid_parado() -> Result<()> {
    if lumid_activo() {
        bail!(
            "lumid está activo — usa 'lumi admin' (autenticado) en vez de esto.\n  \
             Si de verdad necesitas la escotilla: 'sudo systemctl stop lumid' primero."
        );
    }
    Ok(())
}

/// Reescribir el nombre exacto, no un simple s/N: un `y` a medio pensar
/// reinicia la contraseña de cualquiera; volver a teclear el nombre exige
/// mirar lo que se está a punto de hacer.
fn confirmar(objetivo: &str) -> Result<()> {
    let escrito: String = dialoguer::Input::new()
        .with_prompt(format!("escribe '{objetivo}' para confirmar"))
        .interact_text()?;
    if escrito != objetivo {
        bail!("no coincide, cancelado");
    }
    Ok(())
}

fn registrar(accion: &str, objetivo: &str) {
    let quien = std::env::var("SUDO_USER").unwrap_or_else(|_| "?".into());
    // Segundos desde época, no una hora local formateada: mismo criterio que
    // `created_at`/`expires_at` en todo el resto del proyecto (ver
    // `routes::access::now()`), y evita arrastrar una dependencia de fechas
    // solo para una línea de log.
    let ahora = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let linea = format!("{ahora} {accion} {objetivo} (sudo: {quien})\n");
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(format!("{DATA}/rescate.log")) {
        let _ = f.write_all(linea.as_bytes());
    }
}

fn db() -> Result<rusqlite::Connection> {
    rusqlite::Connection::open(format!("{DATA}/lumi.db")).context("el servidor no está instalado")
}

fn uid(c: &rusqlite::Connection, username: &str) -> Result<i64> {
    c.query_row("SELECT id FROM users WHERE username = ?1", [username], |r| r.get(0))
        .with_context(|| format!("no existe el usuario {username}"))
}

pub fn reset_password(username: &str) -> Result<String> {
    exigir_lumid_parado()?;
    confirmar(username)?;
    let c = db()?;
    let id = uid(&c, username)?;
    let mut b = [0u8; 12];
    rand::thread_rng().fill_bytes(&mut b);
    let temp = bs58::encode(b).into_string();
    c.execute(
        "UPDATE users SET password_phc = ?1, must_change_password = 1, blocked = 0 WHERE id = ?2",
        rusqlite::params![hash_password(&temp)?, id],
    )?;
    c.execute("DELETE FROM sessions WHERE user_id = ?1", [id])?;
    registrar("reset-password", username);
    Ok(temp)
}

pub fn unblock(username: &str) -> Result<()> {
    exigir_lumid_parado()?;
    confirmar(username)?;
    let c = db()?;
    let id = uid(&c, username)?;
    c.execute("UPDATE users SET blocked = 0 WHERE id = ?1", [id])?;
    registrar("unblock", username);
    Ok(())
}

pub fn accept(on: bool) -> Result<()> {
    exigir_lumid_parado()?;
    db()?.execute(
        "INSERT OR REPLACE INTO meta (k, v) VALUES ('accept_requests', ?1)",
        [if on { "1" } else { "0" }],
    )?;
    registrar("accept-requests", if on { "on" } else { "off" });
    Ok(())
}
