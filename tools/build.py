# tools/build.py
"""
Bundles Lumi into a single Windows installer (dist/LumiSetup-<version>.exe,
built with Inno Setup) — everything needed to double-click on another
Windows machine, click through prerequisite checks, and get a Desktop
shortcut (lumi.exe) that starts Postgres, the inference service, the
worker, and the web app. See tools/templates/installer.iss for the actual
install flow, tools/templates/lumi_launcher.py for what lumi.exe does once
installed.

apps/web and apps/worker are shipped PRE-BUILT, not as raw source: the web
app is built with `next build` (output:"standalone", see
apps/web/next.config.js) into a self-contained server + trimmed
node_modules, and the worker is bundled into a single file with esbuild.
Neither needs `pnpm install` on the installed machine — only db/'s own tiny
dependency set does (its migration step still shells out via pnpm, see
tools/templates/installer.iss's CurStepChanged).

Requires:
- PyInstaller (build-time only, installed into whatever Python runs this
  script — e.g. `services/inference/venv/Scripts/pip.exe install pyinstaller`).
- esbuild (a root devDependency — `pnpm add -D esbuild -w`, already done).
- Windows Developer Mode enabled (Settings > Privacy & security > For
  developers) — `next build`'s standalone output creates node_modules
  symlinks, which Windows otherwise refuses without either Developer Mode
  or admin rights (confirmed live: EPERM: operation not permitted, symlink).
- Inno Setup 6 (https://jrsoftware.org/isdl.php) — its ISCC.exe compiler.
  Located via, in order: INNO_SETUP_COMPILER env var, common install paths
  (all-users and per-user), or PATH.

Usage: services/inference/venv/Scripts/python.exe tools/build.py [--keep-staging]
"""
import argparse
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

# Directories copied in full (source), pruning BUNDLE_EXCLUDE_DIR_NAMES —
# apps/web and apps/worker are deliberately NOT here; only their manifest
# (BUNDLE_INCLUDE_FILES below) ships, since their actual runtime code comes
# from the pre-built artifacts overlaid by overlay_built_web/_worker.
BUNDLE_INCLUDE_FULL = [
    "db",
    "services/inference",
    "docs",
    "tools",
]

# Individual files copied as-is. Workspace member package.json files
# (apps/web, apps/worker, packages/*) are included even though their source
# isn't, purely so `pnpm install --filter @netryx/db...` (still needed for
# db/'s own small migration-runner dependencies) sees a consistent pnpm
# workspace — pnpm resolves the whole pnpm-lock.yaml graph by workspace
# member path, and a member with no package.json at all confuses that.
BUNDLE_INCLUDE_FILES = [
    "package.json",
    "pnpm-workspace.yaml",
    "pnpm-lock.yaml",
    "docker-compose.yml",
    ".env.example",
    "README.md",
    "apps/web/package.json",
    "apps/worker/package.json",
    "packages/api-usage/package.json",
    "packages/geo-sampling/package.json",
    "packages/settings-repo/package.json",
    "packages/shared-types/package.json",
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


def _run(cmd: list[str], cwd: Path) -> None:
    print(f"$ {' '.join(cmd)}")
    subprocess.run(cmd, cwd=cwd, shell=(sys.platform == "win32"), check=True)


def stage_bundle(root: Path, staging_dir: Path) -> None:
    if staging_dir.exists():
        shutil.rmtree(staging_dir)
    staging_dir.mkdir(parents=True)

    for rel in BUNDLE_INCLUDE_FILES:
        src = root / rel
        if not src.exists():
            continue
        dest = staging_dir / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dest)

    for rel in BUNDLE_INCLUDE_FULL:
        src = root / rel
        if not src.exists():
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


def build_web(root: Path) -> Path:
    """Runs `next build` (output:"standalone") and returns the resulting
    standalone directory. Requires Windows Developer Mode (see module
    docstring) — without it, the build still "succeeds" but silently drops
    node_modules entries it couldn't symlink, producing a standalone build
    that fails at runtime with "Cannot find module" errors."""
    _run(["pnpm", "--filter", "@netryx/web", "build"], cwd=root)
    standalone = root / "apps" / "web" / ".next" / "standalone"
    if not standalone.exists():
        raise FileNotFoundError(
            f"{standalone} wasn't created — check apps/web/next.config.js has output:\"standalone\"."
        )
    next_module = standalone / "node_modules" / "next"
    if not next_module.exists():
        raise FileNotFoundError(
            f"{next_module} is missing — the standalone build silently dropped node_modules "
            "symlinks it couldn't create. Enable Windows Developer Mode (Settings > Privacy & "
            "security > For developers) or re-run this script from an elevated (Administrator) "
            "terminal, then build again."
        )
    return standalone


