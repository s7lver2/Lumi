# tools/templates/lumi_launcher.py
"""
Compiled by tools/build.py (PyInstaller --onefile) into lumi.exe on Windows
(Inno Setup places it on the Desktop and Start Menu) or a plain "lumi" ELF
binary on Linux (tools/templates/installer.sh.tmpl places a symlink to it in
~/.local/bin and a .desktop entry in the app menu). This is NOT the
installer: by the time this ever runs, the installer has already copied
files, installed db/'s tiny dependency set, written .env, and started
Postgres (see tools/templates/installer.iss's CurStepChanged, or
installer.sh.tmpl's equivalent). lumi's only job: start the inference
service (skipped with a message if its /setup step hasn't run yet), the
pre-bundled worker, and the pre-built web server, then open the browser —
closing this window stops everything.

Both apps/web and apps/worker are shipped PRE-BUILT (tools/build.py runs
`next build` with output:"standalone" for the web app, and bundles the
worker into a single file with esbuild) — neither needs `pnpm install` or
its own node_modules on the installed machine. Neither's own internal
dotenv-loading call is relied on here (the web standalone server.js doesn't
even have one — Next's dotenv loading only ever ran at build time; the
bundled worker.js's still does, but its relative path math assumes running
from apps/worker/src, which moved once bundled) — this script loads the
root .env itself and injects it into both subprocesses' environment
directly, so neither's own (possibly now-wrong) relative path matters.
"""
import json
import os
import subprocess
import sys
import threading
import time
import traceback
import urllib.error
import urllib.request
import webbrowser
from pathlib import Path

INFERENCE_PORT = 8000
WEB_PORT = 3000

# Postgres, inference, worker and the web server all log to this same
# terminal when lumi is launched from one (double-clicking the desktop
# shortcut has no terminal to write to either way) — without a tag there's
# no way to tell whose line is whose. _PRINT_LOCK keeps concurrent taggers
# from interleaving mid-line when two processes log at once.
_PRINT_LOCK = threading.Lock()

TEE_TO_FILE_TAGS = {"worker", "inference"}

# Caps data/logs/{tag}.log from growing unboundedly across a long-lived
# install (confirmed live: no rotation existed at all, so a multi-day
# session could grow these to unbounded size, both wasting disk and making
# apps/web's GET /api/health/logs tail slower/heavier over time). Coarse
# "shrink when too big" truncation, not a proper rotating-log-handler —
# that's overkill for a ~50-line tail read. Mirrors tools/build.py's
# identical constant/helper exactly.
LOG_SIZE_CAP_BYTES = 5 * 1024 * 1024


def _log_file_path(tag: str, root: Path) -> Path:
    log_dir = root / "data" / "logs"
    log_dir.mkdir(parents=True, exist_ok=True)
    return log_dir / f"{tag}.log"


def _truncate_log_if_large(path: Path) -> None:
    """If path already exceeds LOG_SIZE_CAP_BYTES, rewrites it to keep only
    roughly the last half (read by seeking from the end) — called right
    before opening for append so the file never grows past ~1.5x the cap.
    A no-op for a missing or small-enough file."""
    try:
        size = path.stat().st_size
    except OSError:
        return
    if size <= LOG_SIZE_CAP_BYTES:
        return
    keep_bytes = LOG_SIZE_CAP_BYTES // 2
    with path.open("rb") as f:
        f.seek(size - keep_bytes)
        tail = f.read()
    # The seek almost certainly lands mid-line — drop that likely-partial
    # first line so the kept tail starts on a real line boundary.
    newline_index = tail.find(b"\n")
    if newline_index != -1:
        tail = tail[newline_index + 1:]
    with path.open("wb") as f:
        f.write(tail)


