#!/usr/bin/env python3
"""Publica una version en el canal de actualizaciones.

  python tools/release.py <borrador.json>

El borrador tiene el mismo formato que espera `lumi actualizaciones firmar`,
salvo que cada artefacto puede traer "archivo" (una ruta local) en vez de
"sha256"+"bytes" — este script calcula esos dos campos y los completa antes
de firmar. El calculo de sha256 vive aqui porque es trabajo mecanico; firmar
vive en Rust (`lumi-cli`) porque tiene que usar el mismo codigo de
serializacion que luego verifica, o la canonicalizacion podria divergir
entre Python y Rust.
"""
import hashlib
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SALIDA = ROOT / "web" / "releases" / "versiones.json"


def sha256_de(ruta):
    h = hashlib.sha256()
    with open(ruta, "rb") as f:
        for trozo in iter(lambda: f.read(1 << 20), b""):
            h.update(trozo)
    return h.hexdigest()


def resolver_artefactos(borrador):
    for publicacion in borrador["publicaciones"]:
        for artefacto in publicacion["artefactos"]:
            archivo = artefacto.pop("archivo", None)
            if archivo:
                ruta = Path(archivo)
                artefacto["bytes"] = ruta.stat().st_size
                artefacto["sha256"] = sha256_de(ruta)
    return borrador


def main():
    if len(sys.argv) != 2:
        print(f"uso: {sys.argv[0]} <borrador.json>", file=sys.stderr)
        sys.exit(1)

    borrador_path = Path(sys.argv[1])
    borrador = json.loads(borrador_path.read_text())
    resuelto = resolver_artefactos(borrador)

    resuelto_path = borrador_path.with_name(borrador_path.stem + ".resuelto.json")
    resuelto_path.write_text(json.dumps(resuelto, indent=2))

    subprocess.run(
        [
            "cargo", "run", "-p", "lumi-cli", "--",
            "actualizaciones", "firmar", str(resuelto_path), str(SALIDA),
        ],
        cwd=ROOT,
        check=True,
    )
    print(f"listo: {SALIDA}")


if __name__ == "__main__":
    main()
