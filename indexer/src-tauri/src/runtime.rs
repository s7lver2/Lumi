//! El runtime de Python: un venv con torch, y los pesos de los modelos.
//!
//! Mismo problema que ya resolvió el runner del subsistema 1 y misma respuesta:
//! son gigabytes y minutos, así que corre en segundo plano escribiendo a un log
//! por líneas, y cerrar la ventana no aborta nada. Se comprueba `import torch`
//! antes de hacer nada: sin eso, cada arranque recreaba el venv y volvía a
//! invocar pip aunque no hubiera cambiado nada.

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

pub fn esta_instalado(dir: &Path) -> bool {
    let py = python_del_venv(dir);
    py.exists()
        && crate::proceso::cmd(&py)
            .args(["-c", "import torch"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .is_ok_and(|s| s.success())
}

async fn correr(log: &Arc<Log>, etiqueta: &'static str, exe: &Path, args: &[&str]) -> Result<()> {
    log.apuntar(format!("{etiqueta}: {} {}", exe.display(), args.join(" ")));
    let mut hijo = crate::proceso::cmd_async(exe)
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()?;
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

/// Solo una instalación a la vez. Dos `python -m venv` simultáneos sobre la
/// misma ruta se pisan y el segundo muere con «no se puede crear un archivo que
/// ya existe», y dos `pip install` a la vez sobre el mismo entorno son peores
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

    // No se recrea un venv que ya tiene intérprete: llegar aquí con él puesto
    // significa que lo que falta es torch, y rehacer el entorno solo tiraría
    // los gigabytes que ya estuvieran bajados. `--clear` es para el otro caso,
    // el del directorio a medias que dejó un intento anterior al cortarse:
    // sin él, `python -m venv` choca con lo que ya hay y aborta.
    let vpy = python_del_venv(dir);
    if vpy.exists() {
        log.apuntar("venv: ya existe, se reutiliza".into());
    } else {
        let destino = venv_de(dir).display().to_string();
        correr(&log, "venv", Path::new(py), &["-m", "venv", "--clear", &destino]).await?;
    }
    correr(&log, "pip", &vpy, &["-m", "pip", "install", "--upgrade", "pip"]).await?;
    correr(
        &log,
        "pip",
        &vpy,
        &[
            "-m", "pip", "install", "--retries", "5", "--timeout", "60",
            "torch", "--index-url", "https://download.pytorch.org/whl/cu126",
        ],
    )
    .await?;
    correr(&log, "pip", &vpy, &["-m", "pip", "install", "pillow", "numpy"]).await?;
    log.apuntar("runtime: instalado".into());
    Ok(())
}
