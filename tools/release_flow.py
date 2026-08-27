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

# `tsuki_ux` imprime símbolos fuera de la BMP (por ejemplo un emoji de luna
# en `header()`), y la consola de Windows suele quedarse en el codepage
# heredado (cp1252) salvo que algo fuerce UTF-8 — sin esto, la primera
# llamada a `header()` reventaba con `UnicodeEncodeError` antes de imprimir
# nada. `errors="replace"` es la red de seguridad para cualquier símbolo que
# ni así se pueda representar.
if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

REPO_GITHUB = "s7lver2/Lumi"
WSL_RUTA_LUMI = "~/Lumi"
PRODUCTOS = ("cliente", "indexer", "lumid")

PLATAFORMA = {"cliente": "windows-x86_64", "indexer": "windows-x86_64", "lumid": "linux-x86_64"}

RUTA_BINARIO = {
    "cliente": "client/src-tauri/target/release/app.exe",
    "indexer": "indexer/src-tauri/target/release/indexer-app.exe",
    "installer": "installer/src-tauri/target/release/installer.exe",
}

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


def _ruta_montada_en_wsl(root: Path) -> str:
    """`E:\\Lumi Station` → `/mnt/e/Lumi Station` — WSL monta cada unidad de
    Windows bajo /mnt/<letra minúscula>. No asume que el repo vive en E:,
    lo calcula de la ruta real."""
    letra = root.drive.rstrip(":").lower()
    resto = str(root)[len(root.drive):].replace("\\", "/")
    return f"/mnt/{letra}{resto}"


def _construir_wsl_lumid(root: Path) -> Path:
    spinner = Spinner("Compilando lumid en WSL…")
    spinner.start()
    r = subprocess.run(
        ["wsl.exe", "--", "bash", "-lc", f"cd {WSL_RUTA_LUMI} && git pull && cargo build --release -p lumid"],
        capture_output=True, text=True,
    )
    if r.returncode != 0:
        spinner.stop(ok=False, msg="falló la compilación en WSL")
        print(r.stdout, file=sys.stderr)
        print(r.stderr, file=sys.stderr)
        raise SystemExit(1)
    spinner.stop(ok=True)

    destino_dir = root / ".release-tmp"
    destino_dir.mkdir(exist_ok=True)
    destino = destino_dir / "lumid"
    # `wsl.exe cp` en vez de leer /home/... desde Windows: la ruta \\wsl$\...
    # no siempre está montada, y esto funciona igual sin depender de eso.
    # Comillas simples alrededor del destino: la ruta del repo puede llevar
    # espacios ("Lumi Station").
    destino_wsl = f"{_ruta_montada_en_wsl(root)}/.release-tmp/lumid"
    r = subprocess.run(
        ["wsl.exe", "--", "bash", "-lc", f"cp {WSL_RUTA_LUMI}/target/release/lumid '{destino_wsl}'"],
        capture_output=True, text=True,
    )
    if r.returncode != 0 or not destino.exists():
        fail("no se pudo copiar el binario de lumid desde WSL")
        print(r.stdout, file=sys.stderr)
        print(r.stderr, file=sys.stderr)
        raise SystemExit(1)
    return destino


def construir(root: Path, productos: list[str]) -> dict[str, Path]:
    section("Construyendo")
    npm = shutil.which("npm") or "npm"
    artefactos: dict[str, Path] = {}

    if "cliente" in productos:
        run([npm, "run", "tauri", "build"], cwd=str(root / "client"), label="cliente")
        artefactos["cliente"] = root / RUTA_BINARIO["cliente"]
    if "indexer" in productos:
        run([npm, "run", "tauri", "build"], cwd=str(root / "indexer"), label="indexer")
        artefactos["indexer"] = root / RUTA_BINARIO["indexer"]
    if "lumid" in productos:
        artefactos["lumid"] = _construir_wsl_lumid(root)

    run([npm, "run", "tauri", "build"], cwd=str(root / "installer"), label="installer")
    artefactos["installer"] = root / RUTA_BINARIO["installer"]

    for nombre, ruta in artefactos.items():
        if not ruta.exists():
            fail(f"{nombre}: no se encontró el binario esperado en {ruta}")
            raise SystemExit(1)
    return artefactos


VERSION_PATHS = [rel for rel, _ in VERSION_FILES] + ["web/releases/versiones.json"]


def confirmar_y_comitear(root: Path, version: str) -> None:
    section("Último paso")
    r = subprocess.run(["git", "status", "--short", *VERSION_PATHS], cwd=root, capture_output=True, text=True)
    print(r.stdout)
    resp = input("¿comitear y pushear? [s/N] ").strip().lower()
    if resp not in ("s", "si", "sí", "y", "yes"):
        warn("el release de GitHub ya está publicado; versiones.json y los bumps de versión "
             "quedan sin comitear — revísalos y comitéalos a mano cuando quieras")
        return
    run(["git", "add", *VERSION_PATHS], cwd=str(root), label="git add")
    run(["git", "commit", "-m", f"chore: publicar versión {version}"], cwd=str(root), label="git commit")
    run(["git", "push"], cwd=str(root), label="git push")
    success(f"versión {version} publicada y comiteada")


def subir_github(version: str, productos: list[str], artefactos: dict[str, Path], notas: str) -> dict[str, str]:
    section("Subiendo a GitHub Releases")
    tag = f"v{version}"
    assets = [str(artefactos[p]) for p in productos] + [str(artefactos["installer"])]
    run(
        ["gh", "release", "create", tag, *assets,
         "--repo", REPO_GITHUB, "--title", tag, "--notes", notas or "(sin notas)"],
        label="gh release create",
    )
    return {
        p: f"https://github.com/{REPO_GITHUB}/releases/download/{tag}/{artefactos[p].name}"
        for p in productos
    }


def armar_borrador(
    root: Path, productos: list[str], version: str, notas: str,
    artefactos: dict[str, Path], urls: dict[str, str],
) -> Path:
    section("Firmando el manifiesto")
    manifiesto_actual = json.loads((root / "web" / "releases" / "versiones.json").read_text())
    publicaciones = list(manifiesto_actual.get("publicaciones", []))

    ahora = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    for p in productos:
        publicaciones.append({
            "producto": p,
            "version": version,
            "publicado": ahora,
            "notas": notas,
            "retirada": False,
            "artefactos": [{
                "plataforma": PLATAFORMA[p],
                "archivo": str(artefactos[p]),
                "url": urls[p],
            }],
        })

    tmp = root / ".release-tmp"
    tmp.mkdir(exist_ok=True)
    borrador_path = tmp / "borrador.json"
    borrador_path.write_text(json.dumps({"version": 1, "publicaciones": publicaciones}, indent=2))
    return borrador_path


def firmar(root: Path, borrador_path: Path) -> None:
    run([sys.executable, "tools/release.py", str(borrador_path)], cwd=str(root), label="firmar manifiesto")
    success("web/releases/versiones.json actualizado")


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
    artefactos = construir(root, productos)
    urls = subir_github(version, productos, artefactos, notas)
    borrador_path = armar_borrador(root, productos, version, notas, artefactos, urls)
    firmar(root, borrador_path)
    confirmar_y_comitear(root, version)
