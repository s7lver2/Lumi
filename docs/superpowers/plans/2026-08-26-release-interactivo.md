# `tools/build.py release` interactivo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `python tools/build.py release` hace todo el proceso de publicar una versión nueva de
principio a fin — versión única en los 7 sitios donde vive hoy desconectada, construir cliente/
Indexer/installer en Windows y `lumid` en WSL, subir a GitHub Releases, armar y firmar el
manifiesto conservando el histórico, y comitear/pushear tras confirmar — con `tsuki-ux` para toda
la salida (tabla de últimas versiones publicadas, pasos, confirmaciones).

**Architecture:** Un módulo nuevo `tools/release_flow.py` (lógica pura + orquestación) que
`tools/build.py` importa y llama desde un target `release` nuevo. Reusa `tools/release.py` tal
cual para el paso de firma — no se duplica esa lógica.

**Tech Stack:** Python 3 (stdlib: `json`, `re`, `subprocess`, `pathlib`, `datetime`) + `tsuki-ux`
(único paquete externo, ver Tarea 1).

## Global Constraints

- Spec fuente: [2026-08-26-release-interactivo-design.md](../specs/2026-08-26-release-interactivo-design.md).
- Español en código, comentarios y prompts.
- **No escribir tests** — convención del proyecto, sin excepción aquí (no es `lumi-proto`). La
  verificación de cada tarea es sintaxis/import limpios y, cuando aplique, una comprobación
  manual puntual de las funciones puras (no dejar ningún archivo de test nuevo en el repo).
- **No ejecutar un release real** durante la implementación ni la verificación — `gh release
  create`, el `git push` final y el build de WSL son acciones reales con efecto público/remoto.
  Verificar con sintaxis, imports, y llamadas a las funciones puras contra datos de prueba
  aislados (no el `web/releases/versiones.json` real, no el repo de WSL).
- Un commit por tarea, mensaje en español, sin `--no-verify`.

---

### Task 1: dependencia `tsuki-ux` y guarda de importación

**Files:**
- Create: `tools/requirements.txt`
- Modify: `.gitignore`
- Modify: `tools/build.py`

**Interfaces:**
- Produces: target `release` en `tools/build.py` que, por ahora, solo comprueba la dependencia y
  llama a `release_flow.lanzar()` (el módulo se crea en la Tarea 2 con un `lanzar()` mínimo que las
  tareas siguientes van completando).

- [ ] **Paso 1: `tools/requirements.txt`**

```
tsuki-ux>=1.0.11
```

- [ ] **Paso 2: instalar y comprobar en este entorno**

Run: `pip install -r tools/requirements.txt`
Expected: instala `tsuki-ux` sin errores (ya se verificó en esta sesión que existe en PyPI como
`tsuki-ux`, se importa como `tsuki_ux`).

- [ ] **Paso 3: `.gitignore`**

Añade una línea junto a otras carpetas de build/temporales del repo:

```
.release-tmp/
```

- [ ] **Paso 4: target `release` en `tools/build.py`**

Añade el `import` al principio del archivo (junto a los ya existentes) y el target nuevo dentro
de `main()`, antes del `if target == "installer":`:

```python
def main():
    target = sys.argv[1] if len(sys.argv) > 1 else "dev"
    if target == "release":
        try:
            import tsuki_ux  # noqa: F401
        except ImportError:
            print("falta tsuki-ux: pip install -r tools/requirements.txt", file=sys.stderr)
            sys.exit(1)
        sys.path.insert(0, str(Path(__file__).resolve().parent))
        import release_flow
        release_flow.lanzar(ROOT)
        return
    if target == "build":
```

- [ ] **Paso 5: verificar**

Run: `python tools/build.py release`
Expected: falla de forma controlada con `ModuleNotFoundError: No module named 'release_flow'`
(el módulo se crea en la Tarea 2) — confirma que el guard de `tsuki_ux` ya no salta (está
instalado) y que el target nuevo se alcanza.

- [ ] **Paso 6: commit**

```bash
git add tools/requirements.txt .gitignore tools/build.py
git commit -m "feat: target release en build.py, dependencia tsuki-ux"
```

