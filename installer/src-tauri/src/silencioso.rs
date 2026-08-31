//! Camino silencioso del instalador: sin ventana, en milisegundos. El
//! cliente/Indexer lo lanzan y se cierran antes (spec, Flujo B) — esto solo
//! confirma que de verdad pasó, con margen, antes de tocar archivos.
//!
//! Vive en el mismo binario que la UI interactiva — `main.rs` mira
//! `--silencioso` antes de arrancar Tauri y decide qué camino tomar — para
//! que solo haya un `.exe` que instalar/actualizar, no dos.
//!
//! Uso: installer.exe --producto=cliente --pid=1234 --version-actual=2.3.0 --silencioso

use std::time::Duration;

use lumi_installer::aplicar::{aplicar_producto, Fase};
use lumi_installer::bitacora;
use lumi_installer::marca;
use lumi_installer::proceso::esperar_cierre;
use lumi_proto::actualizacion::Producto;

struct Args {
    producto: String,
    pid: u32,
    /// Al menos uno de los dos tiene que estar presente: `version_actual`
    /// resuelve "la más nueva que la mía" (autoactualización normal),
    /// `version_objetivo` resuelve "exactamente esta" (downgrade, o igualar
    /// la versión de un servidor que no es la última publicada) — ver
    /// docs/superpowers/specs/2026-08-26-compatibilidad-de-version-design.md.
    version_actual: Option<String>,
    version_objetivo: Option<String>,
}

pub fn es_invocacion_silenciosa() -> bool {
    std::env::args().any(|a| a == "--silencioso")
}

fn parsear_args() -> Option<Args> {
    let mut producto = None;
    let mut pid = None;
    let mut version_actual = None;
    let mut version_objetivo = None;
    for arg in std::env::args().skip(1) {
        if let Some(v) = arg.strip_prefix("--producto=") {
            producto = Some(v.to_string());
        } else if let Some(v) = arg.strip_prefix("--pid=") {
            pid = v.parse::<u32>().ok();
        } else if let Some(v) = arg.strip_prefix("--version-actual=") {
            version_actual = Some(v.to_string());
        } else if let Some(v) = arg.strip_prefix("--version-objetivo=") {
            version_objetivo = Some(v.to_string());
        }
    }
    if version_actual.is_none() && version_objetivo.is_none() {
        return None;
    }
    Some(Args { producto: producto?, pid: pid?, version_actual, version_objetivo })
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

/// No vuelve: sale del proceso con el codigo de salida correspondiente, sin
/// llegar nunca a `tauri::Builder::run` — el camino silencioso no crea
/// ventana en ningun momento.
pub fn ejecutar_y_salir() -> ! {
    let Some(args) = parsear_args() else {
        bitacora::registrar("installer --silencioso: argumentos invalidos, abortando");
        std::process::exit(1);
    };

    if !esperar_cierre(args.pid, Duration::from_secs(10)) {
        bitacora::dejar_marca_error(&args.producto, "desconocida", "el proceso anterior no cerro a tiempo");
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
        let encontrada = if let Some(objetivo) = &args.version_objetivo {
            manifiesto.version_exacta(producto, objetivo, "windows-x86_64")
        } else {
            manifiesto.mas_nueva(producto, args.version_actual.as_deref().unwrap_or("0.0.0"), "windows-x86_64")
        };
        let publicacion = encontrada.ok_or(lumi_installer::InstaladorError::SinPublicacionNueva)?.clone();

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
            std::process::exit(0);
        }
        Err(e) => {
            let version_para_log = args.version_objetivo.as_deref().or(args.version_actual.as_deref()).unwrap_or("desconocida");
            bitacora::dejar_marca_error(&args.producto, version_para_log, &e.to_string());
            // Sin esto, un fallo aquí dejaba al investigador sin nada
            // abierto: el producto ya se había cerrado él solo antes de
            // lanzar este proceso (spec, Flujo B), y si la actualización
            // fallaba (versión no publicada, sin red...) el error se
            // guardaba pero nunca se veía — `error_actualizacion_pendiente()`
            // solo se lee al ARRANCAR el producto, y nada volvía a
            // arrancarlo. Se relanza la versión vieja (sin tocar, la
            // descarga falló antes de escribir nada) para que el aviso se
            // muestre de inmediato en vez de quedar guardado sin que nadie
            // lo vea hasta la próxima vez que alguien abra la app a mano.
            if let Some(marca_previa) = marca::leer(&args.producto) {
                let destino = marca_previa.ruta.join(nombre_ejecutable(&args.producto));
                let _ = std::process::Command::new(&destino).spawn();
            }
            std::process::exit(1);
        }
    }
}
