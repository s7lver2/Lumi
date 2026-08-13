#!/usr/bin/env python3
"""Trabajador de verificacion geometrica (subsistema 5b).

Recibe una imagen de consulta y una lista de candidatos con su ruta, y contesta
UNA LINEA POR (candidato, verificador) con cuantas correspondencias sobreviven
a RANSAC. No decide nada: quien arbitra es el daemon, en Rust, porque el
arbitraje es logica pura y esta probada alli.

Protocolo: una linea de JSON por mensaje, igual que los demas trabajadores. El
log va por stderr y no tiene contrato.
"""
import json
import os
import sys

DISPOSITIVO = os.environ.get("LUMI_DEVICE", "cpu")
REGISTRO = os.environ.get("LUMI_REGISTRO_VERIF", "registros/verificadores")
PESOS = os.environ.get("LUMI_PESOS", "pesos")

_cargados = {}


def _decir(msg):
    sys.stdout.write(json.dumps(msg, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def _log(txt):
    sys.stderr.write(txt + "\n")
    sys.stderr.flush()


def _cargar(verificador):
    """Los pesos se verifican por sha256 igual que los del embebedor: se
    reutiliza `lumi_pesos._verificar` para no tener dos posturas distintas
    sobre lo mismo."""
    if verificador in _cargados:
        return _cargados[verificador]
    import lumi_pesos
    import torch

    ficha = lumi_pesos._ficha(verificador, REGISTRO)
    directorio = os.path.join(PESOS, verificador)
    ruta = os.path.join(directorio, "pesos.pth")
    lumi_pesos._licencia(directorio)
    lumi_pesos._verificar(ruta, ficha.get("sha256", ""))
    m = torch.load(ruta, map_location=DISPOSITIVO, weights_only=False)
    m.eval()
    _cargados[verificador] = m
    _decir({"tipo": "listo", "dispositivo": DISPOSITIVO, "modelo": verificador})
    return m


def _inliers(matcher, consulta, candidato):
    """Correspondencias que sobreviven a RANSAC sobre la matriz fundamental.
    Es la unica senal del arbitraje, y por eso es lo unico que se devuelve."""
    import cv2
    import numpy as np
    import torch

    with torch.no_grad():
        salida = matcher({"image0": consulta, "image1": candidato})
    a = salida["keypoints0"].cpu().numpy()
    b = salida["keypoints1"].cpu().numpy()
    if len(a) < 8:
        # Por debajo de ocho puntos la matriz fundamental no se puede estimar:
        # no es «pocas correspondencias», es «ninguna respuesta».
        return 0
    _, mascara = cv2.findFundamentalMat(a, b, cv2.FM_RANSAC, 3.0, 0.99)
    return int(np.sum(mascara)) if mascara is not None else 0


def _verificar(job):
    fuera = []
    consulta = job["consulta"]
    for cand in job["candidatos"]:
        for verificador in job["verificadores"]:
            try:
                m = _cargar(verificador)
                n = _inliers(m, consulta, cand["ruta"])
            except Exception as e:
                _log("verificador %s sobre %s: %s" % (verificador, cand["id"], e))
                continue
            fuera.append({"tipo": "verificado", "id": job["id"], "candidato": cand["id"],
                          "verificador": verificador, "inliers": n,
                          "lat": cand["lat"], "lng": cand["lng"]})
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
        if job.get("tipo") != "verificar":
            _log("orden desconocida, se ignora: %s" % job.get("tipo"))
            continue
        try:
            for msg in _verificar(job):
                _decir(msg)
        except Exception as e:
            _decir({"tipo": "fallo", "id": job["id"], "motivo": str(e)})


if __name__ == "__main__":
    main()