# Packages Next's standalone file-tracer (@vercel/nft) doesn't pick up because
# they're only reached through next's own require-hook at runtime, not a
# statically-traceable `require(...)` — confirmed missing from
# .next/standalone/node_modules even after adding them as a direct dependency
# of apps/web (which is otherwise enough for regular hoisted-by-pnpm deps).
RUNTIME_ONLY_DEPS = ["styled-jsx"]


def overlay_built_web(root: Path, standalone_dir: Path, staging_dir: Path) -> None:
    """Copies the standalone server + trimmed node_modules into the staged
    bundle, then adds .next/static and public/ — Next's standalone output
    deliberately excludes both (its own documented behavior), so they must
    be copied in by hand for the built app to actually serve anything."""
    dest = staging_dir / "apps" / "web"

    # Next's tracer follows the real require graph and can pull in unrelated
    # runtime data sitting under apps/web's own cwd (confirmed live: a local
    # data/queries/*.jpg folder from prior manual testing got copied into
    # .next/standalone/data) — never ship a maintainer's own local data.
    local_data = standalone_dir / "data"
    if local_data.exists():
        shutil.rmtree(local_data)

    shutil.copytree(standalone_dir, dest, dirs_exist_ok=True)

    static_src = root / "apps" / "web" / ".next" / "static"
    if static_src.exists():
        shutil.copytree(static_src, dest / ".next" / "static", dirs_exist_ok=True)

    public_src = root / "apps" / "web" / "public"
    if public_src.exists():
        shutil.copytree(public_src, dest / "public", dirs_exist_ok=True)

    for package in RUNTIME_ONLY_DEPS:
        target = dest / "node_modules" / package
        if target.exists():
            continue
        source = root / "apps" / "web" / "node_modules" / package
        if not source.exists():
            raise FileNotFoundError(
                f"{source} not found — add '{package}' as a direct dependency of "
                "apps/web/package.json and run `pnpm install` first."
            )
        shutil.copytree(source, target, dirs_exist_ok=True)


def build_worker(root: Path, work_dir: Path) -> Path:
    """Bundles the worker (a plain Node/pg-boss consumer, no build step of
    its own today) into a single CJS file via esbuild, so the installed app
    never needs tsx/typescript or the worker's own node_modules at runtime."""
    work_dir.mkdir(parents=True, exist_ok=True)
    out_file = work_dir / "worker.js"
    _run(
        [
            "pnpm", "exec", "esbuild",
            str(root / "apps" / "worker" / "src" / "index.ts"),
            "--bundle", "--platform=node", "--target=node20", "--format=cjs",
            f"--outfile={out_file}",
        ],
        cwd=root,
    )
    return out_file


def overlay_built_worker(worker_js: Path, staging_dir: Path) -> None:
    dest = staging_dir / "apps" / "worker" / "worker.js"
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(worker_js, dest)


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

    # Inno Setup's installer offers both an all-users (Program Files) and a
    # per-user (no admin rights needed) install mode — the latter lands
    # under %LOCALAPPDATA%\Programs instead. Confirmed live: a real install
    # was only found there, not under Program Files (x86), so both are
    # checked rather than assuming the all-users path.
    candidate_paths = [
        Path(r"C:\Program Files (x86)\Inno Setup 6\ISCC.exe"),
        Path(r"C:\Program Files\Inno Setup 6\ISCC.exe"),
        Path(os.environ.get("LOCALAPPDATA", "")) / "Programs" / "Inno Setup 6" / "ISCC.exe",
    ]
    for candidate in candidate_paths:
        if candidate.exists():
            return candidate

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

    print("Building the web app (next build --standalone)...")
    standalone_dir = build_web(root)
    overlay_built_web(root, standalone_dir, staging_dir)

    print("Bundling the worker (esbuild)...")
    worker_work_dir = dist_dir / "_esbuild-work"
    worker_js = build_worker(root, worker_work_dir)
    overlay_built_worker(worker_js, staging_dir)
    shutil.rmtree(worker_work_dir, ignore_errors=True)

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
