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
        // Las rutas del venv, de `models_dir` y del registro de paddleocr
        // van como argumentos posicionales ($1, $2 y $3), no interpoladas en
        // el texto del script:
        // `format!` metiendo una ruta directamente en
        // un `sh -c` es la forma clásica de inyección de shell si esa ruta
        // llegara alguna vez a depender de algo que no sea el propio
        // instalador local — y aunque hoy `models_dir` solo lo fija `lumi
        // install` (nunca una petición HTTP), dejar el primitivo ahí "porque
        // hoy no es alcanzable" es la clase de gancho que se activa solo el
        // día en que alguien añada una ruta remota sin volver a auditar esto.
        // Pasarlo como argv en vez de texto lo cierra sin condiciones.
        TaskKind::InferenceRuntime => (
            "/bin/sh".into(),
            vec![
                "-c".into(),
                // Seis comprobaciones independientes, no una: cada paquete
                // (`romatch` para tiny-roma/roma, `safetensors` para MegaLoc,
                // `lightglue` para lightglue-aliked, `transformers` para los
                // motores vlm/profundidad de los agentes, `paddleocr` para
                // su motor ocr) es una incorporación posterior a
                // torch/torchvision, y un servidor que ya tenía el runtime
                // instalado antes de que existiera un paquete nuevo se queda
                // con el "nada que hacer" de siempre — con una sola
                // comprobación conjunta, ese servidor nunca instalaría el
                // que le falta, y "Reinstalar runtime" desde el panel es
                // justamente la única vía de instalación que no exige tocar
                // el servidor a mano por SSH. Cada bloque solo actúa si a SU
                // paquete le falta algo — instalar uno no vuelve a tocar los
                // demás ya instalados. `lightglue` no está en PyPI bajo ese
                // nombre (el README del propio proyecto lo confirma): se
                // instala directo desde su repo de GitHub.
                //
                // `uv` reemplaza a `pip`/`venv` aquí (resuelve e instala
                // ambos en paralelo, sin la vuelta de red por dependencia que
                // hacía tan lento crear el venv de torch la primera vez). Se
                // instala en `$2/uv` (dentro de `models_dir`, no en `$HOME`):
                // el servicio corre como root bajo systemd sin `HOME`
                // garantizado, y atarlo al mismo disco que ya eligió el
                // instalador evita depender de esa variable. El instalador
                // oficial es un binario estático — no pasa por pip, así que
                // no reintroduce la dependencia que se está quitando.
                "set -e; \
                 UV=\"$2/uv/uv\"; \
                 if [ ! -x \"$UV\" ]; then \
                   mkdir -p \"$2/uv\"; \
                   export UV_INSTALL_DIR=\"$2/uv\" UV_NO_MODIFY_PATH=1; \
                   curl -LsSf https://astral.sh/uv/install.sh | sh; \
                 fi; \
                 if \"$1/bin/python3\" -c 'import torch, torchvision' 2>/dev/null; then \
                   echo 'torch/torchvision ya instalados, nada que hacer'; \
                 else \
                   \"$UV\" venv --python python3 \"$1\"; \
                   UV_HTTP_TIMEOUT=60 \"$UV\" pip install --python \"$1/bin/python3\" \
                   torch torchvision --index-url https://download.pytorch.org/whl/cu126; \
                 fi; \
                 if \"$1/bin/python3\" -c 'import romatch' 2>/dev/null; then \
                   echo 'romatch ya instalado, nada que hacer'; \
                 else \
                   UV_HTTP_TIMEOUT=60 \"$UV\" pip install --python \"$1/bin/python3\" romatch; \
                 fi; \
                 # `roma_outdoor(use_custom_corr=True)` -- el modo que de
                 # verdad se usa (ver `lumi_verify.py`) -- necesita poder
                 # hacer `import local_corr`. Esa extension no esta en PyPI
                 # bajo ese nombre, y el paquete mas cercano
                 # (`fused-local-corr`) va atado a una version de
                 # PyTorch/CUDA que no es la nuestra (probado a mano: al
                 # instalarlo, degrada torch de 2.14+cu126 a 2.11+cu13 y
                 # rompe todo lo demas que corre sobre ese mismo torch). En
                 # su lugar, un kernel Triton propio con el mismo contrato,
                 # publicado como `local-corr-lumi` en PyPI (código en
                 # github.com/s7lver2/local-corr-lumi) -- compila contra el
                 # PyTorch/CUDA que YA haya en el entorno, no trae un
                 # binario prebuilt que pueda desincronizarse. Sin esto,
                 # \"roma\" corre igual (cae al fallback en PyTorch puro que
                 # trae romatch) pero decenas de veces mas lento -- minutos
                 # por candidato en vez de segundos.
                 if \"$1/bin/python3\" -c 'import local_corr' 2>/dev/null; then \
                   echo 'local_corr ya instalado, nada que hacer'; \
                 else \
                   UV_HTTP_TIMEOUT=60 \"$UV\" pip install --python \"$1/bin/python3\" local-corr-lumi; \
                 fi; \
                 if \"$1/bin/python3\" -c 'import safetensors' 2>/dev/null; then \
                   echo 'safetensors ya instalado, nada que hacer'; \
                 else \
                   UV_HTTP_TIMEOUT=60 \"$UV\" pip install --python \"$1/bin/python3\" safetensors; \
                 fi; \
                 if \"$1/bin/python3\" -c 'import lightglue' 2>/dev/null; then \
                   echo 'lightglue ya instalado, nada que hacer'; \
                 else \
                   UV_HTTP_TIMEOUT=60 \"$UV\" pip install --python \"$1/bin/python3\" \
                   git+https://github.com/cvg/LightGlue.git; \
                 fi; \
                 if \"$1/bin/python3\" -c 'import transformers' 2>/dev/null; then \
                   echo 'transformers ya instalado, nada que hacer'; \
                 else \
                   UV_HTTP_TIMEOUT=60 \"$UV\" pip install --python \"$1/bin/python3\" transformers; \
                 fi; \
                 # `paddleocr` sin `paddle` no arranca: es su motor de
                 # inferencia real, un paquete aparte que `pip install
                 # paddleocr` NO arrastra solo. Sin este segundo paquete el
                 # agente de OCR moria en la primera linea de su
                 # constructor, silencioso detras del timeout de 120s de
                 # `lumid::agentar` -- \"0 agentes\" sin ninguna pista. Las
                 # dos versiones van fijadas y no a lo ultimo: la serie 3.x
                 # rehizo esta API entera (otro nombre de idioma, otros
                 # parametros, otro metodo de inferencia) y ademas trae un
                 # fallo propio en su runtime CPU -- `lumi_motores.py::Ocr`
                 # sigue escrito contra la 2.x a proposito.
                 if \"$1/bin/python3\" -c 'import paddleocr, paddle' 2>/dev/null; then \
                   echo 'paddleocr ya instalado, nada que hacer'; \
                 else \
                   UV_HTTP_TIMEOUT=60 \"$UV\" pip install --python \"$1/bin/python3\" \
                   'paddleocr==2.9.1' 'paddlepaddle==2.6.2'; \
                 fi; \
                 # PaddleOCR trae sus propios pesos SOLA la primera vez que se
                 # instancia (`gestion_propia` en su registro, sin
                 # `fichero_url` propio) -- si eso se deja para la primera
                 # llamada real, esa llamada corre bajo el timeout de 120s de
                 # `lumid::agentar` (`LIMITE`), que no distingue \"se estaba
                 # descargando\" de \"no hay agentes\": un fallo de red o de
                 # idioma ahi se veia en el cliente como un misterioso \"los
                 # agentes no llegaron a correr\", sin log utilizable. Se
                 # fuerza aqui, con la generosidad de tiempo de esta tarea de
                 # instalacion -- mismo criterio que `lumi_bajar.py` para el
                 # resto de items `gestion_propia`, solo que ese script lo
                 # dispara \"Descargar modelos\" y no todo el mundo pasa por
                 # ahi tras un \"Instalar runtime\" limpio.
                 if [ -f \"$2/paddleocr/LICENCIA.txt\" ]; then \
                   echo 'paddleocr: pesos ya con licencia escrita, nada que hacer'; \
                 else \
                   mkdir -p \"$2/paddleocr\"; \
                   \"$1/bin/python3\" -c 'import json,sys
d = json.load(open(sys.argv[1]))
open(sys.argv[2], \"w\").write(d.get(\"licencia_texto\", \"\"))' \"$3\" \"$2/paddleocr/LICENCIA.txt\"; \
                   echo 'paddleocr: forzando la descarga de sus pesos (puede tardar)…'; \
                   \"$1/bin/python3\" -c 'from paddleocr import PaddleOCR
PaddleOCR(use_angle_cls=True, lang=\"latin\", show_log=False, use_gpu=False)' \
                   || { echo 'FATAL paddleocr no pudo descargar/cargar sus pesos'; exit 1; }; \
                 fi"
                    .into(),
                "sh".into(),
                venv.display().to_string(),
                base.display().to_string(),
                crate::assets::ruta("registros/motores/paddleocr.json").display().to_string(),
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
            vec![crate::assets::ruta("workers/lumi_bajar.py").to_string_lossy().into_owned()],
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
        // operador quiere leer, no dos flujos que casar a mano. Cada línea
        // va TAMBIÉN por `tracing` (categoría propia, ver `logging.rs`) para
        // que "Instalar runtime" se pueda seguir desde la pestaña de Logs
        // del panel como cualquier otra actividad del servidor -- antes solo
        // vivía en el fichero de esta tarea, invisible ahí.
        let out = BufReader::new(child.stdout.take().unwrap());
        let err = BufReader::new(child.stderr.take().unwrap());
        let p1 = path.clone();
        let p2 = path.clone();
        let a = tokio::spawn(async move {
            let mut l = out.lines();
            while let Ok(Some(line)) = l.next_line().await {
                tracing::info!(target: "lumid::tasks", "{line}");
                let _ = append(&p1, &format!("{line}\n"));
            }
        });
        let b = tokio::spawn(async move {
            let mut l = err.lines();
            while let Ok(Some(line)) = l.next_line().await {
                tracing::warn!(target: "lumid::tasks", "{line}");
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