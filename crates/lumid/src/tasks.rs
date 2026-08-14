//! Runner de tareas del servidor.
//!
//! Las instalaciones pesadas (torch, CUDA, base de datos) no son peticiones
//! HTTP largas: corren aquí, escriben a un log persistente y el cliente se
//! engancha y desengancha por offset. Cerrar la app no aborta nada.
//!
//! Es el mismo primitivo que consumirá la cola del subsistema 4.

use crate::App;
use anyhow::Result;
use lumi_proto::api::{ItemDescarga, TaskKind, TaskStatus};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

pub fn log_path(dir: &Path, id: &str) -> PathBuf {
    dir.join("tasks").join(format!("{id}.log"))
}

fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64
}

/// El comando de cada tipo de tarea. Un script por tipo, no un motor de
/// pipelines: hay dos tipos y no se esperan más en este subsistema.
///
/// `models_dir` es donde el instalador (paso "almacenamiento") dejó
/// configurado que vivan el venv y los pesos descargados; puede ser otro
/// disco o volumen. Si no está configurado (arranque sin `lumi install`,
/// p. ej. en desarrollo), cae a `dir/runtime`.
fn command(kind: TaskKind, dir: &Path, models_dir: Option<&str>) -> (String, Vec<String>) {
    let base = models_dir.map(PathBuf::from).unwrap_or_else(|| dir.join("runtime"));
    let venv = base.join("venv");
    match kind {
        // Si el venv ya tiene torch importable, no se recrea ni se vuelve a
        // invocar pip: sin esto, cada "Instalar runtime" (o cada reinicio
        // durante pruebas) volvía a descargar ~2 GB aunque nada hubiera
        // cambiado. pip ya cachea localmente, pero recrear el venv desde
        // cero seguía siendo trabajo y tiempo de sobra.
        TaskKind::InferenceRuntime => (
            "/bin/sh".into(),
            vec![
                "-c".into(),
                format!(
                    "set -e; \
                     if {v}/bin/python3 -c 'import torch, torchvision' 2>/dev/null; then \
                       echo 'runtime ya instalado, nada que hacer'; \
                     else \
                       python3 -m venv {v}; \
                       {v}/bin/pip install --upgrade pip; \
                       {v}/bin/pip install --retries 5 --timeout 60 \
                       torch torchvision --index-url https://download.pytorch.org/whl/cu126; \
                     fi",
                    v = venv.display()
                ),
            ],
        ),
        TaskKind::Database => (
            "/bin/sh".into(),
            vec!["-c".into(), "echo 'esquema aplicado por lumid al arrancar'".into()],
        ),
        // El JSON viaja por stdin, no por argv: una licencia GPL de verdad
        // mide decenas de KB, y Windows corta la línea de comandos completa
        // en unos 32K caracteres — pasado ese tope, ni siquiera se llega a
        // arrancar el proceso ("el nombre del archivo o la extensión es
        // demasiado largo"). stdin no tiene ese límite.
        TaskKind::ModelDownload => (
            venv.join("bin").join("python3").to_string_lossy().into_owned(),
            vec!["workers/lumi_bajar.py".into()],
        ),
    }
}

pub fn spawn(app: &App, kind: TaskKind) -> Result<String> {
    spawn_con_payload(app, kind, None)
}

pub fn spawn_model_download(app: &App, items: Vec<ItemDescarga>) -> Result<String> {
    let payload = serde_json::to_string(&items)?;
    spawn_con_payload(app, TaskKind::ModelDownload, Some(payload))
}

fn spawn_con_payload(app: &App, kind: TaskKind, payload: Option<String>) -> Result<String> {
    let id = crate::routes::claim::new_token()[..12].to_string();
    std::fs::create_dir_all(app.dir.join("tasks"))?;
    let path = log_path(&app.dir, &id);
    std::fs::File::create(&path)?;

    app.store.conn().execute(
        "INSERT INTO tasks (id, kind, running, exit_code, started_at) VALUES (?1, ?2, 1, NULL, ?3)",
        rusqlite::params![id, serde_json::to_string(&kind)?, now()],
    )?;

    if kind == TaskKind::ModelDownload {
        app.store.set_meta("model_task_id", &id)?;
    }

    let models_dir = app.store.get_meta("models_dir");
    let (bin, args) = command(kind, &app.dir, models_dir.as_deref());
    let store = app.store.clone();
    let id2 = id.clone();
    tokio::spawn(async move {
        let mut cmd = tokio::process::Command::new(bin);
        cmd.args(args).stdout(Stdio::piped()).stderr(Stdio::piped());
        if kind == TaskKind::ModelDownload {
            cmd.stdin(Stdio::piped());
        }
        let mut child = match cmd.spawn() {
            Ok(c) => c,
            Err(e) => {
                let _ = append(&path, &format!("FATAL no se pudo lanzar: {e}\n"));
                finish(&store, &id2, Some(-1), kind);
                return;
            }
        };
        if kind == TaskKind::ModelDownload {
            if let Some(mut stdin) = child.stdin.take() {
                let _ = stdin.write_all(payload.unwrap_or_else(|| "[]".into()).as_bytes()).await;
                // Soltar el handle cierra el extremo de escritura: es lo que
                // convierte `for linea in sys.stdin` en un bucle que termina,
                // no uno que se queda esperando más líneas para siempre.
            }
        }
        // stdout y stderr al mismo log, en orden de llegada: es lo que el
        // operador quiere leer, no dos flujos que casar a mano.
        let out = BufReader::new(child.stdout.take().unwrap());
        let err = BufReader::new(child.stderr.take().unwrap());
        let p1 = path.clone();
        let p2 = path.clone();
        let a = tokio::spawn(async move {
            let mut l = out.lines();
            while let Ok(Some(line)) = l.next_line().await {
                let _ = append(&p1, &format!("{line}\n"));
            }
        });
        let b = tokio::spawn(async move {
            let mut l = err.lines();
            while let Ok(Some(line)) = l.next_line().await {
                let _ = append(&p2, &format!("{line}\n"));
            }
        });
        let code = child.wait().await.ok().and_then(|s| s.code());
        let _ = a.await;
        let _ = b.await;
        finish(&store, &id2, code, kind);
    });
    Ok(id)
}

fn append(path: &Path, line: &str) -> std::io::Result<()> {
    std::fs::OpenOptions::new()
        .append(true)
        .open(path)?
        .write_all(line.as_bytes())
}

fn finish(store: &crate::store::Store, id: &str, code: Option<i32>, kind: TaskKind) {
    let _ = store.conn().execute(
        "UPDATE tasks SET running = 0, exit_code = ?2 WHERE id = ?1",
        rusqlite::params![id, code],
    );
    if kind == TaskKind::ModelDownload {
        let _ = store.conn().execute("DELETE FROM meta WHERE k = 'model_task_id'", []);
    }
}

pub fn status(app: &App, id: &str) -> Option<TaskStatus> {
    let (kind, running, exit_code): (String, i64, Option<i32>) = app
        .store
        .conn()
        .query_row(
            "SELECT kind, running, exit_code FROM tasks WHERE id = ?1",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .ok()?;
    Some(TaskStatus {
        id: id.into(),
        kind: serde_json::from_str(&kind).ok()?,
        running: running == 1,
        exit_code,
        log_len: std::fs::metadata(log_path(&app.dir, id)).map(|m| m.len()).unwrap_or(0),
    })
}