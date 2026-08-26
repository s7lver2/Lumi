//! Los dos comandos que la UI de `installer/src` necesita: qué hay ya
//! instalado (para la pantalla de Productos) y el instalar en sí (para la
//! pantalla de Instalando). Ver
//! docs/superpowers/specs/2026-08-26-instalador-compartido-design.md.

use std::path::PathBuf;

use lumi_installer::aplicar::{aplicar_producto, Fase};
use lumi_installer::marca;
use lumi_proto::actualizacion::Producto;
use tauri::{AppHandle, Emitter};

#[derive(serde::Serialize)]
pub struct InfoProducto {
    pub producto: String,
    pub ya_instalado: bool,
    pub version: Option<String>,
}

#[tauri::command]
pub fn detectar_instalados() -> Vec<InfoProducto> {
    ["cliente", "indexer"]
        .into_iter()
        .map(|p| match marca::leer(p) {
            Some(m) => InfoProducto { producto: p.to_string(), ya_instalado: true, version: Some(m.version) },
            None => InfoProducto { producto: p.to_string(), ya_instalado: false, version: None },
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

fn producto_enum(producto: &str) -> Producto {
    match producto {
        "cliente" => Producto::Cliente,
        "indexer" => Producto::Indexer,
        _ => unreachable!(),
    }
}

#[tauri::command]
pub fn instalar(app: AppHandle, productos: Vec<String>, raiz: String) -> Result<(), String> {
    let manifiesto = lumi_installer::manifiesto::obtener_verificado().map_err(|e| e.to_string())?;
    let raiz = PathBuf::from(raiz);

    for producto in &productos {
        let publicacion = manifiesto
            .mas_nueva(producto_enum(producto), "0.0.0", "windows-x86_64")
            .ok_or_else(|| format!("{producto}: sin publicacion disponible"))?
            .clone();

        let carpeta = raiz.join(if producto == "cliente" { "Cliente" } else { "Indexer" });
        let destino = carpeta.join(nombre_ejecutable(producto));

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

        crear_accesos_directos(producto, &destino)?;
    }

    Ok(())
}

fn crear_accesos_directos(producto: &str, destino_exe: &std::path::Path) -> Result<(), String> {
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
