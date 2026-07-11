# Bundler with a Compiled .exe Installer (tools/build.py) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `tools/build.py` produces `dist/lumi-<version>.zip` — a clean, distributable snapshot of the project (no `node_modules`/venvs/caches/`.git`) that contains, at its root, a single double-clickable `LumiInstaller.exe`. Running that exe gets a fresh machine from "just unzipped this" to "the web app is running and the browser is open on it" — no separate `.py` installer script for end users to run.

**Architecture:** `tools/build.py` (run by the maintainer, not end users) does two things: stages a clean copy of the source tree into `dist/lumi-<version>/` (reusing the same include/exclude rules as before), then invokes PyInstaller to compile `tools/installer_source.py` into `LumiInstaller.exe` and places it at the root of that staged folder. `tools/installer_source.py` holds the installer's actual logic (prereq checks, `pnpm install`, start Postgres, launch the dev server, open the browser) — it is the *source* PyInstaller compiles, not something an end user ever runs with `python`. It deliberately does NOT reimplement the app's already-built `/setup` wizard; its job ends the moment the dev server is up.

**Tech Stack:** Python 3 stdlib only for the installer logic itself (`shutil`, `subprocess`, `sys`, `webbrowser`, `pathlib`). `PyInstaller` is a **build-time-only** dependency — needed by whoever runs `tools/build.py` (the maintainer), never by the people who receive the resulting `.exe`. No test suite for anything under `tools/` (explicitly out of scope per this plan).

## Global Constraints

- No test files under `tools/` — this plan intentionally skips TDD for this tooling; verification is manual (run it, inspect the output).
- `PyInstaller` is installed once into the existing `services/inference/venv` (already has a working Python + pip on this machine — no new venv needed just to build an installer): `services/inference/venv/Scripts/pip.exe install pyinstaller`. It is a dev/maintainer tool, not listed in `services/inference/requirements.txt` (that file is the *runtime* dependency list for the inference service itself).
- Never bundle or read secrets: `.env` is excluded from the bundle by construction (it is simply absent from the include list, not filtered out after the fact); `.env.example` (placeholder values only) is the thing that DOES get bundled and copied to `.env` by the installer.
- Exclude from any bundle: `node_modules/`, `.next/`, `venv/`, `venv-wsl/`, `.pip-cache/`, `.pip-cache-wsl/`, `__pycache__/`, `data/`, `.git/`, `dist/` — exactly the directories already in `.gitignore` (`E:\Lumi\.gitignore`) plus the two pip-cache folders added alongside the WSL2 install path.
- Commit after every task.

---

### Task 1: `.env.example` — the sanitized template the installer copies from

**Files:**
- Create: `.env.example`

**Interfaces:**
- Produces: a file `tools/installer_source.py` (Task 2) copies to `.env` when `.env` doesn't already exist, and that `tools/build.py` (Task 4) includes in every bundle (the real `.env` is never bundled — it's simply not in `BUNDLE_INCLUDE`).

- [ ] **Step 1: Create the file**

```bash
# .env.example
# Copy of the infra-level defaults from the real .env (never commit .env
# itself — this file is the only one that gets bundled/distributed).
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_USER=netryx
POSTGRES_PASSWORD=changeme
POSTGRES_DB=netryx_dev

PORT=3000
NODE_ENV=development

# Optional: if unset, apps/web generates and persists one at
# apps/web/data/settings.key on first boot (see spec §14.4).
# SETTINGS_ENCRYPTION_KEY=

# Optional — absolute path to the shared settings encryption key. Leave
# unset to use the default under apps/web/data/settings.key.
# SETTINGS_KEY_PATH=

# Optional — moves heavy on-disk data onto a custom path (e.g. a bigger
# drive). Leave both commented out and they default to living INSIDE this
# repo clone (data/models-cache, data/street-view — both .gitignore'd).
# MODELS_CACHE_DIR=
# STREET_VIEW_IMAGE_DIR=
```

- [ ] **Step 2: Commit**

```bash
git add .env.example
git commit -m "chore: add sanitized .env.example for the installer/bundler"
```

---

### Task 2: `tools/installer_source.py` — the installer's actual logic

**Files:**
- Create: `tools/installer_source.py`

**Interfaces:**
- Produces: `project_root() -> Path`, `missing_tools() -> list[str]`, `main() -> int`. Consumed by Task 4 (`tools/build.py` compiles this file with PyInstaller into `LumiInstaller.exe`).

- [ ] **Step 1: Create the file**

