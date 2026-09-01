//! Auto-actualización del propio instalador (#94): comprobación silenciosa
//! al arrancar la UI interactiva, mismo patrón que
//! `disparar_actualizacion_silenciosa` en cliente/Indexer
//! (`client/src-tauri/src/main.rs`) — pero aplicado al propio
//! `installer.exe`. La diferencia con ese patrón: allí el proceso que se
//! actualiza (cliente/Indexer) ya se cerró antes de lanzar `installer.exe
//! --silencioso`, así que `aplicar_producto` puede escribir directo sobre
//! su ruta. Aquí el instalador se estaría sobrescribiendo a sí mismo
//! mientras sigue corriendo — Windows no lo permite (archivo en uso) — así
//! que la versión nueva se descarga aparte, se lanza, y es ELLA quien
//! espera a que el proceso viejo cierre y se copia sobre la ruta original
//! (mismo `esperar_cierre` que ya usa `silencioso.rs`).

use std::path::PathBuf;
use std::time::Duration;

use lumi_installer::aplicar::aplicar_producto;
use lumi_installer::bitacora;
use lumi_installer::manifiesto;
use lumi_installer::proceso::esperar_cierre;
use lumi_proto::actualizacion::Producto;

const PLATAFORMA: &str = "windows-x86_64";

fn arg(prefijo: &str) -> Option<String> {
    std::env::args().find_map(|a| a.strip_prefix(prefijo).map(str::to_string))
}

/// `true` si este proceso es la versión nueva recién descargada, lanzada
/// para copiarse sobre la instalación original y relanzarla desde ahí.
pub fn es_invocacion_reemplazo() -> bool {
    std::env::args().any(|a| a.starts_with("--reemplazar-destino="))
}

/// No vuelve: espera a que la versión vieja (quien lanzó este proceso)
/// cierre, se copia sobre su ruta, relanza desde ahí, y sale. Sin ventana
/// en ningún momento — igual que el camino `--silencioso` para los demás
/// productos.
pub fn ejecutar_reemplazo_y_salir() -> ! {
    let destino = arg("--reemplazar-destino=").map(PathBuf::from);
    let pid = arg("--pid=").and_then(|p| p.parse::<u32>().ok());
    let (Some(destino), Some(pid)) = (destino, pid) else {
        bitacora::registrar("autoactualizacion instalador: argumentos de reemplazo invalidos");
        std::process::exit(1);
    };

    if !esperar_cierre(pid, Duration::from_secs(10)) {
        bitacora::registrar("autoactualizacion instalador: el proceso anterior no cerro a tiempo");
        std::process::exit(1);
    }

    let actual = match std::env::current_exe() {
        Ok(p) => p,
        Err(e) => {
            bitacora::registrar(&format!("autoactualizacion instalador: current_exe fallo: {e}"));
            std::process::exit(1);
        }
    };

    if let Err(e) = std::fs::copy(&actual, &destino) {
        bitacora::registrar(&format!("autoactualizacion instalador: copia sobre {} fallo: {e}", destino.display()));
        std::process::exit(1);
    }

    bitacora::registrar("autoactualizacion instalador: version nueva instalada, relanzando");
    let _ = std::process::Command::new(&destino).spawn();
    std::process::exit(0);
}

/// Comprobación silenciosa al arrancar la UI interactiva: si hay una
/// versión del instalador más nueva publicada, la descarga a una carpeta
/// temporal, lanza esa copia (con los datos para que se instale sobre esta
/// ruta) y cierra esta app. Nunca bloquea el hilo de IPC de Tauri — todo el
/// trabajo de red va en `spawn_blocking`, con los mismos timeouts que
/// `manifiesto::obtener_verificado`/`aplicar_producto` ya traen (mismo fix
/// que #48/#52 de esta sesión).
pub async fn comprobar_y_lanzar(app: tauri::AppHandle) {
    let version_actual = env!("CARGO_PKG_VERSION");
    let resultado = tokio::task::spawn_blocking(move || -> Option<(PathBuf, PathBuf)> {
        let manifiesto = manifiesto::obtener_verificado().ok()?;
        let publicacion = manifiesto.mas_nueva(Producto::Instalador, version_actual, PLATAFORMA)?.clone();
        let actual = std::env::current_exe().ok()?;
        let temp = std::env::temp_dir().join(format!("lumi-installer-update-{}.exe", publicacion.version));
        aplicar_producto(&publicacion, PLATAFORMA, &temp, |_fase| {}).ok()?;
        Some((temp, actual))
    })
    .await
    .ok()
    .flatten();

    let Some((temp, actual)) = resultado else { return };

    let lanzado = std::process::Command::new(&temp)
        .arg(format!("--reemplazar-destino={}", actual.display()))
        .arg(format!("--pid={}", std::process::id()))
        .spawn();

    match lanzado {
        Ok(_) => {
            bitacora::registrar("autoactualizacion instalador: version nueva descargada, relanzando");
            app.exit(0);
        }
        Err(e) => {
            bitacora::registrar(&format!("autoactualizacion instalador: no se pudo lanzar la version nueva: {e}"));
        }
    }
}
