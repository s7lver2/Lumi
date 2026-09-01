//! Descargar los pesos de un modelo de recuperación, para que el embebido
//! deje de fallar con «faltan los términos de licencia».
//!
//! Reusa `workers/lumi_bajar.py` tal cual — es el mismo script que ya usa
//! Station para sus modelos, sin estructura nueva: una línea de progreso más
//! en el mismo log, con el mismo prefijo `@progreso`/`@sha256` que ya sabe
//! leer `LicenciasGate.tsx` en el cliente de Station.

use std::path::PathBuf;
use std::process::Stdio;
use std::sync::{Arc, Mutex};

use anyhow::{bail, Result};
use serde::Serialize;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

use crate::models::Modelo;
use crate::runtime::python_del_venv;

#[derive(Debug, Clone, Default, Serialize)]
pub struct ProgresoPesos {
    pub modelo_id: String,
    pub pct: u32,
    pub mib: u64,
    pub total_mib: u64,
    pub terminado: bool,
    pub error: Option<String>,
    pub registro: Vec<String>,
}

pub type EnCurso = Arc<Mutex<Option<ProgresoPesos>>>;

/// Dónde viven los pesos de un modelo: `{dir}/pesos/{id}/pesos.pth`, con
/// `LICENCIA.txt` al lado — el mismo layout que ya exige `lumi_pesos._licencia`.
pub fn destino_de(dir: &std::path::Path, modelo_id: &str) -> PathBuf {
    dir.join("pesos").join(modelo_id).join("pesos.pth")
}

/// Arranca la descarga en segundo plano y vuelve enseguida. Solo una a la
/// vez: dos `lumi_bajar.py` sobre el mismo fichero se pisarían igual que dos
/// `pip install` sobre el mismo venv.
pub fn arrancar(dir: PathBuf, en_curso: EnCurso, modelo: Modelo) -> Result<()> {
    if en_curso.lock().unwrap().as_ref().is_some_and(|p| !p.terminado) {
        bail!("ya hay una descarga de pesos en curso");
    }
    if modelo.puerta.is_some() {
        bail!("«{}» exige aceptar su licencia en el sitio del proveedor y traer un token propio: no se puede descargar desde aquí", modelo.nombre);
    }
    if modelo.fichero_url.is_empty() {
        bail!("«{}» no tiene URL de descarga en el registro: modo guía, hay que rellenar `fichero_url` a mano", modelo.nombre);
    }

    *en_curso.lock().unwrap() = Some(ProgresoPesos { modelo_id: modelo.id.clone(), ..Default::default() });

    tauri::async_runtime::spawn(async move {
        if let Err(e) = correr(&dir, &en_curso, &modelo).await {
            let mut g = en_curso.lock().unwrap();
            let p = g.get_or_insert_with(ProgresoPesos::default);
            p.terminado = true;
            p.error = Some(e.to_string());
        }
    });
    Ok(())
}

