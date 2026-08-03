//! Clave maestra.
//!
//! Automática: 32 bytes en systemd-creds, el servicio arranca solo. Protege
//! del disco robado en frío.
//!
//! Sellada: derivada de la frase del owner. Tras reiniciar, el daemon arranca
//! bloqueado y espera a que un administrador desbloquee desde la app. Protege
//! además contra incautación en caliente.

use anyhow::{bail, Context, Result};
use lumi_proto::crypto::MasterKey;
use std::path::Path;
use std::process::Command;

pub fn is_sealed(dir: &Path) -> bool {
    dir.join("master.salt").exists()
}

/// Devuelve `None` en modo sellado: el daemon arranca bloqueado a propósito.
pub fn load_at_boot(dir: &Path) -> Option<MasterKey> {
    if is_sealed(dir) {
        return None;
    }
    let out = Command::new("systemd-creds")
        .args(["decrypt", "--name=lumi-master"])
        .arg(dir.join("master.cred"))
        .arg("-")
        .output()
        .ok()?;
    if !out.status.success() || out.stdout.len() != 32 {
        return None;
    }
    let mut k = [0u8; 32];
    k.copy_from_slice(&out.stdout);
    Some(MasterKey::from_bytes(k))
}

pub fn unseal(dir: &Path, passphrase: &str) -> Result<MasterKey> {
    if !is_sealed(dir) {
        bail!("este servidor no está en modo sellado");
    }
    let salt = std::fs::read(dir.join("master.salt")).context("falta master.salt")?;
    let mk = MasterKey::derive(passphrase, &salt)?;
    // Comprobante: un blob sellado en la instalación. Si no abre, la frase es
    // incorrecta, y así se distingue de "frase correcta, dato corrupto".
    let probe = dir.join("master.probe");
    if probe.exists() {
        lumi_proto::crypto::open(&mk, &std::fs::read(&probe)?)
            .map_err(|_| anyhow::anyhow!("frase incorrecta"))?;
    } else {
        std::fs::write(&probe, lumi_proto::crypto::seal(&mk, b"lumi"))?;
    }
    Ok(mk)
}
