#!/usr/bin/env python3
"""El trabajador del upscaler de IA (spec 2026-09-10 §2, sección 2).

Mismo contrato que `lumi_agentes.py`/`lumi_verify.py`: JSON por líneas sobre
stdin/stdout, stderr es el log. Una orden trae una ruta de entrada (la imagen
ya recortada/con blur aplicado desde `ImageEditorPopup.tsx`) y una ruta de
salida; el trabajador escribe el resultado ahí y contesta con esa misma ruta
-- la imagen viaja por RUTA y no por bytes en la tubería, igual que el resto
de trabajos de este proyecto (ver `lumi_proto::worker::Job`).

Un solo motor («upscalador», clase única en `registros/motores/`), pero se
mantiene el mismo patrón de caché+desalojo que `lumi_agentes.py` porque es
exactamente el mismo caso: un proceso persistente que no debería recargar el
modelo en cada trabajo, y que si `LUMI_LIMPIEZA_PRESION` está activo debe
poder desalojarlo bajo presión de memoria igual que a cualquier otro.
"""
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from lumi_motores import cargar_motor

PESOS = os.environ.get("LUMI_PESOS", "pesos")
LIMPIEZA_PRESION = os.environ.get("LUMI_LIMPIEZA_PRESION", "1") != "0"

_motores = {}
_ultimo_uso = {}


def escribir(msg):
    sys.stdout.write(json.dumps(msg, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def dispositivo():
    explicito = os.environ.get("LUMI_DEVICE")
    if explicito:
        return explicito
    try:
        import torch
        if torch.cuda.is_available():
            return "cuda"
    except Exception:
        pass
    return "cpu"


def _motor(disp):
    if "upscalador" not in _motores:
        import lumi_pesos
        for m in lumi_pesos.quizas_purgar_por_presion(_motores, _ultimo_uso, LIMPIEZA_PRESION):
            print("motor %s desalojado por presion de memoria" % m, file=sys.stderr)
        try:
            _motores["upscalador"] = cargar_motor("upscalador", PESOS, disp)
        except Exception as e:
            print("motor upscalador fuera: %s" % e, file=sys.stderr)
            _motores["upscalador"] = None
    if _motores["upscalador"] is not None:
        _ultimo_uso["upscalador"] = time.time()
    return _motores["upscalador"]


def _procesar(orden, disp):
    if _motores:
        import lumi_pesos
        for m in lumi_pesos.purgar_inactivos(_motores, _ultimo_uso):
            print("motor %s desalojado por inactividad" % m, file=sys.stderr)

    id_trabajo = orden["id"]
    motor = _motor(disp)
    if motor is None:
        escribir({"tipo": "fallo", "id": id_trabajo, "motivo": "el motor upscalador no está disponible en este servidor"})
        return
    try:
        motor.procesar(orden["ruta_entrada"], orden["ruta_salida"])
    except Exception as e:
        escribir({"tipo": "fallo", "id": id_trabajo, "motivo": str(e)})
        return
    escribir({"tipo": "upscale", "id": id_trabajo, "ruta": orden["ruta_salida"]})


def main():
    import lumi_pesos
    lumi_pesos._limitar_hilos()
    disp = dispositivo()
    escribir({"tipo": "listo", "dispositivo": disp, "modelo": None})

    for linea in sys.stdin:
        linea = linea.strip()
        if not linea:
            continue
        try:
            orden = json.loads(linea)
        except ValueError:
            print("linea ilegible, se ignora: %s" % linea[:120], file=sys.stderr)
            continue
        try:
            _procesar(orden, disp)
        except Exception as e:
            print("orden fallo: %s" % e, file=sys.stderr)
        escribir({"tipo": "fin", "id": orden.get("id", 0)})


if __name__ == "__main__":
    main()