```python
# tools/installer_source.py
"""
Source for LumiInstaller.exe (compiled by tools/build.py via PyInstaller —
see Task 4). This file is not meant to be run directly by end users; it's
the entry point PyInstaller packages into a single .exe that ends up at the
ROOT of the distributed project folder (next to package.json, apps/, etc.),
placed there by tools/build.py's staging step.

What it does: checks Node.js/pnpm/Python/Docker are on PATH, creates .env
from .env.example if missing, runs `pnpm install`, starts Postgres via
`docker compose`, then starts the web app and opens the browser on it.

What it deliberately does NOT do: reimplement the app's own setup wizard
(Install/Database/Credentials/Confirm at /setup, already built — see
apps/web/app/setup/SetupWizard.tsx). This script's job ends the moment the
dev server is up; the wizard takes over from there, exactly as it already
does for anyone who runs `pnpm dev` by hand (see
apps/web/app/(protected)/gate.ts — any protected route redirects to /setup
until setup is completed).
"""
import shutil
import subprocess
import sys
import webbrowser
from pathlib import Path

REQUIRED_TOOLS = ["node", "pnpm", "python", "docker"]


def project_root() -> Path:
    if getattr(sys, "frozen", False):
        # Running as the compiled LumiInstaller.exe: PyInstaller sets
        # sys.frozen=True and sys.executable to the exe's own real path.
        # tools/build.py places that exe at the project root when staging,
        # so its own directory IS the project root.
        return Path(sys.executable).resolve().parent
    # Running as plain `python tools/installer_source.py` (dev testing):
    # tools/installer_source.py -> tools -> repo root.
    return Path(__file__).resolve().parent.parent


def missing_tools() -> list[str]:
    return [t for t in REQUIRED_TOOLS if shutil.which(t) is None]


def run(cmd: list[str], cwd: Path) -> int:
    print(f"$ {' '.join(cmd)}")
    return subprocess.call(cmd, cwd=cwd, shell=(sys.platform == "win32"))


def main() -> int:
    root = project_root()

    missing = missing_tools()
    if missing:
        print("Faltan estas herramientas en tu PATH:", ", ".join(missing))
        print("Instálalas (Node.js + pnpm, Python 3, Docker Desktop) y vuelve a ejecutar LumiInstaller.exe.")
        return 1

    env_path = root / ".env"
    example_path = root / ".env.example"
    if not env_path.exists() and example_path.exists():
        shutil.copy2(example_path, env_path)
        print(f"Creado {env_path} a partir de .env.example — puedes editarlo antes de continuar si quieres.")

    if run(["pnpm", "install"], cwd=root) != 0:
        print("pnpm install falló — revisa el error de arriba.")
        return 1

    if run(["docker", "compose", "up", "-d", "--build", "db"], cwd=root) != 0:
        print("No se pudo arrancar Postgres — ¿está Docker Desktop corriendo?")
        return 1

    print("\nTodo listo. Arrancando la web en http://localhost:3000 ...")
    print("La primera vez te llevará automáticamente al asistente de instalación (/setup).")
    webbrowser.open("http://localhost:3000")
    return run(["pnpm", "--filter", "@netryx/web", "dev"], cwd=root)


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 2: Manually verify it runs as plain Python** (does not require PyInstaller — quick sanity check before Task 4 compiles it)

Run: `services/inference/venv/Scripts/python.exe tools/installer_source.py`
Expected: prints the prereq check results; if all four tools are present, proceeds to `pnpm install` / starts Postgres / opens the browser. Ctrl+C to stop once you've confirmed it starts correctly — no need to let the dev server run to completion for this check.

- [ ] **Step 3: Commit**

```bash
git add tools/installer_source.py
git commit -m "feat(tools): add installer_source.py — the logic LumiInstaller.exe compiles from"
```

---

### Task 3: `tools/lumi_paths.py` — what belongs in a bundle

**Files:**
- Create: `tools/lumi_paths.py`

**Interfaces:**
- Produces: `read_version(root: Path) -> str`, `BUNDLE_INCLUDE: list[str]`, `BUNDLE_EXCLUDE_DIR_NAMES: set[str]`, `should_include(rel_path: Path) -> bool`. Consumed by Task 4 (`tools/build.py`).

- [ ] **Step 1: Create the file**

```python
# tools/lumi_paths.py
"""
Pure helpers for tools/build.py: what counts as "the project" for a
distributable bundle. No side effects, no subprocess calls.
"""
import json
from pathlib import Path

# Repo-relative top-level entries to walk when staging a bundle (Task 4).
# Anything not listed here never makes it into a bundle, regardless of
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

