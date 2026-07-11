# Inno Setup Installer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current PyInstaller-wrapped `LumiInstaller.exe` + zip distribution with a real Windows installer built by Inno Setup (`ISCC.exe`), produced entirely by `tools/build.py`. The installer checks prerequisites (Docker or a reachable Postgres+pgvector+PostGIS as the mandatory DB path, WSL2 as optional), installs files and dependencies, drops a `lumi.exe` shortcut on the Desktop, configures `.env`, and finishes by launching Lumi and confirming its services actually came up. `tools/` ends up with exactly two top-level files (`build.py`, `package.py`) plus a `tools/templates/` folder holding the generated-from templates.

**Architecture:** `tools/build.py` becomes a template-driven generator: it reads `tools/templates/lumi_launcher.py` (the source PyInstaller compiles into `lumi.exe`, the post-install "start everything" icon) and `tools/templates/installer.iss` (an Inno Setup script with `__LUMI_*__` placeholders), substitutes the placeholders, compiles `lumi.exe` via PyInstaller, then compiles the final `.iss` via Inno Setup's `ISCC.exe` into one distributable `LumiSetup-<version>.exe`. Inno Setup's own `[Code]` Pascal Script section replaces `tools/installer_source.py`'s prerequisite checks and `pnpm install`/`.env` setup; `lumi_launcher.py` replaces only the "start everything" runtime portion (absorbing today's `tools/service_launcher.py`). `tools/lumi_paths.py` and `tools/installer_source.py` and `tools/service_launcher.py` are deleted — their logic moves into `build.py` (pure helpers) and `tools/templates/lumi_launcher.py` (runtime launcher) respectively.

## Global Constraints

- After this plan, `tools/` contains exactly `build.py`, `package.py`, and a `templates/` subfolder — no other top-level `.py` files. `tools/package.py` is untouched (pre-existing, unrelated `.gitignore`-aware archiver).
- No Python test files under `tools/` or `tools/templates/` (standing project preference — verify by actually running `tools/build.py` and inspecting output, not pytest).
- `ISCC.exe`'s location is never hardcoded as the only option — check `INNO_SETUP_COMPILER` env var first, then the default install path, then `PATH`, and fail with an actionable message (where to download Inno Setup) if none are found. Never silently skip the installer step.
- The Inno Setup prerequisite check for the database is a **soft warning, not a hard block**: if Docker isn't found, ask the user to confirm they already have a Postgres+pgvector+PostGIS reachable some other way, rather than refusing to install. The real, authoritative check already lives in the app's own `/setup` wizard (`apps/web/app/api/setup/prereqs/route.ts`) — the installer-level check only exists to catch the common case early, not to reimplement that logic in Pascal Script.
- `lumi_launcher.py` (compiled into `lumi.exe`) must not re-check Node/pnpm/Docker on PATH — by the time it ever runs, Inno Setup has already installed dependencies. Its only job is starting the 4 processes (db, inference, worker, web) and opening the browser, mirroring `tools/service_launcher.py`'s existing `start_all_services` logic exactly (same runtime-marker file, same skip-if-venv-missing behavior).

---

### Task 1: `tools/templates/lumi_launcher.py` — the source compiled into `lumi.exe`

**Files:**
- Create: `tools/templates/lumi_launcher.py`

