#!/usr/bin/env python3
"""Descarga pesos, calcula su sha256, escribe la licencia junto a ellos.

Solo biblioteca estandar: es una tarea del runner (crates/lumid/src/tasks.rs),
que ya sabe correr un comando de shell y leer su stdout linea a linea por SSE.
No estructura un protocolo nuevo para un caso — el progreso es una linea mas
del mismo log, con un prefijo reconocible.

Recibe por argv[1] un JSON con la forma:
  [{"id": "anyloc", "fichero_url": "...", "destino": "pesos/anyloc/pesos.pth",
    "licencia_texto": "...", "gestion_propia": false}, ...]

Un item con gestion_propia=true (PaddleOCR) no se descarga: solo se le
escribe LICENCIA.txt. Un item sin fichero_url tampoco se descarga -- no
deberia llegar aqui asi, porque esos quedan en modo guia y el gesto de
"instalar" los excluye del lote antes de lanzar la tarea.
"""
import hashlib
import http.cookiejar
import json
import os
import re
import sys
import urllib.parse
import urllib.request

#: HuggingFace limita bastante el ancho de banda de descargas anonimas (el
#: propio hub avisa de ello: "You are sending unauthenticated requests").
#: Un token gratuito de solo lectura lo evita -- se lee del entorno, nunca
#: del registro (registros/*.json va a git, un token no). El proceso que
#: lanza esto (`lumid::tasks` o el `pesos.rs` del Indexer) es quien decide
#: si lo pasa o no; aqui solo se consume si esta.
HF_TOKEN = os.environ.get("HF_TOKEN", "")


def progreso(item_id, hechos, total):
    linea = json.dumps({"item": item_id, "mib": hechos // (1 << 20), "total_mib": total // (1 << 20),
                         "pct": int(hechos * 100 / total) if total else 0})
    print("@progreso " + linea, flush=True)


def _id_de_drive(url):
    m = re.search(r"/d/([a-zA-Z0-9_-]+)", url) or re.search(r"[?&]id=([a-zA-Z0-9_-]+)", url)
    return m.group(1) if m else None


def _abrir(url):
    """Google Drive antepone una pagina de aviso ("no se puede analizar en
    busca de virus") a cualquier fichero de mas de un centenar de MB, y sin
    seguirla urllib.request guardaria esa pagina HTML como si fueran los
    pesos. La pagina de aviso ya no basta con un `&confirm=` pegado a la
    misma URL (el truco clasico de gdown): trae un <form> que apunta a OTRO
    host (drive.usercontent.google.com) con un `uuid` de un solo uso, y hay
    que enviar exactamente los campos de ese formulario. Cualquier otro host
    se abre tal cual, sin este rodeo.

    `huggingface.co` es el otro caso especial: con `HF_TOKEN` presente se
    manda como `Authorization: Bearer`, que es lo que saca la descarga del
    limite de las peticiones anonimas -- ver el propio aviso del hub."""
    if HF_TOKEN and "huggingface.co" in url:
        return urllib.request.urlopen(
            urllib.request.Request(url, headers={"Authorization": f"Bearer {HF_TOKEN}"}))
    file_id = _id_de_drive(url)
    if not file_id or "drive.google.com" not in url:
        return urllib.request.urlopen(url)
    jar = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
    resp = opener.open(f"https://drive.google.com/uc?export=download&id={file_id}")
    if resp.headers.get_content_type() != "text/html":
        return resp
    cuerpo = resp.read().decode("utf-8", "replace")
    accion = re.search(r'action="([^"]+)"', cuerpo)
    campos = dict(re.findall(r'name="([^"]+)"\s+value="([^"]*)"', cuerpo))
    if not accion or "confirm" not in campos:
        raise ValueError(f"drive.google.com no dio el fichero ni una confirmacion reconocible para {file_id}")
    return opener.open(accion.group(1) + "?" + urllib.parse.urlencode(campos))


