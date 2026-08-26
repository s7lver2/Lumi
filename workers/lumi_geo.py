#!/usr/bin/env python3
"""Trabajador de geolocalizacion de Lumi (subsistema 5a).

Solo embebe: convierte la imagen de consulta en un vector y contesta la ruta
de un fichero temporal. No busca, no agrupa, no atribuye — eso vive en el
daemon, en Rust, porque la procedencia (que indice, que autor) esta en
SQLite y este trabajador no tiene SQLite. Sale de `lumi_embed.py`, que ya
hace exactamente esto para el Indexer; la diferencia es el tipo de mensaje
de entrada ("trabajo", con una sola imagen, no "lote") y de salida.

El subsistema 5b sustituyo `_cargar` y `_vector` por la carga de pesos y la
inferencia de verdad, en `lumi_pesos.py`. Ese modulo si necesita el venv con
torch; este script sigue arrancando en el interprete del sistema y solo
importa `lumi_pesos` en cuanto llega el primer trabajo.

Protocolo: una linea de JSON por mensaje. Entra por stdin, sale por stdout,
el log va por stderr. Los VECTORES NO SALEN POR STDOUT: se escriben en un
fichero temporal de float32 crudo y se contesta con su ruta, misma razon que
en el Indexer.
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
    """Carga de verdad, y cachea: cambiar de modelo cuesta leer pesos del
    disco, y con ocho por analisis eso se paga ocho veces por trabajo si no se
    guardan."""
    if modelo in _cargados:
        return _cargados[modelo]
    import lumi_pesos

    _log("cargando modelo %s en %s" % (modelo, DISPOSITIVO))
    e = lumi_pesos.cargar(modelo, REGISTRO, PESOS, DISPOSITIVO)
    _cargados[modelo] = e
    _decir({"tipo": "listo", "dispositivo": DISPOSITIVO, "modelo": modelo})
    return e


def _embeber(job):
    """Una linea `vectores` POR MODELO. Si el tercero de ocho revienta, los dos
    primeros ya salieron y el fallo dice cual fue.

    La imagen de consulta es la primera del trabajo: un analisis hoy es siempre
    una sola imagen (ver lumi_proto::api::Analysis)."""
    rutas = job["imagenes"]
    if not rutas:
        return [{"tipo": "fallo", "id": job["id"], "motivo": "el trabajo no trae ninguna imagen"}]
    ruta = rutas[0]
    if not os.path.exists(ruta):
        return [{"tipo": "fallo", "id": job["id"], "motivo": "no existe la imagen %s" % ruta}]

    modelos = job.get("modelos") or [job["modelo"]]
    fuera = []
    for i, modelo in enumerate(modelos):
        _decir({"tipo": "progreso", "id": job["id"], "fase": "embebiendo",
                "pct": int(100 * i / len(modelos))})
        try:
            e = _cargar(modelo)
            v = e.vector(ruta)
        except Exception as err:
            fuera.append({"tipo": "fallo", "id": job["id"],
                          "motivo": "modelo %s: %s" % (modelo, err)})
            continue
        fd, destino = tempfile.mkstemp(prefix="lumi-geo-%d-" % job["id"], suffix=".f32")
        with os.fdopen(fd, "wb") as f:
            f.write(struct.pack("<%df" % e.dims, *v))
        fuera.append({"tipo": "vectores", "id": job["id"], "modelo": modelo,
                      "dims": e.dims, "fichero": destino})
    return fuera


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
            for msg in _embeber(job):
                _decir(msg)
        except Exception as e:
            _decir({"tipo": "fallo", "id": job["id"], "motivo": str(e)})


if __name__ == "__main__":
    main()