---

### Task 2: `release_flow.py` — los 7 sitios de versión y la tabla de últimas publicadas

**Files:**
- Create: `tools/release_flow.py`

**Interfaces:**
- Produces: `VERSION_FILES`, `escribir_version(root, nueva)`, `leer_ultimas_publicadas(root) ->
  dict[str, dict | None]`, `mostrar_tabla_ultimas(ultimas)`, `lanzar(root)` (punto de entrada,
  llamado por `tools/build.py`; de momento solo hace el preflight + la tabla, las tareas
  siguientes lo completan).
- Consumes: nada de otras tareas.

- [ ] **Paso 1: cabecera y los 7 sitios de versión**

Crea `tools/release_flow.py`:

```python
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
```

- [ ] **Paso 2: preflight y esqueleto de `lanzar()`**

Añade al final del archivo:

```python
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


def lanzar(root: Path) -> None:
    _preflight(root)
    section("Estado actual")
    mostrar_tabla_ultimas(leer_ultimas_publicadas(root))
```

- [ ] **Paso 3: verificar sintaxis e import**

Run: `python -c "import ast; ast.parse(open('tools/release_flow.py', encoding='utf-8').read())"`
Expected: sin errores.

Run: `python -c "import sys; sys.path.insert(0, 'tools'); import release_flow; print('ok')"`
Expected: imprime `ok` (confirma que `tsuki_ux` se importa bien y el módulo carga).

- [ ] **Paso 4: probar `leer_ultimas_publicadas`/`mostrar_tabla_ultimas` contra datos de prueba**

**No uses el `web/releases/versiones.json` real del repo** — crea una carpeta temporal aislada
para esta comprobación puntual (no la dejes en el repo):

```bash
python - <<'EOF'
import json, sys, tempfile
from pathlib import Path
sys.path.insert(0, "tools")
import release_flow

tmp = Path(tempfile.mkdtemp())
(tmp / "web" / "releases").mkdir(parents=True)
(tmp / "web" / "releases" / "versiones.json").write_text(json.dumps({
    "publicaciones": [
        {"producto": "cliente", "version": "2.0.0", "publicado": "2026-08-01T00:00:00Z", "retirada": False},
        {"producto": "cliente", "version": "2.0.4", "publicado": "2026-08-20T00:00:00Z", "retirada": False},
    ]
}))
ultimas = release_flow.leer_ultimas_publicadas(tmp)
assert ultimas["cliente"]["version"] == "2.0.4", ultimas
assert ultimas["indexer"] is None
assert ultimas["lumid"] is None
release_flow.mostrar_tabla_ultimas(ultimas)
print("ok")
EOF
```

Expected: pinta la tabla (cliente → 2.0.4, indexer/lumid → sin publicar) y termina en `ok` sin
excepciones.

- [ ] **Paso 5: commit**

```bash
git add tools/release_flow.py
git commit -m "feat: release_flow escribe la version en los 7 sitios y pinta la tabla de ultimas publicadas"
```

---

### Task 3: preguntas interactivas — qué publicar, versión, notas, confirmación

**Files:**
- Modify: `tools/release_flow.py`

**Interfaces:**
- Consumes: `PRODUCTOS` (Tarea 2).
- Produces: `preguntar_productos() -> list[str]`, `preguntar_version() -> str`,
  `preguntar_notas() -> str`, `confirmar_plan(productos, version, notas) -> bool` — los usa
  `lanzar()` en esta misma tarea, y las tareas 4-6 los reciben ya resueltos.

- [ ] **Paso 1: las preguntas**

Añade a `tools/release_flow.py`, antes de `lanzar()`:

```python
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
```

- [ ] **Paso 2: enchufarlas en `lanzar()`**

Sustituye `lanzar()` por:

```python
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
```

- [ ] **Paso 3: verificar**

Run: `python -c "import ast; ast.parse(open('tools/release_flow.py', encoding='utf-8').read())"`
Expected: sin errores.

