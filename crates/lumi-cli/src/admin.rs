//! `lumi admin ...`: cliente autenticado de las rutas de administración que
//! `lumid` ya expone para el panel web — nunca toca el SQLite directamente.
//! Antes sí lo hacía ("tener shell en la máquina ya es prueba de
//! propiedad"), pero eso dejaba estas acciones sin sesión, sin rol
//! comprobado y sin ningún rastro de quién las usó. La escotilla que SÍ
//! toca el SQLite a mano sigue existiendo, aparte y marcada, en
//! `rescate.rs` — solo para cuando `lumid` ni siquiera responde.

use crate::install::DATA;
use crate::red::{self, Servidor};
use anyhow::{Context, Result};
use lumi_proto::api::{AdminRequest, AdminUser, PatchAcceptRequestsReq, PatchUserReq, ResetPasswordRes, UserDetail};
use lumi_proto::key::ServerCard;

/// La tarjeta pública. No caduca y no se consume, y no necesita sesión — es
/// justo lo que hace falta para poder emparejarse por primera vez, así que
/// se queda como lectura local en vez de pasar por `red`.
pub fn card() -> Result<ServerCard> {
    let der = std::fs::read(format!("{DATA}/cert.der")).context("el servidor no está instalado")?;
    let addr = crate::install::direccion_publica(&rusqlite::Connection::open(format!("{DATA}/lumi.db"))?);
    Ok(ServerCard::new(&addr, &der))
}

fn buscar_id(servidor: &Servidor, username: &str) -> Result<i64> {
    let usuarios: Vec<AdminUser> = red::get_json(servidor, "/v1/admin/users")?;
    usuarios
        .into_iter()
        .find(|u| u.username == username)
        .map(|u| u.id)
        .with_context(|| format!("no existe el usuario {username} en este servidor"))
}

pub fn reset_password(servidor: &Servidor, username: &str) -> Result<String> {
    let id = buscar_id(servidor, username)?;
    let res: ResetPasswordRes = red::post_sin_cuerpo(servidor, &format!("/v1/admin/users/{id}/reset-password"))?;
    Ok(res.temp)
}

pub fn unblock(servidor: &Servidor, username: &str) -> Result<()> {
    let id = buscar_id(servidor, username)?;
    let req = PatchUserReq { blocked: Some(false), must_change_password: None, limits: Default::default() };
    let _: UserDetail = red::patch_json(servidor, &format!("/v1/admin/users/{id}"), &req)?;
    Ok(())
}

pub fn requests(servidor: &Servidor) -> Result<()> {
    let filas: Vec<AdminRequest> = red::get_json(servidor, "/v1/admin/access-requests")?;
    if filas.is_empty() {
        println!("  sin solicitudes");
        return Ok(());
    }
    for f in filas {
        println!("  #{:<4} {:<24} {:<10} {}", f.id, f.display_name, f.status, f.source_ip);
    }
    Ok(())
}

pub fn accept(servidor: &Servidor, on: bool) -> Result<()> {
    red::patch_sin_respuesta(servidor, "/v1/admin/access-requests", &PatchAcceptRequestsReq { on })
}

/// Poco usado a propósito: solo lo llama `main.rs` cuando algo de lo de
/// arriba falla con un motivo que suena a "no hay servidor que responda" —
/// para sugerir la escotilla en vez de dejar el error tal cual.
pub fn sugerir_rescate_si_aplica(e: &anyhow::Error) {
    let msg = e.to_string();
    if msg.contains("no se pudo conectar") || msg.contains("no se encontró el certificado") {
        eprintln!();
        eprintln!("  (si lumid está parado, usa 'lumi rescue' en vez de 'lumi admin')");
    }
}