def _pump_tagged(proc: subprocess.Popen, tag: str, root: Path) -> None:
    """Reprints proc's merged stdout/stderr line-by-line, prefixed with
    f"[{tag}]", so a terminal running the packaged binary can tell which
    of docker/inference/worker/web a line came from instead of one
    unlabeled stream. For tags in TEE_TO_FILE_TAGS, also appends each line
    to data/logs/{tag}.log for the web app's crash screen to read."""
    assert proc.stdout is not None
    log_path = _log_file_path(tag, root) if tag in TEE_TO_FILE_TAGS else None
    if log_path is not None:
        _truncate_log_if_large(log_path)
    log_file = log_path.open("a", encoding="utf-8") if log_path is not None else None
    try:
        for line in proc.stdout:
            stripped = line.rstrip(chr(10))
            with _PRINT_LOCK:
                print(f"[{tag}] {stripped}")
            if log_file is not None:
                log_file.write(stripped + "\n")
                log_file.flush()
    finally:
        if log_file is not None:
            log_file.close()


def project_root() -> Path:
    # sys.frozen=True + sys.executable = lumi.exe's own real path once
    # PyInstaller-compiled and installed by Inno Setup at {app}\lumi.exe —
    # its own directory IS the installed app root (apps/, services/, etc.
    # are siblings, copied there by the installer's [Files] section).
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    # Dev mode: tools/templates/lumi_launcher.py -> templates -> tools -> repo root.
    return Path(__file__).resolve().parent.parent.parent


def load_env_file(env_path: Path) -> dict[str, str]:
    """Minimal KEY=VALUE .env parser (# comments and blank lines skipped,
    surrounding quotes stripped) — avoids needing python-dotenv as a
    lumi.exe runtime dependency just for this one read."""
    values: dict[str, str] = {}
    if not env_path.exists():
        return values
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def default_runtime() -> str:
    """Native-host runtime name for whatever OS this launcher itself is
    running on — "windows" or "linux" (see packages/shared-types/src/
    settings.ts's INFERENCE_RUNTIME enum, which mirrors this pair)."""
    return "windows" if sys.platform == "win32" else "linux"


def read_runtime_marker(root: Path) -> str:
    """Mirrors apps/web/lib/runtime-marker.ts's output exactly — written once
    setup completes. Falls back to this host's native runtime if setup
    hasn't run yet or wrote an unrecognized value."""
    marker_path = root / "data" / "runtime-config.json"
    try:
        data = json.loads(marker_path.read_text(encoding="utf-8"))
        runtime = data.get("inferenceRuntime")
        return runtime if runtime in ("windows", "wsl", "linux") else default_runtime()
    except (OSError, ValueError):
        return default_runtime()


def _win_path_to_wsl(win_path: Path) -> str:
    # Mirrors apps/web/app/lib/wsl-path.ts's winPathToWsl exactly.
    s = str(win_path.resolve())
    drive, rest = s.split(":", 1)
    return f"/mnt/{drive.lower()}{rest.replace(chr(92), '/')}"


def inference_command(root: Path, runtime: str) -> list[str] | None:
    """Returns argv to launch uvicorn for the chosen runtime, or None if that
    runtime's venv doesn't exist yet (setup hasn't installed it) — caller
    should skip starting inference rather than launch a doomed command."""
    infer = root / "services" / "inference"
    if runtime == "wsl":
        venv_wsl = infer / "venv-wsl"
        if not venv_wsl.exists():
            return None
        infer_wsl = _win_path_to_wsl(infer)
        script = f"cd '{infer_wsl}' && venv-wsl/bin/uvicorn main:app --host 0.0.0.0 --port {INFERENCE_PORT}"
        return ["wsl.exe", "--", "bash", "-lc", script]
    venv = infer / "venv"
    if not venv.exists():
        return None
    # Native venv layout differs by host: Windows puts executables under
    # venv/Scripts/*.exe, everything else (Linux, incl. Pop!_OS) under
    # venv/bin/*. Mirrors apps/web/app/api/setup/run/[step]/route.ts's
    # venvPython() exactly.
    if sys.platform == "win32":
        python_exe = venv / "Scripts" / "python.exe"
    else:
        python_exe = venv / "bin" / "python"
    return [str(python_exe), "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", str(INFERENCE_PORT)]


def wait_for_http_ok(url: str, timeout_s: float, poll_interval_s: float = 1.0) -> bool:
    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=2) as resp:
                if resp.status < 400:
                    return True
        except (urllib.error.URLError, OSError):
            pass
        time.sleep(poll_interval_s)
    return False


