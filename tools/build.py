#!/usr/bin/env python3
"""Dev: arranca lumid y el cliente Tauri, o el Indexer por separado.

  python tools/build.py            lumid en el puerto fijo + cliente
  python tools/build.py indexer    solo el Indexer (no necesita daemon)
  python tools/build.py build      empaqueta los dos
"""
import subprocess, sys, os
from pathlib import Path

PORT = 7717
ROOT = Path(__file__).resolve().parent.parent

def run(cmd, cwd=None, **kw):
    print(f"$ {' '.join(cmd)}")
    # ponytail: `cwd` tenía que poder venir por parámetro para lanzar comandos
    # en client/ o indexer/, pero antes se fijaba `cwd=ROOT` a la vez que se
    # pasaba `cwd=...` por **kw, y las dos claves chocaban (`TypeError: got
    # multiple values for keyword argument 'cwd'`). Ahora es un parámetro con
    # valor por defecto, no una constante repetida.
    return subprocess.run(cmd, cwd=cwd or ROOT, check=True, **kw)

def main():
    target = sys.argv[1] if len(sys.argv) > 1 else "dev"
    if target == "build":
        run(["cargo", "build", "--release"])
        run(["npm", "run", "tauri", "build"], cwd=ROOT / "client")
        run(["npm", "run", "tauri", "build"], cwd=ROOT / "indexer")
        return
    if target == "indexer":
        # El Indexer no habla con el daemon: es una app autónoma, así que aquí
        # no se levanta lumid. Levantarlo solo confundiría a quien mire los
        # logs buscando por qué el Indexer no se conecta a nada.
        run(["npm", "run", "tauri", "dev"], cwd=ROOT / "indexer")
        return
    env = {**os.environ, "LUMI_PORT": str(PORT), "LUMI_DATA": str(ROOT / ".dev-data")}
    daemon = subprocess.Popen(["cargo", "run", "-p", "lumid"], cwd=ROOT, env=env)
    try:
        run(["npm", "run", "tauri", "dev"], cwd=ROOT / "client")
    finally:
        daemon.terminate()

if __name__ == "__main__":
    main()
