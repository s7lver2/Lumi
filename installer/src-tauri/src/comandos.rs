//! Los dos comandos que la UI de `installer/src` necesita: qué hay ya
//! instalado (para la pantalla de Productos) y el instalar en sí (para la
//! pantalla de Instalando). Ver
//! docs/superpowers/specs/2026-08-26-instalador-compartido-design.md.
//!
//! PATH, atajos de terminal, e inicio con el sistema son conveniencias de
//! la instalación interactiva únicamente — el camino `--silencioso`
//! (`silencioso.rs`, mismo binario) nunca las toca: ya existen o no
//! existían, y no es su trabajo cambiarlas.

use std::fs;
use std::path::{Path, PathBuf};

use lumi_installer::aplicar::{aplicar_producto, Fase};
use lumi_installer::marca;
use lumi_proto::actualizacion::Producto;
use tauri::{AppHandle, Emitter};
use winreg::enums::{HKEY_CURRENT_USER, KEY_READ, KEY_WRITE};
use winreg::RegKey;

#[derive(serde::Serialize)]
pub struct InfoProducto {
    pub producto: String,
    pub ya_instalado: bool,
    pub version: Option<String>,
    /// La más reciente publicada en el manifiesto, para poder mostrar
    /// "instalada X · última Y" en la pantalla de Productos. `None` si no
    /// se pudo pedir el manifiesto (sin red) — la pantalla sigue funcionando
    /// igual, solo sin ese dato de más.
    pub version_disponible: Option<String>,
}

/// La UI mostraba el string literal `%LocalAppData%\Programs\Lumi` y lo
/// mandaba tal cual a `instalar` cuando el investigador no tocaba
/// "Examinar" — Rust no expande sintaxis de variables de entorno de
/// `cmd.exe`, así que `fs::create_dir_all` lo trataba como una ruta
/// relativa de verdad y creaba una carpeta llamada literalmente
/// `%LocalAppData%` donde fuera que se hubiera lanzado el instalador. Este
/// comando resuelve la ruta real una sola vez, al cargar la pantalla de
/// Ubicación, para que lo que se vea y lo que se instale sea lo mismo.
#[tauri::command]
pub fn ruta_instalacion_por_defecto() -> String {
    let base = std::env::var("LOCALAPPDATA").unwrap_or_else(|_| "C:\\".to_string());
    format!("{base}\\Programs\\Lumi")
}

#[tauri::command]
pub fn detectar_instalados() -> Vec<InfoProducto> {
    // Un solo intento de red para los dos productos, no uno por tarjeta —
    // y si falla (sin conexión), la pantalla sigue mostrando lo instalado,
    // solo sin la comparación contra la última versión.
    let manifiesto = lumi_installer::manifiesto::obtener_verificado().ok();

    ["cliente", "indexer"]
        .into_iter()
        .map(|p| {
            let version_disponible = manifiesto.as_ref().and_then(|m| {
                m.mas_nueva(producto_enum(p), "0.0.0", "windows-x86_64")
                    .map(|publi| publi.version.clone())
            });
            match marca::leer(p) {
                Some(m) => InfoProducto {
                    producto: p.to_string(), ya_instalado: true, version: Some(m.version), version_disponible,
                },
                None => InfoProducto {
                    producto: p.to_string(), ya_instalado: false, version: None, version_disponible,
                },
            }
        })
        .collect()
}

fn nombre_ejecutable(producto: &str) -> &'static str {
    match producto {
        "cliente" => "app.exe",
        "indexer" => "indexer-app.exe",
        _ => unreachable!(),
    }
}

fn nombre_mostrado(producto: &str) -> &'static str {
    match producto {
        "cliente" => "Lumi",
        "indexer" => "Lumi Indexer",
        _ => unreachable!(),
    }
}

fn nombre_comando_terminal(producto: &str) -> &'static str {
    match producto {
        "cliente" => "lumi",
        "indexer" => "lumi-indexer",
        _ => unreachable!(),
    }
}

