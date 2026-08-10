#!/usr/bin/env python3
"""Trabajador de geolocalizacion de Lumi Station (subsistema 5a).

Solo embebe: convierte la imagen de consulta en un vector y contesta la ruta
de un fichero temporal. No busca, no agrupa, no atribuye — eso vive en el
daemon, en Rust, porque la procedencia (que indice, que autor) esta en
SQLite y este trabajador no tiene SQLite. Sale de `lumi_embed.py`, que ya
hace exactamente esto para el Indexer; la diferencia es el tipo de mensaje
de entrada ("trabajo", con una sola imagen, no "lote") y de salida.

El subsistema 5b sustituye `_cargar` y `_vector` por la carga de pesos y la
inferencia de verdad. No deberia hacer falta tocar nada mas de este archivo,
y nada en absoluto del daemon.

Protocolo: una linea de JSON por mensaje. Entra por stdin, sale por stdout,
el log va por stderr. Los VECTORES NO SALEN POR STDOUT: se escriben en un
fichero temporal de float32 crudo y se contesta con su ruta, misma razon que
en el Indexer. Sin dependencias: tiene que arrancar en el interprete del
sistema, sin venv.
"""
import hashlib
import json
import os
import struct
import sys
import tempfile
import time

DISPOSITIVO = os.environ.get("LUMI_DEVICE", "cpu")
# Lo que tardaria en cargar pesos de verdad. Se puede subir a mano para probar
# que el daemon aguanta un arranque lento sin dar el trabajador por muerto.
CARGA_S = float(os.environ.get("LUMI_FAKE_LOAD_S", "0"))
# Dimensiones de mentira, pequenas a proposito: el contrato no depende del
# tamano y un fichero de 12288 flotantes no aporta nada a la prueba.
DIMS = int(os.environ.get("LUMI_FAKE_DIMS", "64"))

_modelo = None


def _decir(msg):
    sys.stdout.write(json.dumps(msg, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def _log(txt):
    sys.stderr.write(txt + "\n")
    sys.stderr.flush()


def _cargar(modelo):
    """El subsistema 5b sustituye esto por la carga real de pesos."""
    global _modelo
    if _modelo == modelo:
        return
    _log("cargando modelo %s en %s" % (modelo, DISPOSITIVO))
    time.sleep(CARGA_S)
    _modelo = modelo
    _decir({"tipo": "listo", "dispositivo": DISPOSITIVO, "modelo": _modelo})


def _vector(ruta):
    """El subsistema 5b sustituye esto por la inferencia real.

    Determinista a partir de la ruta y normalizado a L2, que es la
    precondicion del formato de fragmento (`lumi_index::vectors`): sin ella
    la escala fija del int8 no vale.
    """
    semilla = hashlib.sha256(ruta.encode("utf-8")).digest()
    crudo = [((semilla[i % len(semilla)] / 255.0) - 0.5) for i in range(DIMS)]
    norma = sum(x * x for x in crudo) ** 0.5
    return [x / norma for x in crudo] if norma > 0 else crudo


def _embeber(job):
    """La imagen de consulta es la primera del trabajo: un analisis hoy es
    siempre una sola imagen (ver lumi_proto::api::Analysis)."""
    rutas = job["imagenes"]
    if not rutas:
        return {"tipo": "fallo", "id": job["id"], "motivo": "el trabajo no trae ninguna imagen"}
    ruta = rutas[0]
    if not os.path.exists(ruta):
        return {"tipo": "fallo", "id": job["id"], "motivo": "no existe la imagen %s" % ruta}

    _decir({"tipo": "progreso", "id": job["id"], "fase": "embebiendo", "pct": 50})

    fd, destino = tempfile.mkstemp(prefix="lumi-geo-%d-" % job["id"], suffix=".f32")
    with os.fdopen(fd, "wb") as f:
        f.write(struct.pack("<%df" % DIMS, *_vector(ruta)))
    return {"tipo": "vectores", "id": job["id"], "dims": DIMS, "fichero": destino}


def main():
    _decir({"tipo": "listo", "dispositivo": DISPOSITIVO, "modelo": None})
    for linea in sys.stdin:
        linea = linea.strip()
        if not linea:
            continue
        try:
            job = json.loads(linea)
        except ValueError:
            _log("linea ilegible, se ignora: %s" % linea[:120])
            continue
        if job.get("tipo") != "trabajo":
            _log("orden desconocida, se ignora: %s" % job.get("tipo"))
            continue
        try:
            _cargar(job["modelo"])
        except Exception as e:
            # No poder cargar el modelo es un fallo DE ESTE TRABAJO, no una
            # averia del trabajador: se contesta y se sigue vivo esperando el
            # siguiente, que puede pedir un modelo que si esta.
            _decir({"tipo": "fallo", "id": job["id"],
                    "motivo": "no se pudo cargar el modelo %s: %s" % (job["modelo"], e)})
            continue
        try:
            _decir(_embeber(job))
        except Exception as e:
            _decir({"tipo": "fallo", "id": job["id"], "motivo": str(e)})


if __name__ == "__main__":
    main()
