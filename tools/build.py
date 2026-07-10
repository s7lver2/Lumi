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
import os
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from lumi_paths import BUNDLE_EXCLUDE_DIR_NAMES, BUNDLE_INCLUDE, read_version  # noqa: E402


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
        # os.walk with in-place dirnames pruning, NOT Path.rglob("*") — this
        # is what actually skips venv-wsl instead of merely filtering it out
        # after the fact. rglob walks EVERYTHING first (to yield paths one
        # by one) and only THEN lets you decide to skip a result, so it still
        # has to stat/descend into venv-wsl to enumerate it in the first
        # place. venv-wsl was created inside WSL and contains Linux-style
        # symlinks (e.g. lib64 -> lib) that plain Windows Python can't stat
        # — confirmed live: `OSError: [WinError 1920] El sistema no tiene
        # acceso al archivo: '...\\venv-wsl\\lib64'` crashing at a bare
        # `path.is_dir()` check reached via rglob. Pruning dirnames BEFORE
        # os.walk descends means it never scans inside venv-wsl at all — the
        # broken symlink is never touched.
        for dirpath, dirnames, filenames in os.walk(src):
            dirnames[:] = [d for d in dirnames if d not in BUNDLE_EXCLUDE_DIR_NAMES]
            for filename in filenames:
                file_path = Path(dirpath) / filename
                rel_path = file_path.relative_to(root)
                dest = staging_dir / rel_path
                dest.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(file_path, dest)


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