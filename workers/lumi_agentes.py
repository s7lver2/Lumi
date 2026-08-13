#!/usr/bin/env python3
"""El trabajador de agentes: una foto entra, un veredicto por agente sale.

Mismo contrato que el resto —JSON por lineas sobre stdin/stdout, stderr es el
log y no tiene contrato—. La orden trae los IDS de los agentes y no sus fichas:
el registro lo lee este proceso, igual que `lumi_pesos` lee el de modelos. Asi
la pregunta de un agente se corrige editando un JSON y nadie recompila nada.

Casi todos los agentes miran SOLO la imagen de consulta: el idioma de un cartel
no depende de que candidato se este mirando. Por eso entra una imagen y salen
doce veredictos, y no doce por candidato.
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from lumi_motores import cargar_motor

REGISTRO = os.environ.get("LUMI_REGISTRO_AGENTES", "registros/agentes")
PESOS = os.environ.get("LUMI_PESOS", "pesos")


def escribir(msg):
    sys.stdout.write(json.dumps(msg, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def registro():
    fuera = {}
    if not os.path.isdir(REGISTRO):
        return fuera
    for nombre in sorted(os.listdir(REGISTRO)):
        if not nombre.endswith(".json"):
            continue
        try:
            with open(os.path.join(REGISTRO, nombre), encoding="utf-8") as f:
                d = json.load(f)
            fuera[d["id"]] = d
        except Exception as e:
            # Un fichero malo cuesta un agente, nunca la lista.
            print("agente descartado, %s: %s" % (nombre, e), file=sys.stderr)
    return fuera


def dispositivo():
    try:
        import torch
        if torch.cuda.is_available():
            return "cuda"
    except Exception:
        pass
    return "cpu"


def main():
    disp = dispositivo()
    escribir({"tipo": "listo", "dispositivo": disp, "modelo": None})

    linea = sys.stdin.readline()
    if not linea.strip():
        return
    orden = json.loads(linea)
    id_analisis = orden["id"]
    consulta = orden["consulta"]
    fichas = registro()
    pedidos = [fichas[i] for i in orden.get("agentes", []) if i in fichas]

    # Los motores se cargan una sola vez y solo los que hagan falta: si el
    # nivel no trae ningun agente de profundidad, no se carga Depth Anything.
    motores = {}
    for a in pedidos:
        clase = a.get("motor", "")
        if clase in motores:
            continue
        try:
            motores[clase] = cargar_motor(clase, PESOS, disp)
        except Exception as e:
            # Un motor que no se puede cargar —sin pesos, sin licencia, sin
            # hash— se lleva por delante a SUS agentes y a nadie mas.
            print("motor %s fuera: %s" % (clase, e), file=sys.stderr)
            motores[clase] = None

    for a in pedidos:
        motor = motores.get(a.get("motor", ""))
        if motor is None:
            continue
        try:
            etiqueta, confianza, detalle = motor.responder(a, consulta)
        except Exception as e:
            print("agente %s fallo: %s" % (a["id"], e), file=sys.stderr)
            continue
        if not etiqueta:
            continue
        escribir({
            "tipo": "agente", "id": id_analisis, "agente": a["id"],
            "etiqueta": etiqueta, "confianza": float(confianza), "detalle": detalle or "",
        })


if __name__ == "__main__":
    main()