# Mirrors .gitignore's intent (repo root .gitignore) — dev-only, generated,
# or multi-GB directories that must never end up in a distributable bundle.
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


def should_include(rel_path: Path) -> bool:
    """True if a repo-relative path should be copied into a bundle."""
    return not any(part in BUNDLE_EXCLUDE_DIR_NAMES for part in rel_path.parts)
```

- [ ] **Step 2: Commit**

```bash
git add tools/lumi_paths.py
git commit -m "feat(tools): add bundle include/exclude path rules"
```

---

### Task 4: `tools/build.py` — stage the bundle, compile the installer exe into it, zip it

**Files:**
- Create: `tools/build.py`

**Interfaces:**
- Consumes: `BUNDLE_INCLUDE`, `should_include`, `read_version` from `tools/lumi_paths.py` (Task 3); compiles `tools/installer_source.py` (Task 2) via PyInstaller.
- Produces: `stage_bundle(root: Path, staging_dir: Path) -> None`, `build_installer_exe(root: Path, staging_dir: Path) -> Path`, `make_zip(staging_dir: Path, zip_path: Path) -> Path`, `main(argv=None) -> int` — the CLI entry point maintainers run.

- [ ] **Step 1: Create the file**

```python
# tools/build.py
"""
Bundles Lumi into a distributable zip: apps/, packages/, db/, services/
inference/ (source only), docs/, tools/, the top-level workspace/config
files, PLUS a compiled LumiInstaller.exe at the root of the staged folder —
everything needed to unzip on another Windows machine and double-click one
file to get running. See tools/lumi_paths.py for the exact include/exclude
rules, tools/installer_source.py for what the exe actually does.

Requires PyInstaller (build-time only — see this plan's Global Constraints
for the one-time `pip install pyinstaller` into services/inference/venv).

Usage: services/inference/venv/Scripts/python.exe tools/build.py [--keep-staging]
"""
import argparse
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from lumi_paths import BUNDLE_INCLUDE, read_version, should_include  # noqa: E402


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
        for path in src.rglob("*"):
            if path.is_dir():
                continue
            rel_path = path.relative_to(root)
            if not should_include(rel_path):
                continue
            dest = staging_dir / rel_path
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(path, dest)


def build_installer_exe(root: Path, staging_dir: Path) -> Path:
    """Compiles tools/installer_source.py into LumiInstaller.exe, placed at
    the root of staging_dir (so it sits right next to package.json etc. once
    unzipped — see installer_source.py's project_root() for why)."""
    work_dir = root / "dist" / "_pyinstaller-work"
    subprocess.run(
        [
            sys.executable, "-m", "PyInstaller",
            "--onefile",
            "--name", "LumiInstaller",
            "--distpath", str(staging_dir),
            "--workpath", str(work_dir),
            "--specpath", str(work_dir),
            str(root / "tools" / "installer_source.py"),
        ],
        check=True,
    )
    shutil.rmtree(work_dir, ignore_errors=True)
    return staging_dir / "LumiInstaller.exe"