No ejecutes `python tools/build.py release` de verdad todavía — `escribir_version` ya toca los 7
archivos reales del repo, y las tareas siguientes son las que necesitas antes de un intento
completo. Verificación de esta tarea: solo sintaxis, más una relectura del código para confirmar
que `preguntar_version`/`confirmar_plan` hacen lo que dicen (no hay lógica no trivial que probar
aislada aquí).

- [ ] **Paso 4: commit**

```bash
git add tools/release_flow.py
git commit -m "feat: release_flow pregunta que publicar, version, notas y confirma el plan"
```

---

### Task 4: construir cliente/Indexer/installer en Windows y `lumid` en WSL

**Files:**
- Modify: `tools/release_flow.py`

**Interfaces:**
- Consumes: `run` de `tsuki_ux` (ya importado, Tarea 2), `Spinner` (ídem).
- Produces: `construir(root, productos) -> dict[str, Path]` (mapa producto → ruta del binario
  construido, más `"installer"` → ruta de `installer.exe`) — lo usa la Tarea 5.

- [ ] **Paso 1: rutas fijas de los artefactos**

Añade, cerca de `PRODUCTOS`:

```python
PLATAFORMA = {"cliente": "windows-x86_64", "indexer": "windows-x86_64", "lumid": "linux-x86_64"}

RUTA_BINARIO = {
    "cliente": "client/src-tauri/target/release/app.exe",
    "indexer": "indexer/src-tauri/target/release/indexer-app.exe",
    "installer": "installer/src-tauri/target/release/installer.exe",
}
```

- [ ] **Paso 2: construir en Windows + WSL**

Añade antes de `lanzar()`:

```python
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
```

- [ ] **Paso 3: enchufar en `lanzar()`**

Añade al final de `lanzar()` (después de `escribir_version(root, version)`):

```python
    artefactos = construir(root, productos)
```

- [ ] **Paso 4: verificar**

Run: `python -c "import ast; ast.parse(open('tools/release_flow.py', encoding='utf-8').read())"`
Expected: sin errores.

No ejecutes una compilación real todavía (es cara y esta tarea por sí sola no es un punto natural
para probarla end-to-end) — la verificación completa con compilación real es la Tarea 7.

- [ ] **Paso 5: commit**

```bash
git add tools/release_flow.py
git commit -m "feat: release_flow construye cliente/indexer/installer y lumid via wsl"
```

---

### Task 5: subir a GitHub Releases y armar el borrador conservando el histórico

**Files:**
- Modify: `tools/release_flow.py`

**Interfaces:**
- Consumes: `PLATAFORMA`, artefactos (Tarea 4).
- Produces: `subir_github(version, productos, artefactos, notas) -> dict[str, str]` (producto →
  URL de descarga), `armar_borrador(root, productos, version, notas, artefactos, urls) -> Path`
  (ruta del borrador escrito) — los usa `lanzar()` en esta misma tarea, y la Tarea 6 los encadena.

- [ ] **Paso 1: subir**

Añade antes de `lanzar()`:

```python
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
```

- [ ] **Paso 2: armar el borrador conservando el histórico**

```python
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
```

- [ ] **Paso 3: firmar (reusa `tools/release.py` tal cual)**

```python
def firmar(root: Path, borrador_path: Path) -> None:
    run([sys.executable, "tools/release.py", str(borrador_path)], cwd=str(root), label="firmar manifiesto")
    success("web/releases/versiones.json actualizado")
```

- [ ] **Paso 4: enchufar en `lanzar()`**

Añade al final de `lanzar()`:

```python
    urls = subir_github(version, productos, artefactos, notas)
    borrador_path = armar_borrador(root, productos, version, notas, artefactos, urls)
    firmar(root, borrador_path)
```

- [ ] **Paso 5: probar `armar_borrador` contra datos de prueba (sin tocar el repo real)**

