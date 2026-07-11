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
import time
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


def _copy_file_with_retry(src: Path, dst: Path, attempts: int = 8) -> None:
    """Individual files under node_modules intermittently raise WinError 32
    ("being used by another process") right after being (re)written — seen
    live to affect an entire package's worth of files at once, consistent
    with Windows Search's SearchProtocolHost indexing freshly-written .js
    content out from under us. Confirmed NOT a persistent lock (the same
    file deletes cleanly moments later), so a short per-file retry rides
    through it — far cheaper than re-copying an entire tree on failure."""
    last_error: Exception | None = None
    for attempt in range(1, attempts + 1):
        try:
            shutil.copy2(src, dst)
            return
        except (PermissionError, OSError) as exc:
            last_error = exc
            if attempt < attempts:
                time.sleep(0.5 * attempt)
    raise last_error


def _copytree_with_retry(src: Path, dst: Path, ignore_dirs: frozenset = frozenset()) -> None:
    """Manual recursive copy (not shutil.copytree) so a transient per-file
    lock only costs a retry on that one file, not the whole subtree."""
    dst.mkdir(parents=True, exist_ok=True)
    for entry in src.iterdir():
        if entry.name in ignore_dirs:
            continue
        target = dst / entry.name
        if entry.is_dir():
            # is_dir() follows symlinks, so directory-symlinks (e.g. next's
            # own node_modules/next -> pnpm store) are dereferenced and their
            # real contents copied in, matching shutil.copytree's default
            # (symlinks=False) behavior instead of trying to open a
            # directory as a file.
            _copytree_with_retry(entry, target, ignore_dirs)
        elif not target.exists():
            _copy_file_with_retry(entry, target)


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


def _installed_package_names(node_modules: Path) -> list[str]:
    """Lists direct entries of a node_modules dir as require()-able package
    names, expanding scoped (@scope/name) packages one level down."""
    names: list[str] = []
    if not node_modules.exists():
        return names
    for entry in sorted(node_modules.iterdir()):
        if not entry.is_dir() or entry.name in (".bin", ".pnpm"):
            continue
        if entry.name.startswith("@"):
            for sub in sorted(entry.iterdir()):
                if sub.is_dir():
                    names.append(f"{entry.name}/{sub.name}")
        else:
            names.append(entry.name)
    return names


def _resolve_package_dir(root: Path, source_modules: Path, name: str) -> Path | None:
    """Finds a package's real (non-symlink) directory: prefer apps/web's own
    top-level copy — with .npmrc's package-import-method=copy this is a real
    directory, not a symlink, so `.resolve()` on it is a no-op and can't be
    used to hop into the pnpm store like it could pre-copy-mode — falling
    back to scanning node_modules/.pnpm for a folder whose name starts with
    '<encoded-name>@' (pnpm's on-disk key format, scopes encoded as '+') for
    nested-only packages (e.g. styled-jsx, pg-types) that never get a
    top-level entry of their own."""
    top_level = source_modules / name
    if top_level.exists():
        return top_level.resolve() if top_level.is_symlink() else top_level

    pnpm_store = root / "node_modules" / ".pnpm"
    if not pnpm_store.exists():
        return None
    store_key_prefix = name.replace("/", "+") + "@"
    for entry in pnpm_store.iterdir():
        if entry.name.startswith(store_key_prefix):
            candidate = entry / "node_modules" / name
            if candidate.exists():
                return candidate
    return None


def _ensure_complete_dependency_closure(root: Path, dest: Path) -> None:
    """Next's standalone file-tracer (@vercel/nft) is unreliable on this
    pnpm-managed monorepo in two ways, both confirmed live: it drops whole
    sibling packages next/pg/etc. resolve via pnpm's virtual store rather
    than a statically-traceable `require(...)` (styled-jsx, @swc/helpers,
    @next/env, pg-types, ...), AND it drops individual files *within* an
    already-copied package once a route touches a code path its static
    analysis doesn't see (react-dom missing its own server.browser.js).
    Rather than patch each missing name/file as it's discovered, merge in
    the COMPLETE real content (dirs_exist_ok=True — adds/overwrites, never
    deletes what nft did correctly include) for every direct dependency of
    apps/web, then recurse into each package's own declared `dependencies`
    the same way. Trades some shipped-but-unused bytes (e.g. client-only
    libs like mapbox-gl also landing in node_modules) for not playing
    whack-a-mole with nft's static analysis forever."""
    source_modules = root / "apps" / "web" / "node_modules"
    dest_modules = dest / "node_modules"
    seen: set[str] = set()

    def visit(name: str) -> None:
        if name in seen:
            return
        seen.add(name)
        real_dir = _resolve_package_dir(root, source_modules, name)
        if real_dir is None or not real_dir.exists():
            return

        target = dest_modules / name
        target.parent.mkdir(parents=True, exist_ok=True)
        _copytree_with_retry(real_dir, target, ignore_dirs=frozenset({"node_modules"}))

        pkg_json = real_dir / "package.json"
        if not pkg_json.exists():
            return
        deps = json.loads(pkg_json.read_text(encoding="utf-8")).get("dependencies", {})
        for dep_name in deps:
            visit(dep_name)

    for name in _installed_package_names(source_modules):
        visit(name)


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

    _copytree_with_retry(standalone_dir, dest)

    static_src = root / "apps" / "web" / ".next" / "static"
    if static_src.exists():
        _copytree_with_retry(static_src, dest / ".next" / "static")

    public_src = root / "apps" / "web" / "public"
    if public_src.exists():
        _copytree_with_retry(public_src, dest / "public")

    _ensure_complete_dependency_closure(root, dest)


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

    # Guards against a flaky local pnpm store: seen live where node_modules/
    # .pnpm/next@... shrank to a near-empty stub between two otherwise
    # identical `pnpm --filter @netryx/web build` runs, breaking the build
    # with "Cannot find module './impl'" — `--force` re-links everything from
    # the store before we rely on it being intact.
    print("Reinstalling dependencies (pnpm install --force)...")
    _run(["pnpm", "install", "--force"], cwd=root)

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
