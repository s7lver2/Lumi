/** Instalador de lumid escrito en Python -- puerto de crates/lumi-cli/src/install.rs.
 *  Servido como texto plano para que 'curl ... -o archivo.py' funcione;
 *  lo descarga y lo ejecuta el script de /install (ver esa ruta). Nunca se
 *  sirve como HTML: si algo aquí se ve mal en el navegador, es correcto --
 *  esto es para python3, no para leer. */
const SCRIPT = `#!/usr/bin/env python3
"""Instalador de lumid. Puerto a Python de crates/lumi-cli/src/install.rs,
para que el oneliner (curl -fsSL .../install | sh) no dependa de publicar un
binario compilado de \`lumi\` -- ver FUTURO.md, seccion sobre este cambio.

La unica pieza de verdad delicada -- Argon2id para la clave de vinculacion --
NO se reimplementa aqui: en cuanto lumid arranca, este script le pide a el
mismo que se autoemita la clave (POST /v1/bootstrap/pair-key, localhost,
solo si el servidor esta genuinamente virgen -- ver
crates/lumid/src/routes/bootstrap.rs). El resto de este script es fontaneria
de sistema (systemd, un certificado autofirmado via openssl, Qdrant) mas la
verificacion del manifiesto firmado, que si se reimplementa aqui a proposito
-- confiar en el manifiesto sin comprobar su firma seria un retroceso real
frente a lo que ya hace \`lumi install\`.
"""
import argparse
import hashlib
import json
import os
import shutil
import socket
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.error
import urllib.request
import base64
import sqlite3
import ssl

DATA = "/var/lib/lumi"
BIN = "/usr/local/bin/lumid"
PORT = 7717
VERSIONES_URL = "https://lumi.s7lver.xyz/api/versiones"

CLAVE_PUBLICA = bytes([
    6, 171, 109, 154, 200, 28, 207, 238, 5, 27, 161, 187, 55, 78, 74, 172,
    73, 96, 87, 176, 14, 249, 77, 147, 71, 158, 220, 161, 96, 51, 157, 108,
])

UNIT = """[Unit]
Description=Lumi control daemon
After=network-online.target
Wants=network-online.target

[Service]
ExecStart=/usr/local/bin/lumid
Restart=on-failure
RestartSec=3
User=root
StateDirectory=lumi
Environment=LUMI_DATA=/var/lib/lumi
# lumid lanza workers de inferencia como hijos directos, cada uno cargando
# GB de pesos; sin esto, el kernel matando a UNO por falta de memoria se
# lleva por delante el daemon entero (OOMPolicy por defecto es stop).
OOMPolicy=continue

[Install]
WantedBy=multi-user.target
"""

# Mismo criterio que Qdrant justo abajo: binario único autocontenido,
# versión y sha256 fijados a mano, sin unidad de systemd propia -- no es un
# servicio, lumid lo invoca como subproceso solo al generar el informe
# forense en PDF (GET /v1/cases/:id/export.pdf).
TECTONIC_VERSION = "tectonic%400.17.0"
TECTONIC_ASSET = "tectonic-0.17.0-x86_64-unknown-linux-gnu.tar.gz"
TECTONIC_SHA256 = "1a715688baf591e650c8aeb160ae934e181685eecbb38b317de30b269ac5d606"
TECTONIC_DIR = f"{DATA}/tectonic"

QDRANT_VERSION = "v1.19.0"
QDRANT_ASSET = "qdrant-x86_64-unknown-linux-gnu.tar.gz"
QDRANT_SHA256 = "e4405091f67d02f96fb941695ef8a6974e677632507ff7b04a3fcbb332ad9c19"
QDRANT_DIR = f"{DATA}/qdrant"
QDRANT_UNIT = f"""[Unit]
Description=Qdrant vector database (Lumi)
After=network.target

[Service]
ExecStart={QDRANT_DIR}/qdrant
WorkingDirectory={QDRANT_DIR}
Restart=on-failure
RestartSec=3
User=root
Environment=QDRANT__STORAGE__STORAGE_PATH={QDRANT_DIR}/storage
Environment=QDRANT__SERVICE__HOST=127.0.0.1
Environment=QDRANT__TELEMETRY_DISABLED=true

[Install]
WantedBy=multi-user.target
"""


# ---------------------------------------------------------------------------
# Ed25519 (solo verificacion), referencia pura Python -- sin dependencias.
# Probado a mano contra el manifiesto real firmado del proyecto antes de
# publicar este script: acepta el original, rechaza una copia manipulada.
# ---------------------------------------------------------------------------
_B = 256
_Q = 2 ** 255 - 19


def _sha512(m):
    return hashlib.sha512(m).digest()


def _expmod(base, e, m):
    if e == 0:
        return 1
    t = _expmod(base, e // 2, m) ** 2 % m
    if e & 1:
        t = (t * base) % m
    return t


def _inv(x):
    return _expmod(x, _Q - 2, _Q)


_D = -121665 * _inv(121666) % _Q
_I = _expmod(2, (_Q - 1) // 4, _Q)


def _xrecover(y):
    xx = (y * y - 1) * _inv(_D * y * y + 1)
    x = _expmod(xx, (_Q + 3) // 8, _Q)
    if (x * x - xx) % _Q != 0:
        x = (x * _I) % _Q
    if x % 2 != 0:
        x = _Q - x
    return x


_BY = 4 * _inv(5)
_BX = _xrecover(_BY)
_BASE = (_BX % _Q, _BY % _Q)


def _edwards(p, r):
    x1, y1 = p
    x2, y2 = r
    x3 = (x1 * y2 + x2 * y1) * _inv(1 + _D * x1 * x2 * y1 * y2)
    y3 = (y1 * y2 + x1 * x2) * _inv(1 - _D * x1 * x2 * y1 * y2)
    return (x3 % _Q, y3 % _Q)


def _scalarmult(p, e):
    if e == 0:
        return (0, 1)
    r = _scalarmult(p, e // 2)
    r = _edwards(r, r)
    if e & 1:
        r = _edwards(r, p)
    return r


def _encodepoint(p):
    x, y = p
    yb = bytearray(int.to_bytes(y % (1 << (_B - 1)), _B // 8, "little"))
    if x & 1:
        yb[-1] |= 0x80
    return bytes(yb)


def _bit(h, i):
    return (h[i // 8] >> (i % 8)) & 1


def _isoncurve(p):
    x, y = p
    return (-x * x + y * y - 1 - _D * x * x * y * y) % _Q == 0


def _decodeint(s):
    return int.from_bytes(s, "little")


def _decodepoint(s):
    y = int.from_bytes(s, "little") & ((1 << (_B - 1)) - 1)
    x = _xrecover(y)
    if x & 1 != _bit(s, _B - 1):
        x = _Q - x
    p = (x, y)
    if not _isoncurve(p):
        raise ValueError("punto fuera de curva")
    return p


def verificar_ed25519(pk: bytes, msg: bytes, sig: bytes) -> bool:
    if len(sig) != _B // 4 or len(pk) != _B // 8:
        return False
    try:
        r = _decodepoint(sig[: _B // 8])
        a = _decodepoint(pk)
        s = _decodeint(sig[_B // 8 : _B // 4])
    except Exception:
        return False
    h = _decodeint(_sha512(_encodepoint(r) + pk + msg))
    return _scalarmult(_BASE, s) == _edwards(r, _scalarmult(a, h))


def _canonico(manifiesto: dict) -> bytes:
    """Misma serializacion COMPACTA, mismo orden de campos, que
    \`Manifiesto::canonico()\` en Rust (serde_json::to_vec, orden de
    declaracion del struct, \`firma\` vacia) -- la firma se calculo sobre
    ESTOS bytes exactos, no sobre el JSON bonito que se sirve."""
    m = {
        "version": manifiesto["version"],
        "clave_publica": manifiesto.get("clave_publica", ""),
        "publicaciones": [
            {
                "producto": p["producto"],
                "version": p["version"],
                "publicado": p["publicado"],
                "notas": p["notas"],
                "retirada": p["retirada"],
                "artefactos": [
                    {"plataforma": a["plataforma"], "url": a["url"], "bytes": a["bytes"], "sha256": a["sha256"]}
                    for a in p["artefactos"]
                ],
            }
            for p in manifiesto["publicaciones"]
        ],
        "firma": "",
    }
    return json.dumps(m, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def obtener_manifiesto_verificado() -> dict:
    try:
        with urllib.request.urlopen(VERSIONES_URL, timeout=20) as r:
            manifiesto = json.loads(r.read())
    except urllib.error.URLError as e:
        raise SystemExit(f"no se pudo consultar el manifiesto de versiones: {e}")
    firma = manifiesto.get("firma", "")
    if not firma:
        raise SystemExit("el manifiesto no está firmado")
    if not verificar_ed25519(CLAVE_PUBLICA, _canonico(manifiesto), base64.b64decode(firma)):
        raise SystemExit("la firma del manifiesto no es válida -- no se instala nada")
    return manifiesto


def _extraer_tar_seguro(tarball_path, destino):
    """\`filter="data"\` (PEP 706) es la extracción segura por defecto, pero
    el argumento solo existe desde Python 3.12 -- en 3.10/3.11 (Ubuntu
    22.04, por ejemplo) llamarlo a secas revienta con TypeError. Se detecta
    en tiempo de ejecución en vez de fijar una versión mínima."""
    with tarfile.open(tarball_path, "r:gz") as tf:
        if sys.version_info >= (3, 12):
            tf.extractall(destino, filter="data")
        else:
            tf.extractall(destino)


def _mas_nueva(manifiesto, producto, plataforma):
    candidatas = [
        p for p in manifiesto["publicaciones"]
        if p["producto"] == producto and not p["retirada"]
        and any(a["plataforma"] == plataforma for a in p["artefactos"])
    ]
    if not candidatas:
        return None
    return max(candidatas, key=lambda p: p["publicado"])


def _version_exacta(manifiesto, producto, version, plataforma):
    for p in manifiesto["publicaciones"]:
        if (p["producto"] == producto and not p["retirada"] and p["version"] == version
                and any(a["plataforma"] == plataforma for a in p["artefactos"])):
            return p
    return None


def _artefacto(publicacion, plataforma):
    return next(a for a in publicacion["artefactos"] if a["plataforma"] == plataforma)


def _sha256_de(ruta):
    h = hashlib.sha256()
    with open(ruta, "rb") as f:
        for trozo in iter(lambda: f.read(1 << 20), b""):
            h.update(trozo)
    return h.hexdigest()


def _descargar_verificado(url, sha256_esperado, destino):
    tmp = destino + ".tmp"
    try:
        urllib.request.urlretrieve(url, tmp)
    except urllib.error.URLError as e:
        raise SystemExit(f"no se pudo descargar {url}: {e}")
    real = _sha256_de(tmp)
    if real != sha256_esperado:
        os.remove(tmp)
        raise SystemExit(f"sha256 no coincide para {url} (esperado {sha256_esperado}, obtenido {real}) -- nada se instala")
    os.replace(tmp, destino)


# ---------------------------------------------------------------------------
# UI de terminal, minima -- sin dependencias (nada de dialoguer/rich).
# ---------------------------------------------------------------------------
def cab(titulo):
    print(f"\\n── {titulo} " + "─" * max(0, 58 - len(titulo)))


def ok(msg):
    print(f"  ✓ {msg}")


def warn(msg):
    print(f"  ! {msg}")


def elegir(prompt, opciones, defecto, auto):
    if auto:
        print(f"  › {opciones[defecto][0]}   (automático — recomendado)")
        return defecto
    for i, (etiqueta, detalle) in enumerate(opciones):
        marca = "*" if i == defecto else " "
        print(f"  [{marca}{i + 1}] {etiqueta} — {detalle}")
    while True:
        r = input(f"{prompt} [{defecto + 1}]: ").strip()
        if r == "":
            return defecto
        if r.isdigit() and 1 <= int(r) <= len(opciones):
            return int(r) - 1
        print("  respuesta no válida")


# ---------------------------------------------------------------------------
# Entorno
# ---------------------------------------------------------------------------
def _local_ip():
    try:
        out = subprocess.run(["hostname", "-I"], capture_output=True, text=True, timeout=5).stdout
        for tok in out.split():
            if "." in tok and not tok.startswith("127."):
                return tok
    except Exception:
        pass
    return None


_B58_ALFABETO = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"


def _b58encode(data: bytes) -> str:
    """Mismo alfabeto y manejo de ceros a la izquierda que la crate bs58
    (crates/lumi-proto/src/key.rs) -- no hace falta la dependencia, es
    aritmética de enteros grandes con la stdlib."""
    n = int.from_bytes(data, "big")
    out = ""
    while n > 0:
        n, resto = divmod(n, 58)
        out = _B58_ALFABETO[resto] + out
    ceros = len(data) - len(data.lstrip(b"\\x00"))
    return _B58_ALFABETO[0] * ceros + out


def _tarjeta_servidor(cert_der_path: str, addr: str) -> str:
    """lumi1s_<host:puerto>_<huella> -- misma huella que calcula lumid
    (SHA-256 del cert.der, truncada a 16 bytes, en base58). A diferencia de
    la clave de vinculación, la tarjeta no lleva secreto: es información
    pública, segura de calcular aquí sin pedirle nada a lumid."""
    import hashlib
    der = open(cert_der_path, "rb").read()
    fp = hashlib.sha256(der).digest()[:16]
    return f"lumi1s_{addr}_{_b58encode(fp)}"


def _servidor_realmente_virgen(data_dir):
    """La MISMA condición que bootstrap.rs (crates/lumid/src/routes/bootstrap.rs):
    sin usuarios y sin ninguna clave de vinculación jamás emitida. No basta con
    mirar si el certificado ya existía -- eso solo dice si esto es una
    reinstalación, no si alguien llegó a crear una cuenta de verdad. Un
    certificado puede sobrevivir a una instalación que nunca se llegó a
    reclamar (por ejemplo, si el paso de la clave de vinculación se saltó por
    error, como pasó aquí)."""
    db_path = f"{data_dir}/lumi.db"
    if not os.path.exists(db_path):
        return True
    try:
        db = sqlite3.connect(db_path, timeout=5)
        try:
            usuarios = db.execute("SELECT COUNT(*) FROM users").fetchone()[0]
            claves = db.execute("SELECT COUNT(*) FROM pair_key").fetchone()[0]
            return usuarios == 0 and claves == 0
        except sqlite3.OperationalError:
            return True  # tablas aún no creadas -- lumid las crea en su primer arranque
        finally:
            db.close()
    except Exception:
        return True


def _puerto_libre(puerto):
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        s.bind(("0.0.0.0", puerto))
        return True
    except OSError:
        return False
    finally:
        s.close()


def _driver_nvidia():
    try:
        out = subprocess.run(
            ["nvidia-smi", "--query-gpu=driver_version", "--format=csv,noheader"],
            capture_output=True, text=True, timeout=5,
        )
        if out.returncode == 0 and out.stdout.strip():
            return out.stdout.strip().splitlines()[0].strip()
    except Exception:
        pass
    return None


def _es_wsl():
    try:
        with open("/proc/version") as f:
            return "microsoft" in f.read().lower()
    except Exception:
        return False


def _run_ok(cmd, **kw):
    r = subprocess.run(cmd, capture_output=True, text=True, **kw)
    if r.returncode != 0:
        raise SystemExit(f"{' '.join(cmd)} falló: {r.stderr.strip()}")
    return r


def _run_quiet(cmd):
    subprocess.run(cmd, capture_output=True)


def _run_quiet_status(cmd):
    return subprocess.run(cmd, capture_output=True).returncode == 0


# ---------------------------------------------------------------------------
# Pasos de instalación
# ---------------------------------------------------------------------------
def _generar_certificado(cert_der_path, key_path):
    ip = _local_ip()
    san = "subjectAltName=DNS:localhost" + (f",IP:{ip}" if ip else "")
    tmp_pem = cert_der_path + ".pem.tmp"
    try:
        _run_ok([
            "openssl", "req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1",
            "-keyout", key_path, "-out", tmp_pem, "-days", "3650", "-nodes",
            "-subj", "/CN=lumi", "-addext", san,
        ])
        _run_ok(["openssl", "x509", "-in", tmp_pem, "-outform", "DER", "-out", cert_der_path])
    finally:
        if os.path.exists(tmp_pem):
            os.remove(tmp_pem)
    os.chmod(key_path, 0o600)


def _sembrar_maestra(sellada, passphrase):
    if sellada:
        salt = os.urandom(16)
        with open(f"{DATA}/master.salt", "wb") as f:
            f.write(salt)
        # No se deriva la maestra aquí: \`lumi install\` (Rust) solo lo hacía
        # para validar que Argon2 funcionaba, y esa validación no se
        # persiste en ningún sitio -- omitirla no cambia el resultado.
        # \`lumid\`/el cliente derivan de verdad al desbloquear, con su propia
        # implementación ya probada.
    else:
        key = os.urandom(32)
        r = subprocess.run(
            ["systemd-creds", "encrypt", "--name=lumi-master", "-", f"{DATA}/master.cred"],
            input=key, capture_output=True,
        )
        if r.returncode != 0:
            raise SystemExit(f"systemd-creds encrypt falló: {r.stderr.decode(errors='replace').strip()}")


def _copiar_assets(manifiesto, version_lumid):
    """\`registros/\` y \`workers/\` empaquetados como un segundo artefacto de
    la MISMA publicación de lumid (plataforma "assets") -- el mismo paquete
    que ya usa la auto-actualización de lumid (ver actualizacion::aplicar)."""
    publicacion = (
        _version_exacta(manifiesto, "lumid", version_lumid, "assets")
        if version_lumid != "latest"
        else _mas_nueva(manifiesto, "lumid", "assets")
    )
    if publicacion is None:
        warn("esta versión de lumid no trae registros/workers empaquetados -- omitido")
        return
    art = _artefacto(publicacion, "assets")
    with tempfile.TemporaryDirectory() as tmp:
        tarball = os.path.join(tmp, "assets.tar.gz")
        _descargar_verificado(art["url"], art["sha256"], tarball)
        destino_tmp = os.path.join(tmp, "extraido")
        _extraer_tar_seguro(tarball, destino_tmp)
        for nombre in ("registros", "workers"):
            origen = os.path.join(destino_tmp, nombre)
            if not os.path.isdir(origen):
                continue
            destino = os.path.join(DATA, nombre)
            if os.path.exists(destino):
                shutil.rmtree(destino)
            shutil.move(origen, destino)


def _instalar_lumid(manifiesto, version):
    publicacion = (
        _mas_nueva(manifiesto, "lumid", "linux-x86_64")
        if version == "latest"
        else _version_exacta(manifiesto, "lumid", version, "linux-x86_64")
    )
    if publicacion is None:
        raise SystemExit(f"no hay publicación de lumid para la versión {version}")
    art = _artefacto(publicacion, "linux-x86_64")
    _descargar_verificado(art["url"], art["sha256"], BIN)
    os.chmod(BIN, 0o755)
    return publicacion["version"]


def _instalar_qdrant():
    os.makedirs(f"{QDRANT_DIR}/storage", exist_ok=True)
    bin_path = f"{QDRANT_DIR}/qdrant"
    if not os.path.exists(bin_path):
        url = f"https://github.com/qdrant/qdrant/releases/download/{QDRANT_VERSION}/{QDRANT_ASSET}"
        with tempfile.TemporaryDirectory() as tmp:
            tarball = os.path.join(tmp, QDRANT_ASSET)
            _descargar_verificado(url, QDRANT_SHA256, tarball)
            _extraer_tar_seguro(tarball, QDRANT_DIR)
    with open("/etc/systemd/system/qdrant.service", "w") as f:
        f.write(QDRANT_UNIT)
    _run_ok(["systemctl", "daemon-reload"])
    _run_ok(["systemctl", "enable", "--now", "qdrant.service"])
    for _ in range(10):
        time.sleep(0.5)
        if _run_quiet_status(["curl", "-fsS", "-o", "/dev/null", "http://127.0.0.1:6333/readyz"]):
            return True
    return False


def _instalar_tectonic():
    """Idempotente, igual que `_instalar_qdrant`: si el binario ya está en su
    sitio no vuelve a bajar los ~60 MB en cada reinstalación. Un fallo aquí no
    aborta la instalación de Station entera -- `export.rs` ya sabe devolver un
    error accionable si el binario no aparece cuando alguien pide un informe,
    igual que cualquier otra capacidad recortada."""
    os.makedirs(TECTONIC_DIR, exist_ok=True)
    bin_path = f"{TECTONIC_DIR}/tectonic"
    if os.path.exists(bin_path):
        return True
    try:
        url = f"https://github.com/tectonic-typesetting/tectonic/releases/download/{TECTONIC_VERSION}/{TECTONIC_ASSET}"
        with tempfile.TemporaryDirectory() as tmp:
            tarball = os.path.join(tmp, TECTONIC_ASSET)
            _descargar_verificado(url, TECTONIC_SHA256, tarball)
            _extraer_tar_seguro(tarball, TECTONIC_DIR)
        os.chmod(bin_path, 0o755)
        return os.path.exists(bin_path)
    except Exception as e:
        warn(f"no se pudo instalar tectonic: {_detalle_error(e)}")
        return False


def _detalle_error(e):
    """str(e) a secas puede ser inútil o directamente engañoso -- un
    OSError(2) sin mensaje se queda en solo '2'. Para HTTPError, el cuerpo
    trae el motivo real que puso bootstrap.rs (ej. "ya no está virgen")."""
    if isinstance(e, urllib.error.HTTPError):
        try:
            cuerpo = e.read().decode("utf-8", "replace").strip()
        except Exception:
            cuerpo = ""
        return f"HTTP {e.code} {e.reason}" + (f": {cuerpo}" if cuerpo else "")
    return f"{type(e).__name__}: {e}"


def _pedir_clave_de_vinculacion():
    """lumid acaba de arrancar: se le pide que se autoemita su propia clave
    (toda la parte Argon2id vive en su código Rust, ya probado -- ver
    crates/lumid/src/routes/bootstrap.rs). Se sondea porque el arranque
    (migraciones, detección de hardware) no es instantáneo.

    lumid solo habla HTTPS, incluso en localhost -- no hay puerto en texto
    plano. El certificado es autofirmado (el cliente real pinea su huella),
    pero aquí no hace falta reimplementar ese pineo: esto es una llamada a
    127.0.0.1 desde un proceso que corre como root en la MISMA máquina que
    acaba de escribir ese certificado -- no hay red de por medio que un
    atacante pueda interponer. Se desactiva solo la verificación del
    certificado, no TLS en sí."""
    ctx = ssl._create_unverified_context()
    url = f"https://127.0.0.1:{PORT}/v1/bootstrap/pair-key"
    ultimo_error = None
    for _ in range(20):
        time.sleep(0.5)
        try:
            req = urllib.request.Request(url, method="POST", data=b"")
            with urllib.request.urlopen(req, timeout=5, context=ctx) as r:
                return json.loads(r.read())["key"]
        except Exception as e:
            ultimo_error = _detalle_error(e)
    raise SystemExit(f"lumid no respondió a tiempo pidiendo la clave de vinculación: {ultimo_error}")


def instalar(auto: bool, version: str) -> str:
    if os.geteuid() != 0:
        raise SystemExit("hace falta root -- ejecuta con sudo")
    if not os.path.exists("/run/systemd/system"):
        raise SystemExit("este host no usa systemd; instala en una máquina con systemd")

    cab("entorno")
    uname = subprocess.run(["uname", "-sr"], capture_output=True, text=True).stdout.strip()
    ok(uname)
    driver = _driver_nvidia()
    if driver:
        ok(f"driver NVIDIA {driver}")
    else:
        warn("sin driver NVIDIA: el servidor arrancará, pero sin inferencia")
        if _es_wsl():
            warn("WSL2 detectado: el driver se instala en Windows, no aquí (developer.nvidia.com/cuda/wsl)")
    if not _puerto_libre(PORT):
        if not _run_quiet_status(["systemctl", "is-active", "--quiet", "lumid.service"]):
            raise SystemExit(f"el puerto {PORT} ya está ocupado por otro proceso (no es lumid.service)")
        if auto:
            warn(f"puerto {PORT} ocupado por lumid.service -- se detiene para reinstalar")
        else:
            r = input(f"  el puerto {PORT} ya está ocupado por lumid.service -- ¿pararlo y reinstalar? [S/n] ").strip().lower()
            if r not in ("", "s", "si", "sí", "y", "yes"):
                raise SystemExit("instalación cancelada")
        _run_ok(["systemctl", "stop", "lumid.service"])
    if shutil.which("ufw"):
        estado = subprocess.run(["ufw", "status"], capture_output=True, text=True).stdout.strip().lower()
        if estado.startswith("status: active"):
            warn("ufw activo: se añade la regla para el puerto")
            _run_quiet(["ufw", "allow", f"{PORT}/tcp"])

    cab("modo")
    if os.path.exists("/.dockerenv"):
        print("  › docker   (detectado: /.dockerenv presente)")
    elif auto:
        print("  › nativo   (automático — recomendado)")
    else:
        elegir("modo", [("nativo", "recomendado"), ("docker", "capacidades recortadas")], 0, False)

    cab("clave maestra")
    sellada, passphrase = False, None
    if auto:
        print("  › automática   (systemd-creds · arranca sola tras reiniciar)")
    else:
        i = elegir("clave maestra", [("automática", "arranca sola"), ("sellada", "un admin desbloquea desde la app")], 0, False)
        sellada = i == 1
        if sellada:
            passphrase = input("  frase de desbloqueo: ").strip()
            if not passphrase:
                raise SystemExit("el modo sellado necesita una frase no vacía")

    cab("almacenamiento")
    default_models_dir = f"{DATA}/runtime"
    if auto:
        models_dir = default_models_dir
        print(f"  › {models_dir}   (automático — recomendado)")
    else:
        models_dir = input(f"  dónde se descargarán el entorno de Python y los modelos [{default_models_dir}]: ").strip() or default_models_dir
        if not models_dir.startswith("/"):
            raise SystemExit("la ruta debe ser absoluta (empezar por /)")
    os.makedirs(models_dir, exist_ok=True)
    ok(models_dir)

    cab("instalación")
    os.makedirs(DATA, exist_ok=True)

    cert_der = f"{DATA}/cert.der"
    key_pem = f"{DATA}/key.pem"
    servidor_virgen = _servidor_realmente_virgen(DATA)
    if not os.path.exists(cert_der):
        _generar_certificado(cert_der, key_pem)
        ok("certificado EC P-256 · 10 años (nuevo)")
    else:
        ok("certificado existente conservado (no se reemparejan los clientes ya emparejados)")

    if os.path.exists(f"{DATA}/master.cred") or os.path.exists(f"{DATA}/master.salt"):
        ok("clave maestra existente conservada (los datos sellados con ella siguen siendo legibles)")
    else:
        _sembrar_maestra(sellada, passphrase)
        ok("clave maestra sellada (nueva)" if sellada else "clave maestra automática · systemd-creds (nueva)")

    manifiesto = obtener_manifiesto_verificado()
    version_real = _instalar_lumid(manifiesto, version)
    _copiar_assets(manifiesto, version_real)
    ok("registros y workers copiados a /var/lib/lumi")

    db = sqlite3.connect(f"{DATA}/lumi.db", timeout=30)
    try:
        db.execute("DELETE FROM meta WHERE k LIKE 'red\\\\_%' ESCAPE '\\\\'")
        db.commit()
    except sqlite3.OperationalError:
        pass  # tabla aún no existe -- lumid la crea en su primer arranque
    db.close()

    with open("/etc/systemd/system/lumid.service", "w") as f:
        f.write(UNIT)
    _run_ok(["systemctl", "daemon-reload"])
    _run_ok(["systemctl", "enable", "lumid.service"])
    _run_ok(["systemctl", "restart", "lumid.service"])
    ok(f"lumid.service {version_real} activo · escuchando en 0.0.0.0:{PORT}")

    qdrant_vivo = _instalar_qdrant()
    ok("qdrant.service activo · escuchando en 127.0.0.1:6333" if qdrant_vivo else "qdrant.service arrancó pero no responde todavía")

    tectonic_ok = _instalar_tectonic()
    ok("tectonic listo · exportar caso a PDF ya puede compilar el informe" if tectonic_ok
       else "tectonic no se pudo instalar; exportar caso a PDF fallará con un error explicando cómo arreglarlo")

    for _ in range(20):
        db = sqlite3.connect(f"{DATA}/lumi.db", timeout=30)
        try:
            db.execute("INSERT OR REPLACE INTO meta (k, v) VALUES ('models_dir', ?)", (models_dir,))
            db.commit()
            db.close()
            break
        except sqlite3.OperationalError:
            db.close()
            time.sleep(0.5)

    if not servidor_virgen:
        # Ya hay usuarios o una clave emitida de antes -- este servidor ya
        # tiene dueño, así que bootstrap.rs rechazaría la autoemisión con 403
        # (ver su propio comentario: solo emite si users/pair_key están
        # vacíos). Pedir aquí una clave nueva no tiene sentido en una
        # actualización, pero dejar al usuario sin nada tampoco -- la
        # tarjeta pública (sin secreto, no se consume) le sirve para volver
        # a añadir este servidor en el cliente y entrar con su cuenta.
        addr = f"{_local_ip() or '127.0.0.1'}:{PORT}"
        return ("card", _tarjeta_servidor(cert_der, addr))
    return ("key", _pedir_clave_de_vinculacion())


def main():
    ap = argparse.ArgumentParser(description="Instala lumid")
    ap.add_argument("-y", "--yes", action="store_true", help="sin preguntas: defectos recomendados")
    ap.add_argument("--version", default="latest", help="versión exacta de lumid a instalar, o 'latest'")
    args = ap.parse_args()

    tipo, valor = instalar(args.yes, args.version)
    print()
    if tipo == "card":
        print("  ────────────────────────────────────────────────────────")
        print("  Servidor actualizado -- ya tenía dueño, no se emite clave nueva")
        print("  Tarjeta de servidor · sin secreto, no caduca, no se consume")
        print()
        print(f"  {valor}")
        print()
        print("  Añade este servidor en el cliente con esta tarjeta y entra")
        print("  con tu cuenta. (¿hace falta una clave nueva de verdad? 'lumi")
        print("  key reissue' en el propio host.)")
        print("  ────────────────────────────────────────────────────────")
        return
    print("  ────────────────────────────────────────────────────────")
    print("  Clave de vinculación · un solo uso · caduca en 24 h")
    print()
    print(f"  {valor}")
    print()
    print("  Solo se muestra ahora. El servidor guarda su hash.")
    print("  ────────────────────────────────────────────────────────")


if __name__ == "__main__":
    main()
`;

export async function GET() {
  return new Response(SCRIPT, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=300, s-maxage=300",
    },
  });
}
