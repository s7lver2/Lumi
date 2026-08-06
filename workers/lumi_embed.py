#!/usr/bin/env python3
"""Trabajador de referencia de embebido del Lumi Indexer.

No embebe nada: devuelve vectores deterministas derivados de la ruta. Existe
para que el contrato sea ejecutable y no solo un documento — la unica forma de
saber si una frontera aguanta es cruzarla.

El subsistema 7b y el 5 sustituyen `_cargar` y `_embeber` por la carga de pesos
y la inferencia de verdad. No deberia hacer falta tocar nada mas de este
archivo, y nada en absoluto de la aplicacion.

Protocolo: una linea de JSON por mensaje. Entra por stdin, sale por stdout, el
log va por stderr. Los VECTORES NO SALEN POR STDOUT: se escriben en un fichero
temporal de float32 crudo y se contesta con su ruta. Sin dependencias.
"""
import hashlib
import json
import os
import struct
import sys
import tempfile
import time

DISPOSITIVO = os.environ.get("LUMI_DEVICE", "cpu")
CARGA_S = float(os.environ.get("LUMI_FAKE_LOAD_S", "0"))
# Dimensiones de mentira, pequenas a proposito: el contrato no depende del
# tamano y un fichero de 12288 flotantes por imagen no aporta nada a la prueba.
DIMS = int(os.environ.get("LUMI_FAKE_DIMS", "64"))

_modelo = None


def _decir(msg):
    sys.stdout.write(json.dumps(msg, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def _log(txt):
    sys.stderr.write(txt + "\n")
    sys.stderr.flush()


def _cargar(modelo):
    """El subsistema 5 sustituye esto por la carga real de pesos."""
    global _modelo
    if _modelo == modelo:
        return
    _log("cargando modelo %s en %s" % (modelo, DISPOSITIVO))
    time.sleep(CARGA_S)
    _modelo = modelo
    _decir({"tipo": "listo", "dispositivo": DISPOSITIVO, "modelo": _modelo})


def _vector(ruta):
    """El subsistema 5 sustituye esto por la inferencia real.

    Determinista a partir de la ruta y normalizado a L2, que es la precondicion
    del formato de fragmento: sin ella la escala fija de int8 no vale.
    """
    semilla = hashlib.sha256(ruta.encode("utf-8")).digest()
    crudo = [((semilla[i % len(semilla)] / 255.0) - 0.5) for i in range(DIMS)]
    norma = sum(x * x for x in crudo) ** 0.5
    return [x / norma for x in crudo] if norma > 0 else crudo


def _embeber(job):
    rutas, saltadas = [], []
    for ruta in job["imagenes"]:
        if not os.path.exists(ruta):
            saltadas.append((ruta, "no existe el fichero"))
            continue
        if os.path.getsize(ruta) == 0:
            saltadas.append((ruta, "el fichero esta vacio"))
            continue
        rutas.append(ruta)

    for ruta, motivo in saltadas:
        _decir({"tipo": "saltada", "id": job["id"], "ruta": ruta, "motivo": motivo})

    if not rutas:
        return None

    fd, destino = tempfile.mkstemp(prefix="lumi-lote-%d-" % job["id"], suffix=".f32")
    with os.fdopen(fd, "wb") as f:
        for i, ruta in enumerate(rutas):
            f.write(struct.pack("<%df" % DIMS, *_vector(ruta)))
            if (i + 1) % 16 == 0:
                _decir({"tipo": "progreso", "id": job["id"],
                        "hechas": i + 1, "total": len(rutas)})
    return {"tipo": "vectores", "id": job["id"], "dims": DIMS,
            "cuenta": len(rutas), "fichero": destino, "imagenes": rutas}


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
        if job.get("tipo") != "lote":
            _log("orden desconocida, se ignora: %s" % job.get("tipo"))
            continue
        try:
            _cargar(job["modelo"])
        except Exception as e:
            # No poder cargar el modelo es un fallo DE ESTE LOTE, no una averia
            # del trabajador: se contesta y se sigue vivo esperando el
            # siguiente, que puede pedir un modelo que si esta.
            _decir({"tipo": "fallo", "id": job["id"],
                    "motivo": "no se pudo cargar el modelo %s: %s" % (job["modelo"], e)})
            continue
        try:
            salida = _embeber(job)
            if salida is not None:
                _decir(salida)
            else:
                _decir({"tipo": "fallo", "id": job["id"],
                        "motivo": "ninguna imagen del lote era utilizable"})
        except Exception as e:
            _decir({"tipo": "fallo", "id": job["id"], "motivo": str(e)})


if __name__ == "__main__":
    main()