def start_detached(cmd: list[str], cwd: Path, tag: str, root: Path, env: dict[str, str] | None = None) -> subprocess.Popen:
    # CREATE_NEW_PROCESS_GROUP (Windows) / start_new_session (POSIX) so
    # closing lumi's console doesn't send Ctrl+C/SIGINT to these children —
    # they're meant to keep running after this launcher exits. Piping
    # stdout/stderr (instead of the previous DEVNULL) and pumping them
    # through a tagged reader thread is what actually surfaces inference/
    # worker output in the console at all — it used to be silently dropped.
    creationflags = subprocess.CREATE_NEW_PROCESS_GROUP if sys.platform == "win32" else 0
    proc = subprocess.Popen(
        cmd, cwd=cwd, shell=(sys.platform == "win32" and cmd[0] not in ("wsl.exe",)),
        creationflags=creationflags, start_new_session=(sys.platform != "win32"), env=env,
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1,
    )
    threading.Thread(target=_pump_tagged, args=(proc, tag, root), daemon=True).start()
    return proc


def run_foreground(cmd: list[str], cwd: Path, tag: str, root: Path, env: dict[str, str] | None = None) -> int:
    print(f"$ {' '.join(cmd)}")
    proc = subprocess.Popen(
        cmd, cwd=cwd, shell=(sys.platform == "win32"), env=env,
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1,
    )
    _pump_tagged(proc, tag, root)
    return proc.wait()


def main() -> int:
    # PyInstaller onefile consoles can end up fully-buffered instead of
    # line-buffered when blocked inside a long subprocess.call — nothing
    # appears until the buffer flushes, which looks like "the window opens
    # and does nothing" even though it's actually progressing (or stuck).
    sys.stdout.reconfigure(line_buffering=True)
    sys.stderr.reconfigure(line_buffering=True)

    root = project_root()
    print(f"Lumi arrancando desde {root}")
    if not (root / "docker-compose.yml").exists():
        print(f"ERROR: no se encuentra docker-compose.yml en {root} — instalación incompleta.")
        return 1

    node_env = {**os.environ, **load_env_file(root / ".env")}
    node_env.setdefault("PORT", str(WEB_PORT))

    if run_foreground(["docker", "compose", "up", "-d", "--build", "db"], cwd=root, tag="docker", root=root) != 0:
        print("No se pudo arrancar Postgres — asegúrate de que Docker esté corriendo "
              "(Docker Desktop en Windows, el servicio docker en Linux) y vuelve a intentarlo.")
        return 1

    runtime = read_runtime_marker(root)
    infer_cmd = inference_command(root, runtime)
    if infer_cmd is None:
        print(f"Servicio de inferencia: entorno '{runtime}' no instalado todavía — omitido "
              f"(completa /setup y vuelve a abrir Lumi).")
    else:
        print(f"Arrancando servicio de inferencia ({runtime})...")
        start_detached(infer_cmd, root / "services" / "inference", "inference", root)
        if wait_for_http_ok(f"http://localhost:{INFERENCE_PORT}/docs", timeout_s=45):
            print("Servicio de inferencia: listo.")
        else:
            print("Servicio de inferencia: no respondió a tiempo (puede seguir cargando modelos).")

    print("Arrancando worker...")
    worker_js = root / "apps" / "worker" / "worker.js"
    start_detached(["node", str(worker_js)], root, "worker", root, env=node_env)

    print(f"\nAbriendo Lumi en http://localhost:{WEB_PORT} ...")
    webbrowser.open(f"http://localhost:{WEB_PORT}")
    web_dir = root / "apps" / "web"
    return run_foreground(["node", "server.js"], cwd=web_dir, tag="web", root=root, env=node_env)


def _run_and_pause() -> int:
    try:
        return main()
    except Exception:
        traceback.print_exc()
        return 1
    finally:
        input("\nPulsa Enter para cerrar esta ventana...")


if __name__ == "__main__":
    raise SystemExit(_run_and_pause())
