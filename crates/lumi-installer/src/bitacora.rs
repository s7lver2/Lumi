//! Log en disco + marca de error pendiente (spec, sección 5: "log en disco
//! **y** aviso en la app la próxima vez que abre"). La carpeta de datos se
//! puede sobreescribir con `LUMI_INSTALADOR_DATOS` — así los tests no
//! tocan el `%LocalAppData%` real de quien corre `cargo test`.

use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::path::PathBuf;

fn carpeta_datos() -> PathBuf {
    if let Ok(v) = std::env::var("LUMI_INSTALADOR_DATOS") {
        return PathBuf::from(v);
    }
    let base = std::env::var("LOCALAPPDATA").unwrap_or_else(|_| ".".into());
    PathBuf::from(base).join("Lumi")
}

fn ruta_log() -> PathBuf {
    carpeta_datos().join("instalador.log")
}

fn ruta_marca_error() -> PathBuf {
    carpeta_datos().join("instalador-error.json")
}

fn marca_de_tiempo() -> String {
    // Segundos desde epoch — suficiente para ordenar líneas de log, sin
    // añadir una dependencia de calendario solo para esto.
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    format!("[{secs}]")
}

pub fn registrar(mensaje: &str) {
    let _ = fs::create_dir_all(carpeta_datos());
    if let Ok(mut f) = fs::OpenOptions::new().create(true).append(true).open(ruta_log()) {
        let _ = writeln!(f, "{} {}", marca_de_tiempo(), mensaje);
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ErrorPendiente {
    pub producto: String,
    pub version_objetivo: String,
    pub motivo: String,
}

pub fn dejar_marca_error(producto: &str, version_objetivo: &str, motivo: &str) {
    registrar(&format!("actualizacion de {producto} a {version_objetivo} fallo: {motivo}"));
    let _ = fs::create_dir_all(carpeta_datos());
    let cuerpo = ErrorPendiente {
        producto: producto.to_string(),
        version_objetivo: version_objetivo.to_string(),
        motivo: motivo.to_string(),
    };
    if let Ok(json) = serde_json::to_string(&cuerpo) {
        let _ = fs::write(ruta_marca_error(), json);
    }
}

/// Se muestra una sola vez: al leerla para `producto`, se borra. Si la
/// marca era para el *otro* producto (mismo equipo, dos apps instaladas),
/// se vuelve a escribir tal cual para que ese otro arranque sí la recoja.
pub fn leer_y_borrar_marca_error(producto: &str) -> Option<ErrorPendiente> {
    let ruta = ruta_marca_error();
    let contenido = fs::read_to_string(&ruta).ok()?;
    let marca: ErrorPendiente = serde_json::from_str(&contenido).ok()?;
    let _ = fs::remove_file(&ruta);
    if marca.producto == producto {
        Some(marca)
    } else {
        if let Ok(json) = serde_json::to_string(&marca) {
            let _ = fs::write(&ruta, json);
        }
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    // Los tests de este módulo mutan la variable de entorno que decide la
    // carpeta de datos — con un Mutex se evita que corran en paralelo y se
    // pisen la carpeta unos a otros.
    static CANDADO: Mutex<()> = Mutex::new(());

    fn carpeta_de_prueba(nombre: &str) -> PathBuf {
        std::env::temp_dir().join(format!("lumi-installer-test-{nombre}-{}", std::process::id()))
    }

    #[test]
    fn marca_error_se_escribe_se_lee_una_vez_y_se_borra() {
        let _guardia = CANDADO.lock().unwrap();
        let tmp = carpeta_de_prueba("bitacora-a");
        std::env::set_var("LUMI_INSTALADOR_DATOS", &tmp);

        dejar_marca_error("cliente", "2.4.0", "sin red");
        let leida = leer_y_borrar_marca_error("cliente").expect("deberia haber marca");
        assert_eq!(leida.version_objetivo, "2.4.0");
        assert_eq!(leida.motivo, "sin red");
        assert!(leer_y_borrar_marca_error("cliente").is_none());

        let _ = fs::remove_dir_all(&tmp);
        std::env::remove_var("LUMI_INSTALADOR_DATOS");
    }

    #[test]
    fn marca_de_otro_producto_no_se_consume_y_sigue_disponible() {
        let _guardia = CANDADO.lock().unwrap();
        let tmp = carpeta_de_prueba("bitacora-b");
        std::env::set_var("LUMI_INSTALADOR_DATOS", &tmp);

        dejar_marca_error("indexer", "0.2.0", "hash no coincide");
        assert!(leer_y_borrar_marca_error("cliente").is_none());
        let leida = leer_y_borrar_marca_error("indexer").expect("deberia seguir para indexer");
        assert_eq!(leida.version_objetivo, "0.2.0");

        let _ = fs::remove_dir_all(&tmp);
        std::env::remove_var("LUMI_INSTALADOR_DATOS");
    }
}
