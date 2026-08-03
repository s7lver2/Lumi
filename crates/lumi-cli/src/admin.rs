//! Escotilla de emergencia. Se ejecuta EN EL HOST: tener shell en la máquina
//! ya es prueba de propiedad.

use crate::install::DATA;
use anyhow::{Context, Result};
use lumi_proto::crypto::hash_password;
use lumi_proto::key::ServerCard;
use rand::RngCore;

fn db() -> Result<rusqlite::Connection> {
    rusqlite::Connection::open(format!("{DATA}/lumi.db")).context("el servidor no está instalado")
}

fn uid(c: &rusqlite::Connection, username: &str) -> Result<i64> {
    c.query_row("SELECT id FROM users WHERE username = ?1", [username], |r| r.get(0))
        .with_context(|| format!("no existe el usuario {username}"))
}

/// La tarjeta pública. No caduca y no se consume: se publica una vez (wiki
/// interno, canal del equipo) y sirve para todo el mundo.
pub fn card() -> Result<ServerCard> {
    let der = std::fs::read(format!("{DATA}/cert.der")).context("el servidor no está instalado")?;
    let addr = format!("{}:{}", crate::install::local_ip().unwrap_or_else(|| "127.0.0.1".into()), lumi_proto::PORT);
    Ok(ServerCard::new(&addr, &der))
}

pub fn reset_password(username: &str) -> Result<String> {
    let c = db()?;
    let id = uid(&c, username)?;
    let mut b = [0u8; 12];
    rand::thread_rng().fill_bytes(&mut b);
    let temp = bs58::encode(b).into_string();
    // Temporal y de un solo viaje: al entrar con ella, el cliente obliga a
    // cambiarla. Nadie deja una contraseña conocida en una cuenta ajena.
    c.execute(
        "UPDATE users SET password_phc = ?1, must_change_password = 1, blocked = 0 WHERE id = ?2",
        rusqlite::params![hash_password(&temp)?, id],
    )?;
    c.execute("DELETE FROM sessions WHERE user_id = ?1", [id])?;
    Ok(temp)
}

pub fn unblock(username: &str) -> Result<()> {
    let c = db()?;
    let id = uid(&c, username)?;
    c.execute("UPDATE users SET blocked = 0 WHERE id = ?1", [id])?;
    Ok(())
}

pub fn requests() -> Result<()> {
    let c = db()?;
    let mut q = c.prepare(
        "SELECT id, display_name, status, source_ip FROM access_requests ORDER BY created_at DESC",
    )?;
    let rows = q.query_map([], |r| {
        Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?, r.get::<_, String>(3)?))
    })?;
    for row in rows.flatten() {
        println!("  #{:<4} {:<24} {:<10} {}", row.0, row.1, row.2, row.3);
    }
    Ok(())
}

/// Autorrevisión: el interruptor `accept_requests` no tenía forma de
/// accionarse. Es la respuesta a un servidor expuesto recibiendo ruido, y en
/// ese momento lo que se tiene a mano es la shell.
pub fn accept(on: bool) -> Result<()> {
    db()?.execute(
        "INSERT OR REPLACE INTO meta (k, v) VALUES ('accept_requests', ?1)",
        [if on { "1" } else { "0" }],
    )?;
    Ok(())
}
