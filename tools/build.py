#!/usr/bin/env python3
"""Dev: compila y arranca lumid en el puerto fijo, y el cliente Tauri."""
import subprocess, sys, os
from pathlib import Path

PORT = 7717
ROOT = Path(__file__).resolve().parent.parent

def run(cmd, **kw):
    print(f"$ {' '.join(cmd)}")
    return subprocess.run(cmd, cwd=ROOT, check=True, **kw)

def main():
    target = sys.argv[1] if len(sys.argv) > 1 else "dev"
    if target == "build":
        run(["cargo", "build", "--release"])
        run(["npm", "run", "tauri", "build"], cwd=ROOT / "client")
        return
    env = {**os.environ, "LUMI_PORT": str(PORT), "LUMI_DATA": str(ROOT / ".dev-data")}
    daemon = subprocess.Popen(["cargo", "run", "-p", "lumid"], cwd=ROOT, env=env)
    try:
        run(["npm", "run", "tauri", "dev"], cwd=ROOT / "client")
    finally:
        daemon.terminate()

if __name__ == "__main__":
    main()