def _snapshot(repo_id, destino, item_id):
    """Un motor con `hf_repo` no es un fichero: es un repositorio entero de
    HuggingFace (config, tokenizer, uno o varios .safetensors) que
    `from_pretrained` espera encontrar ya en disco -- `descargar()` no sirve
    porque no hay una sola URL que pedir. `snapshot_download` ya resuelve
    paralelismo, reanudación e integridad por fichero (ETags) por su cuenta,
    así que aquí no hay un sha256 propio que calcular ni verificar: la
    garantía es la del propio hub, no la nuestra -- misma postura que ya
    toma `gestion_propia` para PaddleOCR, solo que aquí SÍ hay que traer los
    ficheros nosotros, no dejar que la librería los pida sola la primera vez
    que se instancia."""
    from huggingface_hub import snapshot_download

    os.makedirs(destino, exist_ok=True)
    print(f"      descargando repositorio de huggingface {repo_id}…", flush=True)
    snapshot_download(repo_id=repo_id, local_dir=destino, token=HF_TOKEN or None)


def descargar(url, destino, item_id):
    os.makedirs(os.path.dirname(destino), exist_ok=True)
    with _abrir(url) as resp:
        total = int(resp.headers.get("Content-Length", 0))
        h = hashlib.sha256()
        hechos = 0
        tmp = destino + ".part"
        with open(tmp, "wb") as f:
            while True:
                trozo = resp.read(1 << 20)
                if not trozo:
                    break
                f.write(trozo)
                h.update(trozo)
                hechos += len(trozo)
                progreso(item_id, hechos, total)
        os.replace(tmp, destino)
        return h.hexdigest()


def main():
    # Por stdin, no por argv: una licencia real (GPL entera, por ejemplo)
    # mide decenas de KB, y Windows corta la linea de comandos completa en
    # unos 32K caracteres -- pasado ese tope ni siquiera se llega a arrancar
    # el proceso. stdin no tiene ese limite.
    items = json.loads(sys.stdin.read())
    total_n = len(items)
    for i, item in enumerate(items, 1):
        item_id = item["id"]
        print(f"[{i}/{total_n}] {item_id}", flush=True)

        if item.get("gestion_propia"):
            # PaddleOCR: su propia libreria baja sus pesos la primera vez que
            # se instancia. Aqui solo se deja constancia de la licencia.
            directorio = os.path.dirname(item["destino"])
            os.makedirs(directorio, exist_ok=True)
            with open(os.path.join(directorio, "LICENCIA.txt"), "w") as f:
                f.write(item["licencia_texto"])
            print(f"      gestion propia: licencia escrita, la libreria trae sus pesos sola", flush=True)
            continue

        if item.get("hf_repo"):
            destino_dir = item["destino"]
            _snapshot(item["hf_repo"], destino_dir, item_id)
            with open(os.path.join(destino_dir, "LICENCIA.txt"), "w") as f:
                f.write(item["licencia_texto"])
            print(f"      licencia escrita en {destino_dir}/LICENCIA.txt", flush=True)
            continue

        destino = item["destino"]
        real = descargar(item["fichero_url"], destino, item_id)

        esperado = item.get("sha256", "")
        if esperado:
            if real != esperado:
                os.remove(destino)
                print(f"FATAL sha256 no coincide en {item_id}: esperado {esperado}, real {real}", flush=True)
                sys.exit(1)
            print(f"      sha256 ok  hash conocido", flush=True)
        else:
            print(f"      el registro no traia sha256; se anota el de lo descargado", flush=True)
            print(f"      verificado solo contra si mismo", flush=True)

        directorio = os.path.dirname(destino)
        with open(os.path.join(directorio, "LICENCIA.txt"), "w") as f:
            f.write(item["licencia_texto"])
        print(f"      licencia escrita en {directorio}/LICENCIA.txt", flush=True)

        # El hash real se imprime en una linea que Rust reconoce y usa para
        # reescribir el registro (Tarea 6) — igual que el progreso, sin
        # inventar un segundo canal.
        print("@sha256 " + json.dumps({"item": item_id, "sha256": real}), flush=True)

    print("hecho", flush=True)


if __name__ == "__main__":
    main()