//! Generar la clave que firma `web/releases/desreclamos.json`, y firmar un
//! borrador de lista. Mismo patrón que `lumi actualizaciones generar-clave`/
//! `firmar` en `crates/lumi-cli/src/firmar.rs`, pero para el Indexer: la
//! clave privada no sale nunca de esta máquina — no se sube a Vercel ni se
//! commitea al repo.
//!
//! Uso:
//!   cargo run -p lumi-index --example firmar_desreclamos -- generar-clave
//!   cargo run -p lumi-index --example firmar_desreclamos -- firmar <borrador.json> <salida.json>
//!
//! El borrador es un JSON de la forma `{"lista":[["paquete","motivo"], ...]}`.

use std::path::PathBuf;

use ed25519_dalek::SigningKey;
use lumi_index::desreclamos::Desreclamos;

fn home_dir() -> PathBuf {
    std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .map(PathBuf::from)
        .expect("no se pudo determinar el directorio personal (falta HOME/USERPROFILE)")
}

fn ruta_clave() -> PathBuf {
    home_dir().join(".lumi-indexer").join("desreclamos.key")
}

fn generar_clave() {
    let ruta = ruta_clave();
    if ruta.exists() {
        panic!(
            "ya existe una clave en {} — bórrala a mano si de verdad quieres una nueva \
             (rotar invalida todo lo firmado con la anterior)",
            ruta.display()
        );
    }
    std::fs::create_dir_all(ruta.parent().unwrap()).unwrap();
    let secreta = SigningKey::generate(&mut rand::rngs::OsRng);
    std::fs::write(&ruta, secreta.to_bytes()).unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&ruta, std::fs::Permissions::from_mode(0o600)).unwrap();
    }
    let publica = secreta.verifying_key();
    println!("clave privada escrita en {}", ruta.display());
    println!();
    println!("pega esto en crates/lumi-index/src/desreclamos.rs, reemplazando CLAVE_PUBLICA:");
    println!();
    print!("pub const CLAVE_PUBLICA: [u8; 32] = [");
    for (i, b) in publica.to_bytes().iter().enumerate() {
        if i > 0 {
            print!(", ");
        }
        print!("{b}");
    }
    println!("];");
}

fn cargar_clave() -> SigningKey {
    let ruta = ruta_clave();
    let bytes = std::fs::read(&ruta).unwrap_or_else(|_| {
        panic!("no se pudo leer {} — ejecuta antes 'generar-clave'", ruta.display())
    });
    let arr: [u8; 32] = bytes.try_into().expect("la clave no mide 32 bytes");
    SigningKey::from_bytes(&arr)
}

fn firmar(borrador: &std::path::Path, salida: &std::path::Path) {
    let texto = std::fs::read_to_string(borrador)
        .unwrap_or_else(|e| panic!("no se pudo leer {}: {e}", borrador.display()));
    let mut d: Desreclamos = serde_json::from_str(&texto)
        .unwrap_or_else(|e| panic!("{} no es un borrador válido: {e}", borrador.display()));
    d.firmar(&cargar_clave());
    let salida_texto = serde_json::to_string_pretty(&d).unwrap();
    std::fs::write(salida, salida_texto)
        .unwrap_or_else(|e| panic!("no se pudo escribir {}: {e}", salida.display()));
    println!("firmado: {} ({} entradas)", salida.display(), d.lista.len());
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    match args.get(1).map(String::as_str) {
        Some("generar-clave") => generar_clave(),
        Some("firmar") => {
            let borrador = args.get(2).expect("falta <borrador.json>");
            let salida = args.get(3).expect("falta <salida.json>");
            firmar(std::path::Path::new(borrador), std::path::Path::new(salida));
        }
        _ => {
            eprintln!("uso: firmar_desreclamos generar-clave | firmar <borrador.json> <salida.json>");
            std::process::exit(1);
        }
    }
}
