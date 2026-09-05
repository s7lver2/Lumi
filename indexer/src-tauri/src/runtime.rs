//! El runtime de Python: un venv con torch, y los pesos de los modelos.
//!
//! Mismo problema que ya resolvió el runner del subsistema 1 y misma respuesta:
//! son gigabytes y minutos, así que corre en segundo plano escribiendo a un log
//! por líneas, y cerrar la ventana no aborta nada. Se comprueba `import torch`
//! antes de hacer nada: sin eso, cada arranque recreaba el venv y volvía a
//! invocar pip aunque no hubiera cambiado nada.
//!
//! `uv` reemplaza a `pip`/`venv` aquí, igual que ya hace `lumid`
//! (`crates/lumid/src/tasks.rs`): resuelve e instala en paralelo, sin la
//! vuelta de red por dependencia que hacía tan lento crear el venv de torch
//! la primera vez. Se instala en `runtime/uv/` (dentro del propio directorio
//! de datos del Indexer, no en el perfil del usuario) para no depender de
//! qué haya o no en el PATH del operador. El instalador oficial es un
//! binario estático — no pasa por pip, así que no reintroduce la
//! dependencia que se está quitando.

use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;

use anyhow::{bail, Result};
use tokio::io::{AsyncBufReadExt, BufReader};

use crate::services::Log;

pub fn venv_de(dir: &Path) -> PathBuf {
    dir.join("runtime").join("venv")
}

/// El intérprete del venv. En Windows vive en `Scripts`, no en `bin`, y aunque
/// el Indexer sea Linux primero esto se corre también bajo WSL con rutas
/// montadas, así que no cuesta nada acertar.
pub fn python_del_venv(dir: &Path) -> PathBuf {
    let v = venv_de(dir);
    if cfg!(windows) { v.join("Scripts").join("python.exe") } else { v.join("bin").join("python3") }
}

fn uv_de(dir: &Path) -> PathBuf {
    let carpeta = dir.join("runtime").join("uv");
    if cfg!(windows) { carpeta.join("uv.exe") } else { carpeta.join("uv") }
}

/// `safetensors` se añadió después de que algunos venvs ya tuvieran
/// torch/torchvision instalados (lo necesita MegaLoc, uno de los
/// recuperadores de Lumi Pro) — igual que pasó antes con torchvision:
/// comprobar solo los paquetes viejos decía "ya instalado, nada que hacer"
/// y dejaba el venv a medias para siempre en esos casos, sin volver a
/// intentar completarlo.
fn importa(dir: &Path, modulos: &str) -> bool {
    let py = python_del_venv(dir);
    py.exists()
        && crate::proceso::cmd(&py)
            .args(["-c", &format!("import {modulos}")])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .is_ok_and(|s| s.success())
}

pub fn esta_instalado(dir: &Path) -> bool {
    importa(dir, "torch, torchvision") && importa(dir, "safetensors")
}

async fn correr(log: &Arc<Log>, etiqueta: &'static str, exe: &Path, args: &[&str]) -> Result<()> {
    correr_con_entorno(log, etiqueta, exe, args, &[]).await
}

async fn correr_con_entorno(
    log: &Arc<Log>,
    etiqueta: &'static str,
    exe: &Path,
    args: &[&str],
    entorno: &[(&str, &std::ffi::OsStr)],
) -> Result<()> {
    log.apuntar(format!("{etiqueta}: {} {}", exe.display(), args.join(" ")));
    let mut cmd = crate::proceso::cmd_async(exe, false);
    cmd.args(args).stdout(Stdio::piped()).stderr(Stdio::piped()).kill_on_drop(true);
    for (k, v) in entorno {
        cmd.env(k, v);
    }
    let mut hijo = cmd.spawn()?;
    for t in [
        hijo.stdout.take().map(|s| Box::new(s) as Box<dyn tokio::io::AsyncRead + Unpin + Send>),
        hijo.stderr.take().map(|s| Box::new(s) as Box<dyn tokio::io::AsyncRead + Unpin + Send>),
    ]
    .into_iter()
    .flatten()
    {
        let log = log.clone();
        tokio::spawn(async move {
            let mut l = BufReader::new(t).lines();
            while let Ok(Some(x)) = l.next_line().await {
                log.apuntar(format!("{etiqueta}: {x}"));
            }
        });
    }
    let salida = hijo.wait().await?;
    if !salida.success() {
        bail!("{etiqueta} terminó con {salida}");
    }
    Ok(())
}

