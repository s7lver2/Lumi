//! Generar y usar la clave que firma el manifiesto de versiones
//! (`web/releases/versiones.json`). La clave privada no sale nunca de la
//! máquina de quien publica: no se sube a Vercel ni se commitea al repo.

use anyhow::{anyhow, Context, Result};
use ed25519_dalek::SigningKey;
use lumi_proto::actualizacion::Manifiesto;
use std::path::{Path, PathBuf};

fn home_dir() -> PathBuf {
    std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .map(PathBuf::from)
        .expect("no se pudo determinar el directorio personal (falta HOME/USERPROFILE)")
}

fn ruta_clave() -> PathBuf {
    home_dir().join(".lumi").join("release.key")
}

pub fn generar_clave() -> Result<()> {
    let ruta = ruta_clave();
    if ruta.exists() {
        return Err(anyhow!(
            "ya existe una clave en {}; bórrala a mano si de verdad quieres una nueva \
             (rotar invalida todo lo firmado con la anterior — ver el techo anotado en \
             CLAVE_PUBLICA, crates/lumi-proto/src/actualizacion.rs)",
            ruta.display()
        ));
    }
    std::fs::create_dir_all(ruta.parent().unwrap())?;
    let secreta = SigningKey::generate(&mut rand::rngs::OsRng);
    std::fs::write(&ruta, secreta.to_bytes())
        .with_context(|| format!("no se pudo escribir {}", ruta.display()))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&ruta, std::fs::Permissions::from_mode(0o600))?;
    }
    let publica = secreta.verifying_key();
    println!("clave privada escrita en {}", ruta.display());
    println!();
    println!("pega esto en crates/lumi-proto/src/actualizacion.rs, reemplazando CLAVE_PUBLICA:");
    println!();
    print!("pub const CLAVE_PUBLICA: [u8; 32] = [");
    for (i, b) in publica.to_bytes().iter().enumerate() {
        if i > 0 {
            print!(", ");
        }
        print!("{b}");
    }
    println!("];");
    Ok(())
}

fn cargar_clave() -> Result<SigningKey> {
    let ruta = ruta_clave();
    let bytes = std::fs::read(&ruta).with_context(|| {
        format!(
            "no se pudo leer {} — ejecuta antes 'lumi actualizaciones generar-clave'",
            ruta.display()
        )
    })?;
    let arr: [u8; 32] = bytes
        .try_into()
        .map_err(|_| anyhow!("la clave en {} no mide 32 bytes", ruta.display()))?;
    Ok(SigningKey::from_bytes(&arr))
}

pub fn firmar(borrador: &Path, salida: &Path) -> Result<()> {
    let texto = std::fs::read_to_string(borrador)
        .with_context(|| format!("no se pudo leer {}", borrador.display()))?;
    let mut manifiesto: Manifiesto = serde_json::from_str(&texto)
        .with_context(|| format!("{} no es un borrador de manifiesto válido", borrador.display()))?;
    let secreta = cargar_clave()?;
    manifiesto.firmar(&secreta);
    let salida_texto = serde_json::to_string_pretty(&manifiesto)?;
    std::fs::write(salida, salida_texto)
        .with_context(|| format!("no se pudo escribir {}", salida.display()))?;
    println!(
        "firmado: {} ({} publicaciones)",
        salida.display(),
        manifiesto.publicaciones.len()
    );
    Ok(())
}