**Interfaces:**
- Produces: a standalone script with a `main() -> int` entry point, no imports from anywhere else in `tools/` (it gets compiled in isolation, copied into the installed app's own directory alongside `apps/`, `services/`, etc. — its `project_root()` resolves relative to the compiled exe's own location, same convention `tools/installer_source.py`'s `project_root()` already used).

- [ ] **Step 1: Write the file**

```python
# tools/templates/lumi_launcher.py
"""
Compiled by tools/build.py (PyInstaller --onefile) into lumi.exe — the icon
the Inno Setup installer places on the Desktop and Start Menu. This is NOT
the installer: by the time this ever runs, Inno Setup has already copied
files, run `pnpm install`, written .env, and started Postgres (see
tools/templates/installer.iss's CurStepChanged). lumi.exe's only job: start
the inference service + worker (skipped with a message if their /setup step
hasn't run yet), open the browser, and run the web dev server in the
foreground — closing this window stops everything, same as the old
tools/installer_source.py + tools/service_launcher.py combination it replaces.
"""
import json
import subprocess
import sys
import time
import urllib.error
import urllib.request
import webbrowser
from pathlib import Path

INFERENCE_PORT = 8000


def project_root() -> Path:
    # sys.frozen=True + sys.executable = lumi.exe's own real path once
    # PyInstaller-compiled and installed by Inno Setup at {app}\lumi.exe —
    # its own directory IS the installed app root (apps/, services/, etc.
    # are siblings, copied there by the installer's [Files] section).
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    # Dev mode: tools/templates/lumi_launcher.py -> templates -> tools -> repo root.
    return Path(__file__).resolve().parent.parent.parent


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


def worker_command() -> list[str]:
    return ["pnpm", "--filter", "@netryx/worker", "start"]


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


def start_detached(cmd: list[str], cwd: Path) -> subprocess.Popen:
    # CREATE_NEW_PROCESS_GROUP so closing lumi.exe's console doesn't send
    # Ctrl+C/Ctrl+Break to these children — they're meant to keep running.
    creationflags = subprocess.CREATE_NEW_PROCESS_GROUP if sys.platform == "win32" else 0
    return subprocess.Popen(
        cmd, cwd=cwd, shell=(sys.platform == "win32" and cmd[0] not in ("wsl.exe",)),
        creationflags=creationflags,
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )


def run_foreground(cmd: list[str], cwd: Path) -> int:
    print(f"$ {' '.join(cmd)}")
    return subprocess.call(cmd, cwd=cwd, shell=(sys.platform == "win32"))


def main() -> int:
    root = project_root()

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
    start_detached(worker_command(), root)

    print("\nAbriendo Lumi en http://localhost:3000 ...")
    webbrowser.open("http://localhost:3000")
    return run_foreground(["pnpm", "--filter", "@netryx/web", "dev"], cwd=root)


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 2: Manually verify (no pytest under tools/ — standing preference)**

Run: `python tools/templates/lumi_launcher.py` from the repo root with Postgres/venvs already set up from earlier sessions this conversation.
Expected: prints the same sequence of lines `tools/installer_source.py` used to (Postgres up, inference runtime detected, worker started, browser opens to localhost:3000), then blocks running `next dev`. Confirm via `Get-Process -Name python,node` that background inference/worker processes exist.

- [ ] **Step 3: Commit**

```bash
git add tools/templates/lumi_launcher.py
git commit -m "feat(installer): add lumi_launcher.py, the source compiled into lumi.exe"
```

---

### Task 2: `tools/templates/installer.iss` — the Inno Setup script

**Files:**
- Create: `tools/templates/installer.iss`

**Interfaces:**
- Consumes: placeholders `__LUMI_VERSION__`, `__LUMI_STAGING_DIR__`, `__LUMI_OUTPUT_DIR__` — substituted by Task 3's `build.py` via plain `str.replace` before compiling. Deliberately NOT `{{...}}`-style tokens: Inno Setup's own `.iss` syntax already uses `{...}` for path constants (`{app}`, `{autodesktop}`) and escapes literal braces as `{{`/`}}` — reusing that syntax for our own placeholders would collide. `__LUMI_*__` tokens can't appear in valid Inno Setup syntax by coincidence, so a naive string replace is safe.
- Produces: `dist/LumiSetup-<version>.exe` when compiled by `ISCC.exe`.

- [ ] **Step 1: Write the file**

```ini
; tools/templates/installer.iss
; Placeholders __LUMI_VERSION__, __LUMI_STAGING_DIR__, __LUMI_OUTPUT_DIR__
; are substituted by tools/build.py (plain str.replace) before this is
; written to a temp .iss and compiled with ISCC.exe.

#define MyAppName "Lumi"
#define MyAppVersion "__LUMI_VERSION__"
#define MyAppExeName "lumi.exe"

[Setup]
AppId={{B4B6E4C1-8D9E-4A2E-9C1C-6D9F0F6A1234}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
DefaultDirName={autopf}\Lumi
DefaultGroupName=Lumi
DisableProgramGroupPage=yes
OutputDir=__LUMI_OUTPUT_DIR__
OutputBaseFilename=LumiSetup-{#MyAppVersion}
Compression=lzma2
SolidCompression=yes
ArchitecturesInstallIn64BitMode=x64compatible
UninstallDisplayIcon={app}\{#MyAppExeName}
WizardStyle=modern

[Languages]
Name: "spanish"; MessagesFile: "compiler:Languages\Spanish.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[Files]
Source: "__LUMI_STAGING_DIR__\*"; DestDir: "{app}"; Flags: recursesubdirs ignoreversion

[Icons]
Name: "{group}\Lumi"; Filename: "{app}\{#MyAppExeName}"
Name: "{autodesktop}\Lumi"; Filename: "{app}\{#MyAppExeName}"

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "Ejecutar Lumi ahora"; Flags: postinstall nowait skipifsilent unchecked

[Code]
var
  DockerFound: Boolean;

function IsToolOnPath(const ToolName, VersionArgs: String): Boolean;
var
  ResultCode: Integer;
begin
  Result := Exec('cmd.exe', '/c ' + ToolName + ' ' + VersionArgs + ' >nul 2>nul', '',
    SW_HIDE, ewWaitUntilTerminated, ResultCode) and (ResultCode = 0);
end;

function InitializeSetup(): Boolean;
var
  NodeFound, PnpmFound, WslFound: Boolean;
  Message: String;
begin
  NodeFound := IsToolOnPath('node', '--version');
  PnpmFound := IsToolOnPath('pnpm', '--version');
  DockerFound := IsToolOnPath('docker', '--version');
  WslFound := IsToolOnPath('wsl', '--status');

  Result := True;

  if (not NodeFound) or (not PnpmFound) then
  begin
    MsgBox('Este instalador necesita Node.js y pnpm en el PATH antes de continuar.' + #13#10 +
           'Instálalos y vuelve a ejecutar este instalador.', mbError, MB_OK);
    Result := False;
    Exit;
  end;

  if not DockerFound then
  begin
    Message := 'No se encontró Docker Desktop, la forma más sencilla de tener Postgres ' +
      '+ pgvector + PostGIS (la base de datos de Lumi).' + #13#10#13#10 +
      'Puedes cancelar e instalar Docker Desktop primero, o continuar si ya tienes ' +
      'un Postgres con esas extensiones configurado manualmente (editarás .env después).' +
      #13#10#13#10 + '¿Continuar sin Docker?';
    if MsgBox(Message, mbConfirmation, MB_YESNO) = IDNO then
    begin
      Result := False;
      Exit;
    end;
  end;

  if WslFound then
    MsgBox('WSL2 detectado — podrás activarlo como entorno de inferencia (más rápido) ' +
           'desde el asistente /setup después de instalar.', mbInformation, MB_OK);
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  ResultCode: Integer;
  EnvExample, EnvFile: String;
begin
  if CurStep = ssPostInstall then
  begin
    EnvExample := ExpandConstant('{app}\.env.example');
    EnvFile := ExpandConstant('{app}\.env');
    if (not FileExists(EnvFile)) and FileExists(EnvExample) then
      FileCopy(EnvExample, EnvFile, False);

    if DockerFound then
      Exec('cmd.exe', '/c docker compose up -d --build db', ExpandConstant('{app}'),
        SW_SHOW, ewWaitUntilTerminated, ResultCode);

    Exec('cmd.exe', '/c pnpm install', ExpandConstant('{app}'), SW_SHOW, ewWaitUntilTerminated, ResultCode);
  end;
end;
```

- [ ] **Step 2: Manually verify the .iss compiles standalone**

Run (adjust the Inno Setup install path if different):
```powershell
$staging = "E:\Lumi\dist\lumi-0.1.0"  # any already-staged folder from a prior `python tools/build.py` run
$content = Get-Content tools/templates/installer.iss -Raw
$content = $content.Replace('__LUMI_VERSION__', '0.1.0').Replace('__LUMI_STAGING_DIR__', $staging).Replace('__LUMI_OUTPUT_DIR__', 'E:\Lumi\dist')
Set-Content dist/_inno-work/installer.iss $content
& "C:\Program Files (x86)\Inno Setup 6\ISCC.exe" dist/_inno-work/installer.iss
```
Expected: `ISCC.exe` reports `Successful compile` and produces `dist\LumiSetup-0.1.0.exe`. Running that exe should show the prerequisite dialogs from `InitializeSetup`, then install and offer the Desktop shortcut.

- [ ] **Step 3: Commit**

```bash
git add tools/templates/installer.iss
git commit -m "feat(installer): add the Inno Setup script template"
```

---

### Task 3: Rewrite `tools/build.py` to generate `lumi.exe` + the Inno Setup installer

**Files:**
- Modify: `tools/build.py`
- Delete: `tools/lumi_paths.py`, `tools/installer_source.py`, `tools/service_launcher.py`

**Interfaces:**
- Produces: `dist/LumiSetup-<version>.exe` (single distributable artifact — replaces the old `dist/lumi-<version>.zip`).
- Consumes: `tools/templates/lumi_launcher.py` (Task 1), `tools/templates/installer.iss` (Task 2).

- [ ] **Step 1: Inline `lumi_paths.py`'s pure helpers directly into `build.py`**

`lumi_paths.py` has zero subprocess/side-effect code (`BUNDLE_INCLUDE`, `BUNDLE_EXCLUDE_DIR_NAMES`, `read_version`) — move these constants/function bodies verbatim into `build.py`'s own top level, replacing the `from lumi_paths import ...` line.

- [ ] **Step 2: Add an ISCC.exe locator and replace `build_installer_exe`/`make_zip` with the new Inno Setup pipeline**

```python
# tools/build.py — full rewritten file
"""
Bundles Lumi into a single Windows installer (dist/LumiSetup-<version>.exe,
built with Inno Setup) — everything needed to double-click on another
Windows machine, click through prerequisite checks, and get a Desktop
shortcut (lumi.exe) that starts Postgres, the inference service, the
worker, and the web app. See tools/templates/installer.iss for the actual
install flow, tools/templates/lumi_launcher.py for what lumi.exe does once
installed.

Requires:
- PyInstaller (build-time only, installed into whatever Python runs this
  script — e.g. `services/inference/venv/Scripts/pip.exe install pyinstaller`).
- Inno Setup 6 (https://jrsoftware.org/isdl.php) — its ISCC.exe compiler.
  Located via, in order: INNO_SETUP_COMPILER env var, the default install
  path, or PATH.

Usage: services/inference/venv/Scripts/python.exe tools/build.py [--keep-staging]
"""
import argparse
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

# Repo-relative top-level entries to walk when staging a bundle. Anything
# not listed here never makes it into a bundle, regardless of
# BUNDLE_EXCLUDE_DIR_NAMES below (that set only prunes WITHIN these).
BUNDLE_INCLUDE = [
    "apps/web",
    "apps/worker",
    "packages",
    "db",
    "services/inference",
    "docs",
    "tools",
    "package.json",
    "pnpm-workspace.yaml",
    "pnpm-lock.yaml",
    "docker-compose.yml",
    ".env.example",
    "README.md",
]

# Mirrors .gitignore's intent — dev-only, generated, or multi-GB directories
# that must never end up in a distributable install.
BUNDLE_EXCLUDE_DIR_NAMES = {
    "node_modules",
    ".next",
    "venv",
    "venv-wsl",
    ".pip-cache",
    ".pip-cache-wsl",
    "__pycache__",
    "data",
    ".git",
    "dist",
}


def read_version(root: Path) -> str:
    data = json.loads((root / "package.json").read_text(encoding="utf-8"))
    return data["version"]


def stage_bundle(root: Path, staging_dir: Path) -> None:
    if staging_dir.exists():
        shutil.rmtree(staging_dir)
    staging_dir.mkdir(parents=True)

    for rel in BUNDLE_INCLUDE:
        src = root / rel
        if not src.exists():
            continue
        if src.is_file():
            dest = staging_dir / rel
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src, dest)
            continue
        # os.walk with in-place dirnames pruning, NOT Path.rglob("*") — WSL-
        # created venv-wsl contains Linux-style symlinks that plain Windows
        # Python can't stat via rglob's enumerate-then-filter order; pruning
        # BEFORE os.walk descends means it's never touched at all.
        for dirpath, dirnames, filenames in os.walk(src):
            dirnames[:] = [d for d in dirnames if d not in BUNDLE_EXCLUDE_DIR_NAMES]
            for filename in filenames:
                file_path = Path(dirpath) / filename
                rel_path = file_path.relative_to(root)
                dest = staging_dir / rel_path
                dest.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(file_path, dest)


def build_lumi_exe(root: Path, staging_dir: Path) -> Path:
    """Compiles tools/templates/lumi_launcher.py into lumi.exe, placed at
    the root of staging_dir (so it sits next to apps/, services/, etc. once
    installed — see lumi_launcher.py's project_root() for why)."""
    work_dir = root / "dist" / "_pyinstaller-work"
    subprocess.run(
        [
            sys.executable, "-m", "PyInstaller",
            "--onefile",
            "--name", "lumi",
            "--distpath", str(staging_dir),
            "--workpath", str(work_dir),
            "--specpath", str(work_dir),
            str(root / "tools" / "templates" / "lumi_launcher.py"),
        ],
        check=True,
    )
    shutil.rmtree(work_dir, ignore_errors=True)
    return staging_dir / "lumi.exe"


def find_iscc(root: Path) -> Path:
    env_override = os.environ.get("INNO_SETUP_COMPILER")
    if env_override and Path(env_override).exists():
        return Path(env_override)

    default_path = Path(r"C:\Program Files (x86)\Inno Setup 6\ISCC.exe")
    if default_path.exists():
        return default_path

    on_path = shutil.which("iscc")
    if on_path:
        return Path(on_path)

    raise FileNotFoundError(
        "ISCC.exe (Inno Setup's compiler) not found. Install Inno Setup 6 "
        "(https://jrsoftware.org/isdl.php) or set INNO_SETUP_COMPILER to its "
        "full path."
    )


def build_installer_exe(root: Path, staging_dir: Path, version: str) -> Path:
    """Fills tools/templates/installer.iss's placeholders and compiles it
    with ISCC.exe into dist/LumiSetup-<version>.exe."""
    iscc = find_iscc(root)
    template = (root / "tools" / "templates" / "installer.iss").read_text(encoding="utf-8")
    dist_dir = root / "dist"
    filled = (
        template
        .replace("__LUMI_VERSION__", version)
        .replace("__LUMI_STAGING_DIR__", str(staging_dir))
        .replace("__LUMI_OUTPUT_DIR__", str(dist_dir))
    )

    work_dir = dist_dir / "_inno-work"
    work_dir.mkdir(parents=True, exist_ok=True)
    iss_path = work_dir / "installer.iss"
    iss_path.write_text(filled, encoding="utf-8")

    subprocess.run([str(iscc), str(iss_path)], check=True)
    shutil.rmtree(work_dir, ignore_errors=True)
    return dist_dir / f"LumiSetup-{version}.exe"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Build Lumi's Windows installer.")
    parser.add_argument("--keep-staging", action="store_true", help="Don't delete the staging directory after building.")
    args = parser.parse_args(argv)

    root = Path(__file__).resolve().parent.parent
    version = read_version(root)
    dist_dir = root / "dist"
    staging_dir = dist_dir / f"lumi-{version}"

    print(f"Staging Lumi {version}...")
    stage_bundle(root, staging_dir)

    print("Compiling lumi.exe (PyInstaller)...")
    exe_path = build_lumi_exe(root, staging_dir)
    print(f"  -> {exe_path}")

    print("Compiling the installer (Inno Setup)...")
    installer_path = build_installer_exe(root, staging_dir, version)
    print(f"  -> {installer_path}")

    if not args.keep_staging:
        shutil.rmtree(staging_dir)
    print(f"Installer ready: {installer_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 3: Delete the now-merged/obsolete files**

```bash
git rm tools/lumi_paths.py tools/installer_source.py tools/service_launcher.py
```

- [ ] **Step 4: Manually verify end-to-end**

Run: `services\inference\venv\Scripts\python.exe tools\build.py`
Expected console output, in order: `Staging Lumi 0.1.0...`, `Compiling lumi.exe (PyInstaller)...` + its path, `Compiling the installer (Inno Setup)...` + its path, `Installer ready: E:\Lumi\dist\LumiSetup-0.1.0.exe`. Confirm the file exists and, when run, walks through the prerequisite dialogs (Task 2) and installs a working `lumi.exe` Desktop shortcut.

- [ ] **Step 5: Commit**

```bash
git add tools/build.py
git commit -m "feat(installer): rewrite build.py to produce a single Inno Setup installer"
```

---

### Task 4: Setup wizard — verify-services already exists; add a final "arranque completo" confirmation to the installer's own finish page

**Files:**
- Modify: `tools/templates/installer.iss`

**Interfaces:**
- Consumes: nothing new — this task only adds a post-launch confirmation to the `[Run]` step already present from Task 2.

Context: the setup wizard's own "Arrancar y verificar servicios" step (added earlier this session, in `apps/web/app/api/setup/run/[step]/route.ts` and `apps/web/app/setup/steps/InstallStep.tsx`) already covers "comprobar que todo ha arrancado" for the inference service + worker once inside the browser. This task adds the installer-side equivalent: after `[Run]` launches `lumi.exe` (Task 2), the installer's finish page should tell the user what to expect instead of silently closing.

- [ ] **Step 1: Add a finish-page message pointing at `/setup`**

```ini
; tools/templates/installer.iss — add to [Setup] section (near WizardStyle=modern)
AppPublisher=Lumi
```
Add a new `[Messages]` section (Inno Setup lets you override the built-in "FinishedLabel" text):
```ini
[Messages]
FinishedLabel=Lumi se ha instalado. Al iniciarlo por primera vez se abrirá tu navegador en http://localhost:3000%n%nLa primera vez te llevará automáticamente al asistente de instalación (/setup), que instala los modelos y termina comprobando que el servicio de inferencia y el worker están realmente arrancados.
```

- [ ] **Step 2: Manually verify**

Re-run the ISCC compile from Task 2's Step 2 and confirm the finish page shows the new message before the "Ejecutar Lumi ahora" checkbox.

- [ ] **Step 3: Commit**

```bash
git add tools/templates/installer.iss
git commit -m "docs(installer): explain the /setup verification step on the installer's finish page"
```

---

### Task 5: Update `README.md`

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Replace the bundle/build sections**

Replace:
```markdown
## For people who received a Lumi bundle (a `lumi-<version>.zip`)

Unzip it, then double-click **`LumiInstaller.exe`** at its root. ...

## For maintainers: building a bundle

​```bash
services/inference/venv/Scripts/pip.exe install pyinstaller   # once
services/inference/venv/Scripts/python.exe tools/build.py
​```

Produces `dist/lumi-<version>.zip`: ...
```
with:
```markdown
## For people who received a Lumi installer

Double-click **`LumiSetup-<version>.exe`**. It checks for Node.js/pnpm
(required) and Docker Desktop (recommended — the easiest way to get
Postgres + pgvector + PostGIS; you can decline and point `.env` at an
existing Postgres instead), then installs Lumi and creates a **Lumi**
Desktop shortcut. Running that shortcut (`lumi.exe`) starts Postgres, the
inference service, the worker, and the web app, then opens your browser.
The first time, you'll land on `/setup` — a step-by-step wizard that
installs the inference service's Python dependencies, downloads the model
weights, sets up the database schema, collects your Google Street View API
key, and finishes by actually starting the inference service + worker and
confirming they're reachable.

## For maintainers: building the installer

Requires [Inno Setup 6](https://jrsoftware.org/isdl.php) (its `ISCC.exe`
compiler) and PyInstaller:
​```bash
services/inference/venv/Scripts/pip.exe install pyinstaller   # once
services/inference/venv/Scripts/python.exe tools/build.py
​```

Produces `dist/LumiSetup-<version>.exe` — a single double-clickable
installer, no separate zip.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: describe the Inno Setup installer"
```

---

## Self-Review

**1. Spec coverage:** "revise los prerequisitos obligatorios y opcionales (docker o postgres... y como optatorio wsl)" → Task 2's `InitializeSetup`. "se instalan archivos y dependencias" → Task 2's `[Files]` + `CurStepChanged`'s `pnpm install`. "genera un symlink a lumi.exe... y lo mete al escritorio" → Task 2's `[Icons]` (a Start Menu + Desktop shortcut, which is what "acceso directo"/effectively a symlink means on Windows — true NTFS symlinks would need admin rights and aren't how Windows installers normally do this, a `.lnk` shortcut is the standard and correct equivalent). "configurar rutas" → `.env` creation in `CurStepChanged`. "build.py tiene que crear un .exe, ese va a ser el lumi.exe" → Task 3's `build_lumi_exe`. "un paso en el setup que sea para comprobar que todo ha arrancado" → already exists from earlier this session (noted in Task 4's context, not re-built) plus Task 4's installer-side finish message. "solo tenga en tools build.py y package.py" → Task 3's deletions + Task 1/2 living under `tools/templates/`.

**2. Placeholder scan:** no TBD/TODO; every `.iss`/Python snippet is complete, runnable Pascal Script / Python, not pseudocode.

**3. Type consistency:** `lumi_launcher.py`'s functions (`read_runtime_marker`, `inference_command`, `worker_command`, `wait_for_http_ok`, `start_detached`) are verbatim copies of `tools/service_launcher.py`'s existing, already-tested logic (same signatures) — no drift introduced. `build.py`'s `BUNDLE_INCLUDE`/`BUNDLE_EXCLUDE_DIR_NAMES`/`read_version` are verbatim copies of `tools/lumi_paths.py`'s content before that file is deleted.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-11-inno-setup-installer.md`. Two execution options:

1. **Subagent-Driven (recommended)** - dispatch a fresh subagent per task, review between tasks, fast iteration
2. **Inline Execution** - execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
