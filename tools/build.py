# tools/build.py
"""
Bundles Lumi into a distributable zip: apps/, packages/, db/, services/
inference/ (source only), docs/, tools/, and the top-level workspace/config
files — everything needed to `pnpm install` + run the app on another
machine, nothing dev-only (node_modules, venvs, caches, .git, previous
dist/ output). See tools/lumi_paths.py for the exact include/exclude rules.

Usage: python tools/build.py [--keep-staging]
"""
import argparse
import shutil
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
    parser = argparse.ArgumentParser(description="Bundle Lumi into a distributable zip.")
    parser.add_argument("--keep-staging", action="store_true", help="Don't delete the staging directory after zipping.")
    args = parser.parse_args(argv)

    root = Path(__file__).resolve().parent.parent
    version = read_version(root)
    dist_dir = root / "dist"
    staging_dir = dist_dir / f"lumi-{version}"
    zip_path = dist_dir / f"lumi-{version}.zip"

    print(f"Bundling Lumi {version}...")
    stage_bundle(root, staging_dir)
    make_zip(staging_dir, zip_path)
    if not args.keep_staging:
        shutil.rmtree(staging_dir)
    print(f"Bundle ready: {zip_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())