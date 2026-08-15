#!/usr/bin/env python3
"""Trabajador de referencia de embebido del Lumi Indexer.

No embebe nada: devuelve vectores deterministas derivados de la ruta. Existe
para que el contrato sea ejecutable y no solo un documento — la unica forma de
saber si una frontera aguanta es cruzarla.

El subsistema 5b sustituyo `_cargar` y `_vector` por la carga de pesos y la
inferencia de verdad, en `lumi_pesos.py` — compartido con `lumi_geo.py`, para
que Station y el Indexer produzcan EL MISMO VECTOR para el mismo modelo.

Protocolo: una linea de JSON por mensaje. Entra por stdin, sale por stdout, el
log va por stderr. Los VECTORES NO SALEN POR STDOUT: se escriben en un fichero
temporal de float32 crudo y se contesta con su ruta.
"""
import json
import os
import struct
import sys
import tempfile

DISPOSITIVO = os.environ.get("LUMI_DEVICE", "cpu")
REGISTRO = os.environ.get("LUMI_REGISTRO", "registros/modelos")
PESOS = os.environ.get("LUMI_PESOS", "pesos")

_cargados = {}


def _decir(msg):
    sys.stdout.write(json.dumps(msg, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def _log(txt):
    sys.stderr.write(txt + "\n")
    sys.stderr.flush()


def _cargar(modelo):
    if modelo in _cargados:
        return _cargados[modelo]
    import lumi_pesos

    _log("cargando modelo %s en %s" % (modelo, DISPOSITIVO))
    e = lumi_pesos.cargar(modelo, REGISTRO, PESOS, DISPOSITIVO)
    _cargados[modelo] = e
    _decir({"tipo": "listo", "dispositivo": DISPOSITIVO, "modelo": modelo})
    return e


POR_SUBLOTE = 8  # un forward por cada 8 imagenes, no uno por imagen


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

    if not rutas:
        for ruta, motivo in saltadas:
            _decir({"tipo": "saltada", "id": job["id"], "ruta": ruta, "motivo": motivo})
        return None

    modelo = _cargados[job["modelo"]]
    dims = modelo.dims
    hechas = []
    for i in range(0, len(rutas), POR_SUBLOTE):
        sublote = rutas[i:i + POR_SUBLOTE]
        ok, fallidas = modelo.vectores(sublote)
        hechas.extend(ok)
        saltadas.extend(fallidas)
        _decir({"tipo": "progreso", "id": job["id"],
                "hechas": len(hechas) + len(saltadas), "total": len(rutas)})

    for ruta, motivo in saltadas:
        _decir({"tipo": "saltada", "id": job["id"], "ruta": ruta, "motivo": motivo})

    if not hechas:
        return None

    fd, destino = tempfile.mkstemp(prefix="lumi-lote-%d-" % job["id"], suffix=".f32")
    with os.fdopen(fd, "wb") as f:
        for _, vector in hechas:
            f.write(struct.pack("<%df" % dims, *vector))
    imagenes = [ruta for ruta, _ in hechas]
    return {"tipo": "vectores", "id": job["id"], "dims": dims,
            "cuenta": len(imagenes), "fichero": destino, "imagenes": imagenes}


def _limitar_hilos():
    """Sin esto, torch coge TODOS los nucleos logicos para su propio
    paralelismo interno (redimensionar/normalizar imagenes incluido), y ese
    hilo de mas compite con la interfaz del sistema por CPU -- "el pc va
    fatal" mientras embebe no era falta de GPU, era esto. Se deja al menos
    la mitad de los nucleos libres para el resto de la maquina."""
    import torch
    nucleos = os.cpu_count() or 4
    torch.set_num_threads(max(1, nucleos // 2))


def main():
    _limitar_hilos()
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