def make_zip(staging_dir: Path, zip_path: Path) -> Path:
    zip_path.parent.mkdir(parents=True, exist_ok=True)
    if zip_path.exists():
        zip_path.unlink()
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for path in staging_dir.rglob("*"):
            if path.is_file():
                zf.write(path, path.relative_to(staging_dir.parent))
    return zip_path


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Bundle Lumi into a distributable zip with a compiled installer.")
    parser.add_argument("--keep-staging", action="store_true", help="Don't delete the staging directory after zipping.")
    args = parser.parse_args(argv)

    root = Path(__file__).resolve().parent.parent
    version = read_version(root)
    dist_dir = root / "dist"
    staging_dir = dist_dir / f"lumi-{version}"
    zip_path = dist_dir / f"lumi-{version}.zip"

    print(f"Bundling Lumi {version}...")
    stage_bundle(root, staging_dir)

    print("Compiling LumiInstaller.exe (PyInstaller)...")
    exe_path = build_installer_exe(root, staging_dir)
    print(f"  -> {exe_path}")

    make_zip(staging_dir, zip_path)
    if not args.keep_staging:
        shutil.rmtree(staging_dir)
    print(f"Bundle ready: {zip_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 2: Install the one-time build-time dependency**

Run: `services/inference/venv/Scripts/pip.exe install pyinstaller`
Expected: installs cleanly (pure build tool, no CUDA/torch interaction).

- [ ] **Step 3: Manually verify the real bundle**

Run: `services/inference/venv/Scripts/python.exe tools/build.py`
Expected: prints `Bundling Lumi 0.1.0...`, then `Compiling LumiInstaller.exe (PyInstaller)...` (PyInstaller's own build log follows), then `Bundle ready: E:\Lumi\dist\lumi-0.1.0.zip`. Open the zip and confirm: `LumiInstaller.exe` sits at its root (next to `package.json`, `apps/`, `services/`), `.env.example` is present, and there is NO `node_modules`, `venv`, `venv-wsl`, `.pip-cache*`, `data`, or `.git` anywhere inside.

- [ ] **Step 4: Commit**

```bash
git add tools/build.py
git commit -m "feat(tools): build.py stages a bundle and compiles LumiInstaller.exe into it"
```

---

### Task 5: `README.md` — document the bundle + installer

**Files:**
- Create: `README.md`

- [ ] **Step 1: Create the file**

```markdown
# Lumi

Street-level image geolocation. Self-hosted, Windows-native (with an optional
WSL2 fast path for the verification model — see `/setup`).

## For people who received a Lumi bundle (a `lumi-<version>.zip`)

Unzip it, then double-click **`LumiInstaller.exe`** at its root. It checks
you have Node.js + pnpm, Python 3, and Docker Desktop on your PATH, creates
`.env` from `.env.example` if you don't have one yet, runs `pnpm install`,
starts Postgres via `docker compose`, then starts the web app and opens your
browser on it. The first time, you'll land on `/setup` — a step-by-step
wizard that installs the inference service's Python dependencies, downloads
the model weights, sets up the database schema, and collects your Google
Street View API key.

## For maintainers: building a bundle

```bash
services/inference/venv/Scripts/pip.exe install pyinstaller   # once
services/inference/venv/Scripts/python.exe tools/build.py
```

Produces `dist/lumi-<version>.zip`: a clean snapshot of the project (source,
docs, configs — no `node_modules`, Python virtual environments, model-weight
caches, or `.git` history) with `LumiInstaller.exe` compiled and placed at
its root.

## Manual setup (no installer)

See `docs/` for the detailed sub-project specs and plans if you'd rather run
each piece by hand (`pnpm install`, `pnpm db:up`, `pnpm --filter @netryx/web dev`,
plus the inference service under `services/inference`).
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add README documenting the bundle and LumiInstaller.exe"
```

---

## Final verification

- [ ] `services/inference/venv/Scripts/python.exe tools/installer_source.py` runs and reaches the prereq check without error (Ctrl+C once confirmed — no need to let it fully install).
- [ ] `services/inference/venv/Scripts/python.exe tools/build.py` → produces `dist/lumi-0.1.0.zip` containing `LumiInstaller.exe` at its root and no excluded directories.
- [ ] Manual, only when ready to actually run it: unzip `dist/lumi-0.1.0.zip` somewhere else, double-click `LumiInstaller.exe`, confirm it reaches a running dev server with the browser open on `/setup`.

## Self-Review (coverage)

- "instalador sencillo de usar" → a single double-clickable `LumiInstaller.exe` (Tasks 2 + 4), not a script the user has to know how to invoke.
- "tools/build.py para bundlear el proyecto" → Task 4, using the include/exclude rules from Task 3.
- "que el install.py no exista" → there is no `tools/install.py`; the installer's logic lives in `tools/installer_source.py`, which is PyInstaller's *input*, compiled away into the `.exe` — nothing named `install.py` ships or is meant to be run directly.
- "elimina los tests de python de las tools" → no test files anywhere under `tools/` in this plan.
- Bundle must never leak secrets → Task 3's exclude set + Task 1's `.env.example` (the only env template ever bundled; the real `.env` is never in `BUNDLE_INCLUDE`).
- Bundle must never include the multi-GB venvs/caches from the WSL2 work → Task 3's `BUNDLE_EXCLUDE_DIR_NAMES` lists `venv`, `venv-wsl`, `.pip-cache`, `.pip-cache-wsl` (matching the `.gitignore` entries from that feature).

## Type cross-check

`should_include(rel_path: Path) -> bool` (Task 3) used identically in Task 4's `stage_bundle`. `BUNDLE_INCLUDE`/`read_version` (Task 3) imported and used as-is in Task 4, no renaming. `project_root()` (Task 2) correctly branches on `sys.frozen` for the compiled-exe case vs. plain-Python dev testing — both paths resolve to the same directory once staged (`LumiInstaller.exe`'s own folder == the repo root when run from source), so no divergent behavior between "tested as .py" and "shipped as .exe".