async fn correr(dir: &std::path::Path, en_curso: &EnCurso, modelo: &Modelo) -> Result<()> {
    let destino = destino_de(dir, &modelo.id);
    let item = serde_json::json!([{
        "id": modelo.id,
        "fichero_url": modelo.fichero_url,
        "destino": destino.display().to_string(),
        "licencia_texto": modelo.licencia_texto,
        "sha256": modelo.sha256,
        "gestion_propia": false,
    }]);

    let py = python_del_venv(dir);
    let script = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../workers/lumi_bajar.py");
    if !script.exists() {
        bail!("no encuentro el descargador en {}", script.display());
    }

    // El JSON viaja por stdin, no por argv: una licencia real (GPL entera,
    // por ejemplo) mide decenas de KB, y Windows corta la línea de comandos
    // completa en unos 32K caracteres — pasado ese tope el proceso ni
    // siquiera llega a arrancar.
    let mut hijo = crate::proceso::cmd_async(&py, false)
        .arg("-u")
        .arg(&script)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()?;

    let mut entrada = hijo.stdin.take().expect("stdin pedido");
    entrada.write_all(item.to_string().as_bytes()).await?;
    drop(entrada); // cierra stdin: es lo que hace terminar `sys.stdin.read()`

    let stdout = hijo.stdout.take().expect("stdout pedido");
    let stderr = hijo.stderr.take().expect("stderr pedido");
    let en_curso2 = en_curso.clone();
    tokio::spawn(async move {
        let mut l = BufReader::new(stderr).lines();
        while let Ok(Some(x)) = l.next_line().await {
            if let Some(p) = en_curso2.lock().unwrap().as_mut() {
                p.registro.push(x);
            }
        }
    });

    let mut lineas = BufReader::new(stdout).lines();
    let mut fatal = None;
    let mut sha256_real = None;
    while let Ok(Some(l)) = lineas.next_line().await {
        if let Some(cuerpo) = l.strip_prefix("@progreso ") {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(cuerpo) {
                if let Some(p) = en_curso.lock().unwrap().as_mut() {
                    p.pct = v.get("pct").and_then(|x| x.as_u64()).unwrap_or(0) as u32;
                    p.mib = v.get("mib").and_then(|x| x.as_u64()).unwrap_or(0);
                    p.total_mib = v.get("total_mib").and_then(|x| x.as_u64()).unwrap_or(0);
                }
            }
        } else if let Some(cuerpo) = l.strip_prefix("@sha256 ") {
            // El hash de lo que de verdad se bajó, no el que el registro
            // decía (que aquí estaba vacío) — es lo que hace falta escribir
            // de vuelta para que `lumi_pesos._verificar` deje de negarse:
            // esa comprobación es intencionadamente más estricta que la del
            // propio descargador, que acepta bajar sin hash conocido.
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(cuerpo) {
                sha256_real = v.get("sha256").and_then(|x| x.as_str()).map(str::to_string);
            }
        } else if l.starts_with("FATAL") {
            fatal = Some(l.clone());
        }
        if let Some(p) = en_curso.lock().unwrap().as_mut() {
            p.registro.push(l);
        }
    }

    let salida = hijo.wait().await?;
    if salida.success() {
        if let Some(sha256) = sha256_real {
            if let Err(e) = anotar_sha256(&modelo.id, &sha256) {
                if let Some(p) = en_curso.lock().unwrap().as_mut() {
                    p.registro.push(format!("no se pudo anotar el sha256 en el registro: {e}"));
                }
            }
        }
    }
    let mut g = en_curso.lock().unwrap();
    let p = g.get_or_insert_with(ProgresoPesos::default);
    p.terminado = true;
    if !salida.success() {
        p.error = Some(fatal.unwrap_or_else(|| format!("terminó con {salida}")));
    }
    Ok(())
}

/// Reescribe `sha256` en el fichero del registro cuyo `id` coincide — el
/// mismo registro que `models::cargar_registro` lee, para que la PRÓXIMA
/// carga (de este proceso o del siguiente) ya no tenga el campo vacío. Sin
/// esto, `lumi_bajar.py` puede haber bajado el fichero perfectamente y
/// `lumi_pesos.py` seguiría rechazándolo por «sha256 vacío» para siempre.
fn anotar_sha256(modelo_id: &str, sha256: &str) -> Result<()> {
    let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../modelos");
    for entrada in std::fs::read_dir(&dir)?.flatten() {
        let ruta = entrada.path();
        if ruta.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        let texto = std::fs::read_to_string(&ruta)?;
        let mut valor: serde_json::Value = serde_json::from_str(&texto)?;
        if valor.get("id").and_then(|v| v.as_str()) != Some(modelo_id) {
            continue;
        }
        valor["sha256"] = serde_json::Value::String(sha256.to_string());
        std::fs::write(&ruta, serde_json::to_string_pretty(&valor)?)?;
        return Ok(());
    }
    bail!("no encontré «{modelo_id}» en {}", dir.display())
}
