# tools/templates/lumi_launcher.py
"""
Compiled by tools/build.py (PyInstaller --onefile) into lumi.exe — the icon
the Inno Setup installer places on the Desktop and Start Menu. This is NOT
the installer: by the time this ever runs, Inno Setup has already copied
files, installed db/'s tiny dependency set, written .env, and started
Postgres (see tools/templates/installer.iss's CurStepChanged). lumi.exe's
only job: start the inference service (skipped with a message if its
/setup step hasn't run yet), the pre-bundled worker, and the pre-built web
server, then open the browser — closing this window stops everything.

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
import time
import traceback
import urllib.error
import urllib.request
import webbrowser
from pathlib import Path

INFERENCE_PORT = 8000
WEB_PORT = 3000


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


def read_runtime_marker(root: Path) -> str:
    """Mirrors apps/web/lib/runtime-marker.ts's output exactly — written once
    setup completes. Defaults to "windows" if setup hasn't run yet."""
    marker_path = root / "data" / "runtime-config.json"
    try:
        data = json.loads(marker_path.read_text(encoding="utf-8"))
        runtime = data.get("inferenceRuntime")
        return runtime if runtime in ("windows", "wsl") else "windows"
    except (OSError, ValueError):
        return "windows"


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
    python_exe = venv / "Scripts" / "python.exe"
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


def start_detached(cmd: list[str], cwd: Path, env: dict[str, str] | None = None) -> subprocess.Popen:
    # CREATE_NEW_PROCESS_GROUP so closing lumi.exe's console doesn't send
    # Ctrl+C/Ctrl+Break to these children — they're meant to keep running.
    creationflags = subprocess.CREATE_NEW_PROCESS_GROUP if sys.platform == "win32" else 0
    return subprocess.Popen(
        cmd, cwd=cwd, shell=(sys.platform == "win32" and cmd[0] not in ("wsl.exe",)),
        creationflags=creationflags, env=env,
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )


def run_foreground(cmd: list[str], cwd: Path, env: dict[str, str] | None = None) -> int:
    print(f"$ {' '.join(cmd)}")
    return subprocess.call(cmd, cwd=cwd, shell=(sys.platform == "win32"), env=env)


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

    if run_foreground(["docker", "compose", "up", "-d", "--build", "db"], cwd=root) != 0:
        print("No se pudo arrancar Postgres — abre Docker Desktop y vuelve a intentarlo.")
        return 1

    runtime = read_runtime_marker(root)
    infer_cmd = inference_command(root, runtime)
    if infer_cmd is None:
        print(f"Servicio de inferencia: entorno '{runtime}' no instalado todavía — omitido "
              f"(completa /setup y vuelve a abrir Lumi).")
    else:
        print(f"Arrancando servicio de inferencia ({runtime})...")
        start_detached(infer_cmd, root / "services" / "inference")
        if wait_for_http_ok(f"http://localhost:{INFERENCE_PORT}/docs", timeout_s=45):
            print("Servicio de inferencia: listo.")
        else:
            print("Servicio de inferencia: no respondió a tiempo (puede seguir cargando modelos).")

    print("Arrancando worker...")
    worker_js = root / "apps" / "worker" / "worker.js"
    start_detached(["node", str(worker_js)], root, env=node_env)

    print(f"\nAbriendo Lumi en http://localhost:{WEB_PORT} ...")
    webbrowser.open(f"http://localhost:{WEB_PORT}")
    web_dir = root / "apps" / "web"
    return run_foreground(["node", "server.js"], cwd=web_dir, env=node_env)


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
