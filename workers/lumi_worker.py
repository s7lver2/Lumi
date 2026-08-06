#!/usr/bin/env python3
"""Trabajador de referencia de Lumi.

No infiere nada: devuelve una coordenada fija. Existe para que el contrato del
subsistema 4 sea ejecutable y no solo un documento — la unica forma de saber si
una frontera aguanta es cruzarla.

El subsistema 5 sustituye `_cargar` y `_resolver` por la carga de pesos y la
inferencia de verdad. No deberia tener que tocar nada mas de este archivo, y
nada en absoluto del daemon.

Protocolo: una linea de JSON por mensaje. Entra por stdin, sale por stdout, el
log va por stderr. Sin dependencias: tiene que arrancar en el interprete del
sistema, sin venv.
"""
import json
import os
import sys
import time

DISPOSITIVO = os.environ.get("LUMI_DEVICE", "cpu")
# Lo que tardaria en cargar pesos de verdad. Se puede subir a mano para probar
# que el daemon aguanta un arranque lento sin dar el trabajador por muerto.
CARGA_S = float(os.environ.get("LUMI_FAKE_LOAD_S", "0"))

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


def _resolver(job):
    """El subsistema 5 sustituye esto por la inferencia real."""
    for ruta in job["imagenes"]:
        if not os.path.exists(ruta):
            return {"tipo": "fallo", "id": job["id"],
                    "motivo": "no existe la imagen %s" % ruta}
    _decir({"tipo": "progreso", "id": job["id"], "fase": "extrayendo", "pct": 50})
    # Fijas y no aleatorias: dos ejecuciones dan lo mismo y una captura de
    # pantalla sigue valiendo manana.
    return {"tipo": "resultado", "id": job["id"],
            "lat": 43.3612, "lng": -8.4104, "radio_m": 1400.0, "confianza": 0.72}


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
            _decir(_resolver(job))
        except Exception as e:
            _decir({"tipo": "fallo", "id": job["id"], "motivo": str(e)})


if __name__ == "__main__":
    main()
