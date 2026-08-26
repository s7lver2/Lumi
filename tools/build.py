#!/usr/bin/env python3
"""Dev: arranca lumid y el cliente Tauri, o el Indexer por separado.

  python tools/build.py            lumid en el puerto fijo + cliente
  python tools/build.py indexer    solo el Indexer (no necesita daemon)
  python tools/build.py build      empaqueta los dos (bundler de Tauri)
  python tools/build.py installer  instalador compartido (Tauri) de cliente + Indexer (Windows)
"""
import shutil, subprocess, sys, os
from pathlib import Path

PORT = 7717
ROOT = Path(__file__).resolve().parent.parent
# En Windows "npm" es en realidad npm.cmd, y CreateProcess (a diferencia de
# cmd.exe) no aplica PATHEXT para resolverlo sin shell=True — subprocess.run
# fallaba con WinError 2 aunque `npm` funcionara perfectamente a mano en la
# misma terminal. shutil.which sí aplica PATHEXT, así que resuelve la ruta
# real una vez aquí en vez de necesitar shell=True (y su superficie de
# inyección) en cada llamada.
NPM = shutil.which("npm") or "npm"

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
        run([NPM, "run", "tauri", "build"], cwd=ROOT / "client")
        run([NPM, "run", "tauri", "build"], cwd=ROOT / "indexer")
        return
    if target == "installer":
        # El instalador compartido reemplaza Inno/NSIS (ver
        # docs/superpowers/specs/2026-08-26-instalador-compartido-design.md):
        # un solo installer.exe (Tauri) — con --silencioso resuelve la
        # actualización sin ventana, si no abre la UI interactiva. El
        # cliente/Indexer lo dejan junto a sí mismos en la instalación
        # inicial y lo relanzan con ese flag para autoactualizarse.
        run([NPM, "run", "tauri", "build"], cwd=ROOT / "installer")
        return
    if target == "indexer":
        # El Indexer no habla con el daemon: es una app autónoma, así que aquí
        # no se levanta lumid. Levantarlo solo confundiría a quien mire los
        # logs buscando por qué el Indexer no se conecta a nada.
        run([NPM, "run", "tauri", "dev"], cwd=ROOT / "indexer")
        return
    env = {**os.environ, "LUMI_PORT": str(PORT), "LUMI_DATA": str(ROOT / ".dev-data")}
    daemon = subprocess.Popen(["cargo", "run", "-p", "lumid"], cwd=ROOT, env=env)
    try:
        run([NPM, "run", "tauri", "dev"], cwd=ROOT / "client")
    finally:
        daemon.terminate()

if __name__ == "__main__":
    main()