fn producto_enum(producto: &str) -> Producto {
    match producto {
        "cliente" => Producto::Cliente,
        "indexer" => Producto::Indexer,
        _ => unreachable!(),
    }
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub fn instalar(
    app: AppHandle,
    productos: Vec<String>,
    raiz: String,
    acceso_directo: bool,
    agregar_path: bool,
    atajos_terminal: bool,
    iniciar_con_sistema: bool,
) -> Result<(), String> {
    let manifiesto = lumi_installer::manifiesto::obtener_verificado().map_err(|e| e.to_string())?;
    let raiz = PathBuf::from(raiz);

    for producto in &productos {
        let publicacion = manifiesto
            .mas_nueva(producto_enum(producto), "0.0.0", "windows-x86_64")
            .ok_or_else(|| format!("{producto}: sin publicacion disponible"))?
            .clone();

        let carpeta = raiz.join(if producto == "cliente" { "Cliente" } else { "Indexer" });
        let destino = carpeta.join(nombre_ejecutable(producto));

        // Reinstalar sobre una instalación existente con la app abierta
        // fallaba con el error de disco crudo de Windows al intentar
        // sobrescribir el .exe en uso — se cierra sola antes de tocar nada.
        if !lumi_installer::proceso::cerrar_por_nombre(nombre_ejecutable(producto), std::time::Duration::from_secs(5)) {
            return Err(format!(
                "{}: cierra la aplicación antes de reinstalar",
                nombre_mostrado(producto)
            ));
        }

        let producto_evento = producto.clone();
        let app_evento = app.clone();
        aplicar_producto(&publicacion, "windows-x86_64", &destino, move |fase| {
            let texto = match fase {
                Fase::Descargando => "descargando",
                Fase::Verificando => "verificando",
                Fase::Copiando => "copiando",
            };
            let _ = app_evento.emit("progreso", serde_json::json!({
                "producto": producto_evento,
                "fase": texto,
            }));
        })
        .map_err(|e| e.to_string())?;

        marca::escribir(producto, nombre_mostrado(producto), &publicacion.version, &carpeta)
            .map_err(|e| e.to_string())?;

        // El cliente/Indexer buscan installer.exe junto a sí mismos para
        // autoactualizarse en silencio (ver disparar_actualizacion_silenciosa
        // en client/src-tauri/src/main.rs) — sin copiarse aquí, esa
        // búsqueda nunca encuentra nada y el botón "Actualizar ahora" falla
        // en silencio (la promesa rechazada nunca se captura del lado TS).
        copiar_instalador_junto_al_producto(&carpeta)?;

        if acceso_directo {
            crear_acceso_directo(producto, &destino)?;
        }
        if agregar_path {
            agregar_a_path(&carpeta)?;
        }
        if atajos_terminal {
            let carpeta_bin = raiz.join("bin");
            crear_atajo_terminal(nombre_comando_terminal(producto), &carpeta_bin, &destino)?;
            agregar_a_path(&carpeta_bin)?;
        }
        if iniciar_con_sistema {
            agregar_inicio_con_sistema(nombre_mostrado(producto), &destino)?;
        }
    }

    Ok(())
}

/// Se copia a sí mismo (el `installer.exe` que está corriendo ahora mismo,
/// el mismo binario tanto para la instalación interactiva como para
/// `--silencioso`) junto al ejecutable del producto. No hace nada si ya
/// está ahí y es exactamente el mismo archivo — evita fallar por "archivo
/// en uso" al reinstalar sobre una instalación existente.
fn copiar_instalador_junto_al_producto(carpeta: &Path) -> Result<(), String> {
    let actual = std::env::current_exe().map_err(|e| e.to_string())?;
    let destino = carpeta.join("installer.exe");
    if destino == actual {
        return Ok(());
    }
    if destino.exists() {
        let mismo_tamano = fs::metadata(&actual).ok().map(|m| m.len())
            == fs::metadata(&destino).ok().map(|m| m.len());
        if mismo_tamano {
            return Ok(());
        }
    }
    fs::copy(&actual, &destino).map_err(|e| e.to_string())?;
    Ok(())
}

fn crear_acceso_directo(producto: &str, destino_exe: &Path) -> Result<(), String> {
    let nombre = nombre_mostrado(producto);
    let escritorio = dirs_escritorio()?;
    let enlace = escritorio.join(format!("{nombre}.lnk"));
    mslnk::ShellLink::new(destino_exe)
        .map_err(|e| e.to_string())?
        .create_lnk(&enlace)
        .map_err(|e| e.to_string())?;
    Ok(())
}

fn dirs_escritorio() -> Result<PathBuf, String> {
    std::env::var("USERPROFILE")
        .map(|p| PathBuf::from(p).join("Desktop"))
        .map_err(|_| "no se encontro USERPROFILE".to_string())
}

/// Añade `carpeta` al `PATH` del usuario (registro, no la sesión de un
/// proceso) si no está ya — sin duplicar si se instala más de una vez.
fn agregar_a_path(carpeta: &Path) -> Result<(), String> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let env = hkcu
        .open_subkey_with_flags("Environment", KEY_READ | KEY_WRITE)
        .map_err(|e| e.to_string())?;
    let actual: String = env.get_value("Path").unwrap_or_default();
    let nueva = carpeta.to_string_lossy().to_string();

    if actual.split(';').any(|p| p.trim().eq_ignore_ascii_case(nueva.trim())) {
        return Ok(());
    }

    let combinado = if actual.is_empty() { nueva } else { format!("{actual};{nueva}") };
    env.set_value("Path", &combinado).map_err(|e| e.to_string())?;
    notificar_cambio_de_entorno();
    Ok(())
}

