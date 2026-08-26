#!/usr/bin/env python3
"""Dev: arranca lumid y el cliente Tauri, o el Indexer por separado.

  python tools/build.py            lumid en el puerto fijo + cliente
  python tools/build.py indexer    solo el Indexer (no necesita daemon)
  python tools/build.py build      empaqueta los dos (bundler de Tauri)
  python tools/build.py installer  instalador Inno de cliente + Indexer (Windows)
"""
import subprocess, sys, os
from pathlib import Path

PORT = 7717
ROOT = Path(__file__).resolve().parent.parent

def find_iscc():
    # ponytail: `winget install JRSoftware.InnoSetup` no siempre instala en
    # "C:\Program Files (x86)\Inno Setup 6" — en máquina sin privilegios de
    # admin cae a instalación por usuario bajo %LOCALAPPDATA%\Programs. Se
    # prueban las rutas conocidas en vez de asumir una sola.
    candidatas = [
        Path(r"C:\Program Files (x86)\Inno Setup 6\ISCC.exe"),
        Path(r"C:\Program Files\Inno Setup 6\ISCC.exe"),
        Path(os.environ.get("LOCALAPPDATA", "")) / "Programs" / "Inno Setup 6" / "ISCC.exe",
    ]
    for c in candidatas:
        if c.exists():
            return str(c)
    sys.exit("ISCC.exe no encontrado (instala Inno Setup 6: winget install JRSoftware.InnoSetup)")

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
    if target == "installer":
        iscc = find_iscc()
        run(["npm", "run", "tauri", "build", "--", "--no-bundle"], cwd=ROOT / "client")
        run([iscc, str(ROOT / "client" / "installer" / "lumi.iss")])
        run(["npm", "run", "tauri", "build", "--", "--no-bundle"], cwd=ROOT / "indexer")
        run([iscc, str(ROOT / "indexer" / "installer" / "lumi-indexer.iss")])
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
