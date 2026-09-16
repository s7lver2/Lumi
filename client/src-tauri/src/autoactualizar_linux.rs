//! Auto-actualización silenciosa en Linux, sin instalador ni ventana propia
//! — spec docs/superpowers/specs/2026-09-16-soporte-linux-cliente-design.md
//! §4. El AppImage en ejecución se descarga a sí mismo una versión nueva, la
//! verifica y se reemplaza en caliente, igual que `lumid` ya hace en Linux.
//! El instalador compartido (Tauri/WebView2) sigue existiendo tal cual,
//! solo para Windows -- este módulo no lo toca ni depende de él, salvo por
//! reutilizar `lumi_installer::sha256`/`bitacora`, que ya eran agnósticos.

use lumi_proto::actualizacion::{Artefacto, Producto, Publicacion};

const PLATAFORMA: &str = "linux-x86_64";
const PRODUCTO_BITACORA: &str = "cliente";

/// El runtime de AppImage deja la ruta del propio fichero en ejecución en
/// esta variable. Si no está, no se está corriendo como AppImage (un
/// `.deb`, o un build de desarrollo) y no hay nada que auto-reemplazar --
/// mismo papel que `ruta_instalador()` cumple para Windows.
fn ruta_appimage_actual() -> Result<std::path::PathBuf, String> {
    std::env::var("APPIMAGE")
        .map(std::path::PathBuf::from)
        .map_err(|_| "esta instalación no es un AppImage -- no se puede actualizar sola".to_string())
}

fn artefacto_de(publicacion: &Publicacion) -> Result<&Artefacto, String> {
    publicacion
        .artefactos
        .iter()
        .find(|a| a.plataforma == PLATAFORMA)
        .ok_or_else(|| format!("la publicación {} no trae artefacto para {PLATAFORMA}", publicacion.version))
}

/// Descarga `publicacion`, verifica su sha256, reemplaza el AppImage actual
/// y relanza. Cualquier fallo deja el AppImage actual intacto -- nunca se
/// aplica a medias.
async fn aplicar(app: tauri::AppHandle, publicacion: &Publicacion) -> Result<(), String> {
    let ruta_actual = ruta_appimage_actual()?;
    let artefacto = artefacto_de(publicacion)?;

    let bytes = reqwest::get(&artefacto.url)
        .await
        .map_err(|e| e.to_string())?
        .bytes()
        .await
        .map_err(|e| e.to_string())?;

    if !lumi_installer::sha256::verificar_sha256(&bytes, &artefacto.sha256) {
        return Err("el AppImage descargado no coincide con el sha256 del manifiesto".into());
    }

    // Mismo directorio que el AppImage actual, no un temporal del sistema:
    // `rename()` entre sistemas de ficheros distintos no es atómico y
    // podría dejar el AppImage a medias si se corta a mitad de copiar.
    let temporal = ruta_actual.with_extension("nuevo.AppImage");
    std::fs::write(&temporal, &bytes).map_err(|e| e.to_string())?;

    {
        use std::os::unix::fs::PermissionsExt;
        let mut permisos = std::fs::metadata(&temporal).map_err(|e| e.to_string())?.permissions();
        permisos.set_mode(0o755);
        std::fs::set_permissions(&temporal, permisos).map_err(|e| e.to_string())?;
    }

    // En Linux, reemplazar un fichero que un proceso tiene abierto no lo
    // rompe: el proceso actual sigue viendo el inode viejo hasta que
    // termina. A diferencia de Windows (donde `lumi_installer::proceso`
    // espera a que el PID viejo suelte el `.exe`), aquí no hace falta
    // esperar nada antes de relanzar.
    std::fs::rename(&temporal, &ruta_actual).map_err(|e| e.to_string())?;

    std::process::Command::new(&ruta_actual).spawn().map_err(|e| e.to_string())?;
    app.exit(0);
    Ok(())
}

async fn resolver_y_aplicar(app: tauri::AppHandle, publicacion: Option<&Publicacion>) -> Result<(), String> {
    let publicacion = publicacion.ok_or("no hay ninguna publicación con artefacto para linux-x86_64")?.clone();
    let resultado = aplicar(app, &publicacion).await;
    if let Err(e) = &resultado {
        lumi_installer::bitacora::dejar_marca_error(PRODUCTO_BITACORA, &publicacion.version, e);
    }
    resultado
}

/// Equivalente Linux de `disparar_actualizacion_silenciosa`: la más nueva
/// publicada para esta plataforma.
pub async fn aplicar_mas_nueva(app: tauri::AppHandle, version_actual: &str) -> Result<(), String> {
    let manifiesto = crate::manifiesto_verificado().await?;
    let publicacion = manifiesto.mas_nueva(Producto::Cliente, version_actual, PLATAFORMA);
    resolver_y_aplicar(app, publicacion).await
}

/// Equivalente Linux de `disparar_actualizacion_a_version`: una versión
/// exacta (downgrade, o igualar la de un servidor que no está en la
/// última publicada).
pub async fn aplicar_version_objetivo(app: tauri::AppHandle, version_objetivo: &str) -> Result<(), String> {
    let manifiesto = crate::manifiesto_verificado().await?;
    let publicacion = manifiesto.version_exacta(Producto::Cliente, version_objetivo, PLATAFORMA);
    resolver_y_aplicar(app, publicacion).await
}

/// Se llama una vez al arrancar (ver `main()`). Registra el AppImage en el
/// menú de aplicaciones (XDG estándar) si todavía no lo está -- sin esto no
/// aparece en el menú de Pop!_OS ni tiene icono propio salvo que el usuario
/// tenga instalado algo como AppImageLauncher. No hace nada si no se está
/// corriendo como AppImage (`.deb`, o build de desarrollo): un `.deb` ya se
/// integra solo, vía su propio `.desktop` instalado por `dpkg`.
pub fn integrar_escritorio() {
    let Ok(ruta_appimage) = ruta_appimage_actual() else { return };
    let Ok(home) = std::env::var("HOME") else { return };
    let home = std::path::Path::new(&home);

    let carpeta_apps = home.join(".local/share/applications");
    let ruta_desktop = carpeta_apps.join("lumi.desktop");
    // Ya integrado: no se reescribe en cada arranque, para no pisar algo
    // que el propio usuario haya tocado a mano.
    if ruta_desktop.exists() {
        return;
    }

    let carpeta_iconos = home.join(".local/share/icons/hicolor/128x128/apps");
    if std::fs::create_dir_all(&carpeta_apps).is_err() || std::fs::create_dir_all(&carpeta_iconos).is_err() {
        return;
    }
    // Compilado en el binario, no leído de un `resource_dir()` en tiempo de
    // ejecución: así funciona igual sin depender de cómo el bundler de
    // Tauri coloque los recursos dentro del AppImage.
    let _ = std::fs::write(carpeta_iconos.join("lumi.png"), include_bytes!("../icons/128x128.png"));

    let contenido = format!(
        "[Desktop Entry]\nType=Application\nName=Lumi\nExec={}\nIcon=lumi\nCategories=Utility;\nTerminal=false\n",
        ruta_appimage.display(),
    );
    let _ = std::fs::write(&ruta_desktop, contenido);
}
