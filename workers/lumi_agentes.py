#!/usr/bin/env python3
"""El trabajador de agentes: una foto entra, un veredicto por agente sale.

Mismo contrato que el resto -- JSON por lineas sobre stdin/stdout, stderr es
el log y no tiene contrato. La orden trae los IDS de los agentes y no sus
fichas: el registro lo lee este proceso, igual que `lumi_pesos` lee el de
modelos. Asi la pregunta de un agente se corrige editando un JSON y nadie
recompila nada.

Ocho fichas en el registro desde el rediseño de 2026-09-17 (antes seis,
tres de ellas fusionadas con sub_preguntas) -- ahora cada ficha es un
agente independiente, sin fusión ni ids compuestos: un veredicto por
agente pedido, siempre. `lumi_index::agentes` ya no tiene ninguna función
`aplanar` que consumir."""
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from lumi_motores import cargar_motor

REGISTRO = os.environ.get("LUMI_REGISTRO_AGENTES", "registros/agentes")
REGISTRO_MOTORES = os.environ.get("LUMI_REGISTRO_MOTORES", "registros/motores")
PESOS = os.environ.get("LUMI_PESOS", "pesos")
#: Segura por defecto -- activa salvo que se ponga explicitamente a "0", igual
#: criterio que ya usa el proyecto para otros flags. Se lee una sola vez al
#: arrancar el proceso, no en cada orden.
LIMPIEZA_PRESION = os.environ.get("LUMI_LIMPIEZA_PRESION", "1") != "0"


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


def _registro_motores():
    """`{clase: (motor_id, cuantizacion_o_None)}` -- el primer motor de cada
    clase que aparezca en orden alfabético de fichero, igual criterio de
    desempate que ya usa `lumi_index::agentes::motores_de_agentes` en Rust
    (hoy siempre hay como mucho uno por clase, así que el desempate no
    importa en la práctica)."""
    fuera = {}
    if not os.path.isdir(REGISTRO_MOTORES):
        return fuera
    for nombre in sorted(os.listdir(REGISTRO_MOTORES)):
        if not nombre.endswith(".json"):
            continue
        try:
            with open(os.path.join(REGISTRO_MOTORES, nombre), encoding="utf-8") as f:
                d = json.load(f)
            fuera.setdefault(d["clase"], (d["id"], d.get("cuantizacion")))
        except Exception as e:
            print("motor descartado, %s: %s" % (nombre, e), file=sys.stderr)
    return fuera


def dispositivo():
    # `LUMI_DEVICE` es lo que manda cuando lo hay -- `verificar.rs` ya se lo
    # pasaba a la verificación geométrica, pero `agentar.rs` no se lo pasaba
    # a este proceso, así que en una caja con varias GPUs los agentes de un
    # análisis en "cuda:1" acababan siempre en "cuda:0" por el auto-detectado
    # de abajo, compitiendo con quien de verdad estuviera trabajando ahí.
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


# Los motores se cargan una sola vez y solo los que hagan falta -- si el
# nivel no trae ningun agente de un tipo, no se carga su motor. Vive a nivel
# de modulo (no dentro de una funcion local) para que sobreviva entre
# iteraciones del bucle de `sys.stdin`: es justo lo que hace persistente el
# proceso frente al modo de una sola orden -- el mismo cache que
# `lumi_verify.py` ya usa con `_cargados` para sus verificadores.
_motores = {}
#: Último uso (`time.time()`) de cada motor en `_motores` -- ver
#: `lumi_pesos.purgar_inactivos`, llamado al principio de cada orden. Un
#: motor que falló al cargar (`_motores[clase] = None`, justo abajo) nunca
#: entra aquí, así que nunca se desaloja: reintentarlo no cuesta memoria.
_ultimo_uso = {}


def _motor(clase, disp):
    if clase not in _motores:
        # Justo antes de pedir memoria para un motor nuevo, no en cada orden
        # entera (eso ya lo hace `purgar_inactivos` en `_procesar`).
        import lumi_pesos
        for m in lumi_pesos.quizas_purgar_por_presion(_motores, _ultimo_uso, LIMPIEZA_PRESION):
            print("motor %s desalojado por presion de memoria" % m, file=sys.stderr)
        entrada = _registro_motores().get(clase)
        if entrada is None:
            print("motor %s fuera: sin entrada en el registro de motores" % clase, file=sys.stderr)
            _motores[clase] = None
        else:
            motor_id, cuantizacion = entrada
            try:
                _motores[clase] = cargar_motor(clase, motor_id, PESOS, disp, cuantizacion=cuantizacion)
            except Exception as e:
                # Un motor que no se puede cargar —sin pesos, sin licencia,
                # sin hash— se lleva por delante a SUS agentes y a nadie mas.
                # Se recuerda como `None` para no reintentar cargarlo en cada
                # orden siguiente del mismo proceso persistente.
                print("motor %s fuera: %s" % (clase, e), file=sys.stderr)
                _motores[clase] = None
    if _motores[clase] is not None:
        _ultimo_uso[clase] = time.time()
    return _motores[clase]


def _procesar(orden, disp):
    if _motores:
        # Solo si ya se cargó algo alguna vez -- evita el import de balde en
        # la primera orden de un proceso recién arrancado.
        import lumi_pesos
        for m in lumi_pesos.purgar_inactivos(_motores, _ultimo_uso):
            print("motor %s desalojado por inactividad" % m, file=sys.stderr)

    id_analisis = orden["id"]
    consulta = orden["consulta"]
    fichas = registro()
    pedidos = [fichas[i] for i in orden.get("agentes", []) if i in fichas]
    calibracion_activo = os.environ.get("LUMI_MODO_CALIBRACION") == "1"

    for a in pedidos:
        # Único motor hoy (vlm), pero la clave sigue siendo "clase de motor"
        # y no "id de agente" -- si algún día vuelve a haber más de una
        # clase, esto no cambia.
        motor = _motor("vlm", disp)
        if motor is None:
            continue
        try:
            if a.get("modo") == "transcripcion":
                texto = motor.transcribir(a, consulta)
                if not texto:
                    continue
                escribir({
                    "tipo": "agente", "id": id_analisis, "agente": a["id"],
                    "etiqueta": texto[:400], "detalle": texto[:400],
                    "alternativas": [], "apoyo_visual": None,
                    "respuesta_cruda": None,
                })
                continue
            etiqueta_id, confianza, alternativas, apoyo_visual = motor.responder(a, consulta)
        except Exception as e:
            print("agente %s fallo: %s" % (a["id"], e), file=sys.stderr)
            continue
        if not etiqueta_id:
            continue
        escribir({
            "tipo": "agente", "id": id_analisis, "agente": a["id"],
            "etiqueta": etiqueta_id, "confianza": float(confianza), "detalle": "",
            "alternativas": [[e, float(p)] for e, p in (alternativas or [])],
            "apoyo_visual": float(apoyo_visual) if apoyo_visual is not None else None,
            "respuesta_cruda": json.dumps(alternativas) if calibracion_activo else None,
        })


def main():
    # Compartido con los demás trabajadores -- ver el docstring de
    # `lumi_pesos._limitar_hilos`. Este proceso ya importa `lumi_motores`
    # (y con él, transformers/torch) al arrancar, así que no hay nada que
    # esperar como sí hace `lumi_geo.py`.
    import lumi_pesos
    lumi_pesos._limitar_hilos()
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
        # `fin` cierra los mensajes de ESTE trabajo -- ver el docstring de
        # `crate::persistente` en el daemon.
        escribir({"tipo": "fin", "id": orden.get("id", 0)})


if __name__ == "__main__":
    main()
