//! Disparo silencioso de una actualización — sin ventana, en milisegundos.
//! El cliente/Indexer lo lanzan y se cierran antes (spec, Flujo B): esto
//! solo confirma que de verdad pasó, con margen, antes de tocar archivos.
//!
//! Uso: instalador-cli --producto=cliente --pid=1234 --version-actual=2.3.0 --silencioso

use std::path::PathBuf;
use std::time::Duration;

use lumi_installer::aplicar::{aplicar_producto, Fase};
use lumi_installer::bitacora;
use lumi_installer::marca;
use lumi_installer::proceso::esperar_cierre;
use lumi_proto::actualizacion::Producto;

struct Args {
    producto: String,
    pid: u32,
    version_actual: String,
}

fn parsear_args() -> Option<Args> {
    let mut producto = None;
    let mut pid = None;
    let mut version_actual = None;
    for arg in std::env::args().skip(1) {
        if let Some(v) = arg.strip_prefix("--producto=") {
            producto = Some(v.to_string());
        } else if let Some(v) = arg.strip_prefix("--pid=") {
            pid = v.parse::<u32>().ok();
        } else if let Some(v) = arg.strip_prefix("--version-actual=") {
            version_actual = Some(v.to_string());
        }
    }
    Some(Args {
        producto: producto?,
        pid: pid?,
        version_actual: version_actual?,
    })
}

fn producto_enum(producto: &str) -> Option<Producto> {
    match producto {
        "cliente" => Some(Producto::Cliente),
        "indexer" => Some(Producto::Indexer),
        _ => None,
    }
}

fn nombre_ejecutable(producto: &str) -> &'static str {
    match producto {
        "cliente" => "app.exe",
        "indexer" => "indexer-app.exe",
        _ => unreachable!(),
    }
}

fn main() {
    let Some(args) = parsear_args() else {
        bitacora::registrar("instalador-cli: argumentos invalidos, abortando");
        std::process::exit(1);
    };

    if !esperar_cierre(args.pid, Duration::from_secs(10)) {
        bitacora::dejar_marca_error(
            &args.producto,
            "desconocida",
            "el proceso anterior no cerro a tiempo",
        );
        std::process::exit(1);
    }

    let Some(marca_previa) = marca::leer(&args.producto) else {
        bitacora::dejar_marca_error(&args.producto, "desconocida", "no se encontro la instalacion previa");
        std::process::exit(1);
    };

    let resultado = (|| -> Result<(), lumi_installer::InstaladorError> {
        let manifiesto = lumi_installer::manifiesto::obtener_verificado()?;
        let Some(producto) = producto_enum(&args.producto) else {
            return Err(lumi_installer::InstaladorError::SinPublicacionNueva);
        };
        let publicacion = manifiesto
            .mas_nueva(producto, &args.version_actual, "windows-x86_64")
            .ok_or(lumi_installer::InstaladorError::SinPublicacionNueva)?
            .clone();

        let destino = marca_previa.ruta.join(nombre_ejecutable(&args.producto));
        aplicar_producto(&publicacion, "windows-x86_64", &destino, |fase| {
            let texto = match fase {
                Fase::Descargando => "descargando",
                Fase::Verificando => "verificando",
                Fase::Copiando => "copiando",
            };
            bitacora::registrar(&format!("{}: {texto}", args.producto));
        })?;

        marca::escribir(
            &args.producto,
            if args.producto == "cliente" { "Lumi" } else { "Lumi Indexer" },
            &publicacion.version,
            &marca_previa.ruta,
        )
        .map_err(|e| lumi_installer::InstaladorError::Disco(e.to_string()))?;

        std::process::Command::new(&destino)
            .spawn()
            .map_err(|e| lumi_installer::InstaladorError::Disco(e.to_string()))?;

        Ok(())
    })();

    match resultado {
        Ok(()) => {
            bitacora::registrar(&format!("{}: actualizacion aplicada", args.producto));
        }
        Err(e) => {
            bitacora::dejar_marca_error(&args.producto, &args.version_actual, &e.to_string());
            std::process::exit(1);
        }
    }
}
