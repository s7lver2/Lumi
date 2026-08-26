"""Flujo interactivo de `python tools/build.py release` — ver
docs/superpowers/specs/2026-08-26-release-interactivo-design.md.

Vive aparte de build.py porque es un archivo grande con una responsabilidad
propia (orquestar un release), no una rama más de los targets de dev.
"""
from __future__ import annotations

import json
import re
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

from tsuki_ux import (
    ConfigEntry, Spinner, config_table, fail, header, run, section, step, success, warn,
)

REPO_GITHUB = "s7lver2/Lumi"
WSL_RUTA_LUMI = "~/Lumi"
PRODUCTOS = ("cliente", "indexer", "lumid")

# (ruta relativa a la raiz del repo, tipo de archivo)
VERSION_FILES = [
    ("Cargo.toml", "cargo"),
    ("client/src-tauri/Cargo.toml", "cargo"),
    ("client/src-tauri/tauri.conf.json", "tauri"),
    ("indexer/src-tauri/Cargo.toml", "cargo"),
    ("indexer/src-tauri/tauri.conf.json", "tauri"),
    ("installer/src-tauri/Cargo.toml", "cargo"),
    ("installer/src-tauri/tauri.conf.json", "tauri"),
]


def escribir_version(root: Path, nueva: str) -> None:
    """Escribe `nueva` en los 7 sitios de VERSION_FILES. Un `step`/`success`
    por archivo — si alguno no tiene una linea de version reconocible, para
    ahi mismo en vez de escribir los demas a medias."""
    for rel, tipo in VERSION_FILES:
        ruta = root / rel
        step(f"versión → {rel}")
        if tipo == "cargo":
            texto = ruta.read_text()
            nuevo_texto, n = re.subn(r'(?m)^version = "[^"]*"', f'version = "{nueva}"', texto, count=1)
            if n == 0:
                fail(f"{rel}: no se encontró una línea 'version = \"...\"'")
                raise SystemExit(1)
            ruta.write_text(nuevo_texto)
        else:
            datos = json.loads(ruta.read_text())
            datos["version"] = nueva
            ruta.write_text(json.dumps(datos, indent=2) + "\n")
        success(f"{rel} → {nueva}")


def leer_ultimas_publicadas(root: Path) -> dict[str, dict | None]:
    """La publicación más reciente (por `publicado`) de cada producto en
    web/releases/versiones.json — `None` si el producto nunca se publicó."""
    ruta = root / "web" / "releases" / "versiones.json"
    manifiesto = json.loads(ruta.read_text())
    ultimas: dict[str, dict | None] = {p: None for p in PRODUCTOS}
    for p in manifiesto.get("publicaciones", []):
        actual = ultimas.get(p["producto"])
        if actual is None or p["publicado"] > actual["publicado"]:
            ultimas[p["producto"]] = p
    return ultimas


def mostrar_tabla_ultimas(ultimas: dict[str, dict | None]) -> None:
    entradas = []
    for producto in PRODUCTOS:
        p = ultimas[producto]
        if p is None:
            entradas.append(ConfigEntry(producto, "sin publicar", comment=""))
        else:
            comentario = p["publicado"][:10] + (" · retirada" if p.get("retirada") else "")
            entradas.append(ConfigEntry(producto, p["version"], comment=comentario))
    config_table("última versión publicada", entradas)


def _preflight(root: Path) -> None:
    header("Publicar una versión de Lumi")

    r = subprocess.run(["gh", "auth", "status"], capture_output=True, text=True)
    if r.returncode != 0:
        fail("gh no tiene sesión iniciada")
        print(r.stderr, file=sys.stderr)
        raise SystemExit(1)

    r = subprocess.run(["git", "status", "--short"], cwd=root, capture_output=True, text=True)
    if r.stdout.strip():
        fail("el árbol de trabajo no está limpio")
        print(r.stdout, file=sys.stderr)
        raise SystemExit(1)


RE_VERSION = re.compile(r"^\d+\.\d+\.\d+$")


def preguntar_productos() -> list[str]:
    elegidos = []
    for p in PRODUCTOS:
        r = input(f"¿publicar {p}? [S/n] ").strip().lower()
        if r in ("", "s", "si", "sí", "y", "yes"):
            elegidos.append(p)
    if not elegidos:
        fail("no elegiste ningún producto")
        raise SystemExit(1)
    return elegidos


def preguntar_version() -> str:
    while True:
        v = input("versión (x.y.z): ").strip()
        if RE_VERSION.match(v):
            return v
        warn("formato inválido, ejemplo: 2.1.0")


def preguntar_notas() -> str:
    return input("notas de esta versión: ").strip()


def confirmar_plan(productos: list[str], version: str, notas: str) -> bool:
    section("Vas a publicar")
    config_table("plan", [
        ConfigEntry("productos", ", ".join(productos)),
        ConfigEntry("versión", version),
        ConfigEntry("notas", notas or "(sin notas)"),
    ])
    r = input("¿seguir? [s/N] ").strip().lower()
    return r in ("s", "si", "sí", "y", "yes")


def lanzar(root: Path) -> None:
    _preflight(root)
    section("Estado actual")
    mostrar_tabla_ultimas(leer_ultimas_publicadas(root))

    section("Qué publicar")
    productos = preguntar_productos()
    version = preguntar_version()
    notas = preguntar_notas()
    if not confirmar_plan(productos, version, notas):
        warn("cancelado")
        return

    escribir_version(root, version)
