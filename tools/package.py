#!/usr/bin/env python3
"""Comprime en zip todo lo no excluido por .gitignore."""
import subprocess, zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

def main():
    files = subprocess.run(
        ["git", "ls-files", "--cached", "--others", "--exclude-standard"],
        cwd=ROOT, capture_output=True, text=True, check=True,
    ).stdout.split("\n")
    out = ROOT / "dist" / "lumi-station.zip"
    out.parent.mkdir(exist_ok=True)
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for f in filter(None, files):
            z.write(ROOT / f, f)
    print(f"{out}  ({out.stat().st_size // 1024} KB)")

if __name__ == "__main__":
    main()