```bash
python - <<'EOF'
import json, sys, tempfile
from pathlib import Path
sys.path.insert(0, "tools")
import release_flow

tmp = Path(tempfile.mkdtemp())
(tmp / "web" / "releases").mkdir(parents=True)
(tmp / "web" / "releases" / "versiones.json").write_text(json.dumps({
    "publicaciones": [{"producto": "lumid", "version": "2.0.0", "publicado": "2026-08-01T00:00:00Z", "notas": "", "retirada": False, "artefactos": []}]
}))
artefactos = {"cliente": Path("app.exe")}
urls = {"cliente": "https://github.com/s7lver2/Lumi/releases/download/v2.1.0/app.exe"}
borrador_path = release_flow.armar_borrador(tmp, ["cliente"], "2.1.0", "notas de prueba", artefactos, urls)
borrador = json.loads(borrador_path.read_text())
assert len(borrador["publicaciones"]) == 2, borrador  # la de lumid que ya existia + la nueva de cliente
assert any(p["producto"] == "lumid" and p["version"] == "2.0.0" for p in borrador["publicaciones"])
assert any(p["producto"] == "cliente" and p["version"] == "2.1.0" for p in borrador["publicaciones"])
print("ok")
EOF
```

Expected: `ok` — confirma que el histórico (`lumid` 2.0.0) sobrevive junto a la publicación nueva.

- [ ] **Paso 6: verificar sintaxis**

Run: `python -c "import ast; ast.parse(open('tools/release_flow.py', encoding='utf-8').read())"`
Expected: sin errores.

- [ ] **Paso 7: commit**

```bash
git add tools/release_flow.py
git commit -m "feat: release_flow sube a GitHub Releases y arma el borrador conservando el historico"
```

---

### Task 6: confirmación final y commit/push

**Files:**
- Modify: `tools/release_flow.py`

**Interfaces:**
- Consumes: nada nuevo.
- Produces: `confirmar_y_comitear(root, version) -> None` — cierra `lanzar()`.

- [ ] **Paso 1: la función**

Añade antes de `lanzar()`:

```python
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
```

- [ ] **Paso 2: enchufar al final de `lanzar()`**

```python
    confirmar_y_comitear(root, version)
```

- [ ] **Paso 3: verificar**

Run: `python -c "import ast; ast.parse(open('tools/release_flow.py', encoding='utf-8').read())"`
Expected: sin errores.

Run: `python -c "import sys; sys.path.insert(0, 'tools'); import release_flow; print(release_flow.VERSION_PATHS)"`
Expected: imprime la lista de 8 rutas (los 7 archivos de versión + `web/releases/versiones.json`)
sin excepciones.

- [ ] **Paso 4: commit**

```bash
git add tools/release_flow.py
git commit -m "feat: release_flow confirma y comitea/pushea al terminar"
```

---

### Task 7: verificación final (sin ejecutar un release real)

**Files:** ninguno (solo verificación).

- [ ] **Paso 1: sintaxis completa**

Run: `python -m py_compile tools/release_flow.py tools/build.py`
Expected: sin errores.

- [ ] **Paso 2: import completo**

Run: `python -c "import sys; sys.path.insert(0, 'tools'); import release_flow; print([n for n in dir(release_flow) if not n.startswith('_')])"`
Expected: imprime la lista de funciones públicas (`construir`, `escribir_version`,
`leer_ultimas_publicadas`, `mostrar_tabla_ultimas`, `preguntar_*`, `confirmar_*`, `subir_github`,
`armar_borrador`, `firmar`, `run`, ...) sin excepciones.

- [ ] **Paso 3: releer el archivo completo de una pasada**

Lee `tools/release_flow.py` entero y confirma contra la spec
(`docs/superpowers/specs/2026-08-26-release-interactivo-design.md`) que el orden de `lanzar()`
coincide con el flujo de 14 pasos de la sección 2: preflight → tabla → preguntas → confirmación
→ escribir versión → construir → subir a GitHub → armar borrador → firmar → confirmar y
comitear. Si algo no coincide, corrígelo antes de terminar.

- [ ] **Paso 4: `git status` limpio**

Run: `git status --short`
Expected: limpio (todo comiteado en las tareas anteriores).

**No ejecutes `python tools/build.py release` de principio a fin en esta verificación** — sube
un release real a GitHub y compila lumid en el WSL del dueño del proyecto; eso lo prueba él
cuando esté listo, no una verificación automatizada.
