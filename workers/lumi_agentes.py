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


# Los motores se cargan una sola vez y solo los que hagan falta -- si el
# nivel no trae ningun agente de profundidad, no se carga Depth Anything. Vive
# a nivel de modulo (no dentro de una funcion local) para que sobreviva entre
# iteraciones del bucle de `sys.stdin`: es justo lo que hace persistente el
# proceso frente al modo de una sola orden -- el mismo cache que
# `lumi_verify.py` ya usa con `_cargados` para sus verificadores.
_motores = {}


def _motor(clase, disp):
    if clase not in _motores:
        try:
            _motores[clase] = cargar_motor(clase, PESOS, disp)
        except Exception as e:
            # Un motor que no se puede cargar —sin pesos, sin licencia, sin
            # hash— se lleva por delante a SUS agentes y a nadie mas. Se
            # recuerda como `None` para no reintentar cargarlo en cada orden
            # siguiente del mismo proceso persistente.
            print("motor %s fuera: %s" % (clase, e), file=sys.stderr)
            _motores[clase] = None
    return _motores[clase]


def _procesar(orden, disp):
    id_analisis = orden["id"]
    consulta = orden["consulta"]
    fichas = registro()
    pedidos = [fichas[i] for i in orden.get("agentes", []) if i in fichas]

    for a in pedidos:
        motor = _motor(a.get("motor", ""), disp)
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


def main():
    disp = dispositivo()
    escribir({"tipo": "listo", "dispositivo": disp, "modelo": None})

    # `for linea in sys.stdin` en vez de un `readline()` de una sola vez: es
    # lo que permite reutilizar el proceso (y los motores ya cargados en
    # `_motores`) para varios trabajos seguidos, igual que ya hace
    # `lumi_verify.py`. Un lanzador que manda una sola orden y cierra stdin
    # (el modo no persistente de hoy, que sigue siendo el que usa Rust por
    # defecto) se comporta exactamente igual que antes: el bucle procesa esa
    # unica linea y termina en el EOF que deja el cierre.
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
        # `fin` cierra los mensajes de ESTE trabajo -- no hacia falta en modo
        # no persistente (el EOF del proceso ya lo decia), pero un proceso
        # persistente (`crate::persistente`, ver `lumid/src/agentar.rs`) no
        # cierra stdout entre trabajos y necesita una marca explicita para
        # saber donde termina uno. Es un mensaje NUEVO y no toca ninguno de
        # los campos que ya existian, asi que un lector que solo conociera el
        # protocolo de ayer simplemente lo ignora -- `agentar::correr` (modo
        # no persistente) solo mira `Msg::Agente` y no reconoce este tipo.
        escribir({"tipo": "fin", "id": orden.get("id", 0)})


if __name__ == "__main__":
    main()
