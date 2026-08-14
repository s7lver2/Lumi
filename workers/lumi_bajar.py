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
import json
import os
import sys
import urllib.request


def progreso(item_id, hechos, total):
    linea = json.dumps({"item": item_id, "mib": hechos // (1 << 20), "total_mib": total // (1 << 20),
                         "pct": int(hechos * 100 / total) if total else 0})
    print("@progreso " + linea, flush=True)


def descargar(url, destino, item_id):
    os.makedirs(os.path.dirname(destino), exist_ok=True)
    with urllib.request.urlopen(url) as resp:
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
    items = json.loads(sys.argv[1])
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