/// Difunde `WM_SETTINGCHANGE` para que una terminal nueva (no las ya
/// abiertas — eso es un límite conocido de Windows, ninguna app lo
/// resuelve) recoja el PATH actualizado sin tener que cerrar sesión.
fn notificar_cambio_de_entorno() {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        SendMessageTimeoutW, HWND_BROADCAST, SMTO_ABORTIFHUNG, WM_SETTINGCHANGE,
    };
    let parametro: Vec<u16> = "Environment\0".encode_utf16().collect();
    unsafe {
        SendMessageTimeoutW(
            HWND_BROADCAST,
            WM_SETTINGCHANGE,
            0,
            parametro.as_ptr() as isize,
            SMTO_ABORTIFHUNG,
            5000,
            std::ptr::null_mut(),
        );
    }
}

/// Un `.cmd` que reenvía a la ruta real — más simple que renombrar el
/// ejecutable del producto, y dos productos pueden convivir en el mismo
/// `bin` sin chocar de nombre.
fn crear_atajo_terminal(nombre_comando: &str, carpeta_bin: &Path, destino_exe: &Path) -> Result<(), String> {
    fs::create_dir_all(carpeta_bin).map_err(|e| e.to_string())?;
    let shim = carpeta_bin.join(format!("{nombre_comando}.cmd"));
    let contenido = format!("@echo off\r\nstart \"\" \"{}\" %*\r\n", destino_exe.display());
    fs::write(&shim, contenido).map_err(|e| e.to_string())?;
    Ok(())
}

/// `Run` de usuario, no una tarea programada ni un servicio — es exactamente
/// lo que la opción promete ("como cualquier otra app que arranca contigo"),
/// sin pedir privilegios de administrador para algo que no los necesita.
fn agregar_inicio_con_sistema(nombre: &str, destino_exe: &Path) -> Result<(), String> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let (key, _) = hkcu
        .create_subkey("Software\\Microsoft\\Windows\\CurrentVersion\\Run")
        .map_err(|e| e.to_string())?;
    key.set_value(nombre, &format!("\"{}\"", destino_exe.display()))
        .map_err(|e| e.to_string())?;
    Ok(())
}