/// Deja `uv` listo en `runtime/uv/` y devuelve su ruta. Si ya está, no vuelve
/// a tocar la red: el instalador oficial no es idempotente-silencioso (vuelve
/// a bajar el binario cada vez que se invoca), así que la comprobación de
/// existencia vive aquí y no dentro del propio instalador.
async fn asegurar_uv(dir: &Path, log: &Arc<Log>) -> Result<PathBuf> {
    let uv = uv_de(dir);
    if uv.exists() {
        return Ok(uv);
    }
    let carpeta = dir.join("runtime").join("uv");
    std::fs::create_dir_all(&carpeta)?;
    log.apuntar("uv: no encontrado, instalando".into());
    if cfg!(windows) {
        // El instalador oficial de Windows es un script de PowerShell, no un
        // binario que baste con `curl`: `irm | iex` es el propio comando que
        // publica astral.sh/uv/install.ps1.
        correr_con_entorno(
            log,
            "uv-install",
            Path::new("powershell"),
            &[
                "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command",
                "irm https://astral.sh/uv/install.ps1 | iex",
            ],
            &[("UV_INSTALL_DIR", carpeta.as_os_str()), ("UV_NO_MODIFY_PATH", std::ffi::OsStr::new("1"))],
        )
        .await?;
    } else {
        correr_con_entorno(
            log,
            "uv-install",
            Path::new("sh"),
            &["-c", "curl -LsSf https://astral.sh/uv/install.sh | sh"],
            &[("UV_INSTALL_DIR", carpeta.as_os_str()), ("UV_NO_MODIFY_PATH", std::ffi::OsStr::new("1"))],
        )
        .await?;
    }
    if !uv.exists() {
        bail!("el instalador de uv no dejó el binario en {}", uv.display());
    }
    Ok(uv)
}

/// Solo una instalación a la vez. Dos `uv venv` simultáneos sobre la misma
/// ruta se pisan y el segundo muere con «no se puede crear un archivo que ya
/// existe», y dos `uv pip install` a la vez sobre el mismo entorno son peores
/// todavía. Quien llegue segundo espera al primero y se encuentra el trabajo
/// hecho. Es global porque el runtime también lo es: hay uno por máquina.
static INSTALANDO: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

pub async fn instalar(dir: &Path, log: Arc<Log>) -> Result<()> {
    let _turno = INSTALANDO.lock().await;
    // Se vuelve a comprobar CON el cerrojo cogido: quien esperaba aquí puede
    // haberse quedado sin nada que hacer justo mientras esperaba.
    if esta_instalado(dir) {
        log.apuntar("runtime: ya instalado, nada que hacer".into());
        return Ok(());
    }
    let base = dir.join("runtime");
    std::fs::create_dir_all(&base)?;

    let uv = asegurar_uv(dir, &log).await?;

    // No se recrea un venv que ya tiene intérprete: llegar aquí con él puesto
    // significa que lo que falta es torch, y rehacer el entorno solo tiraría
    // los gigabytes que ya estuvieran bajados.
    let vpy = python_del_venv(dir);
    if vpy.exists() {
        log.apuntar("venv: ya existe, se reutiliza".into());
    } else {
        // `python3` no siempre está en el PATH en Windows (aquí solo hay
        // `python`) — mismo orden de búsqueda que antes de pasar por `uv`.
        let Some(py) = ["python3", "python"].into_iter().find(|c| {
            crate::proceso::cmd(c)
                .arg("--version")
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status()
                .is_ok_and(|s| s.success())
        }) else {
            bail!("no encuentro un intérprete de Python en el PATH");
        };
        let destino = venv_de(dir).display().to_string();
        correr(&log, "uv-venv", &uv, &["venv", "--python", py, &destino]).await?;
    }
    let vpy_str = vpy.display().to_string();
    // Cada paquete se comprueba por su cuenta antes de instalarlo, no solo
    // al principio de `instalar()`: un venv que ya tenía torch/torchvision
    // de una version anterior de este runtime, pero todavia no
    // safetensors, tiene que completar SOLO lo que le falta -- igual que ya
    // se resolvio este mismo problema en el lado de Station
    // (crates/lumid/src/tasks.rs) para romatch.
    if importa(dir, "torch, torchvision") {
        log.apuntar("uv: torch/torchvision ya instalados, nada que hacer".into());
    } else {
        correr_con_entorno(
            &log,
            "uv-pip",
            &uv,
            &[
                "pip", "install", "--python", &vpy_str,
                "torch", "torchvision", "--index-url", "https://download.pytorch.org/whl/cu126",
            ],
            &[("UV_HTTP_TIMEOUT", std::ffi::OsStr::new("60"))],
        )
        .await?;
    }
    correr(&log, "uv-pip", &uv, &["pip", "install", "--python", &vpy_str, "pillow", "numpy"]).await?;
    if importa(dir, "safetensors") {
        log.apuntar("uv: safetensors ya instalado, nada que hacer".into());
    } else {
        correr(&log, "uv-pip", &uv, &["pip", "install", "--python", &vpy_str, "safetensors"]).await?;
    }
    log.apuntar("runtime: instalado".into());
    Ok(())
}
