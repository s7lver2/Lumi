#!/usr/bin/env python3
"""Banco de pruebas de agentes con verdad conocida (spec 2026-09-17 §6).

Uso: python tools/evaluar_agentes.py <carpeta-de-fotos>

Corre todos los agentes activos del registro sobre todas las fotos de
`pruebas/agentes/verdad.json` que existan de verdad en <carpeta-de-fotos>, y
reporta por agente: acierto condicionado, cobertura, calibración y coste.
Es de solo lectura -- nunca reescribe una ficha. Un agente por debajo del
mínimo (acierto >= 0.70 con cobertura >= 0.20) se marca con una advertencia;
apagarlo es un "activo": false manual en su JSON.
"""
import json
import os
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "workers"))

ACIERTO_MINIMO = 0.70
COBERTURA_MINIMA = 0.20


def _registro_agentes():
    dir_ = os.path.join(ROOT, "registros", "agentes")
    fuera = []
    for nombre in sorted(os.listdir(dir_)):
        if not nombre.endswith(".json"):
            continue
        with open(os.path.join(dir_, nombre), encoding="utf-8") as f:
            a = json.load(f)
        if a.get("activo", True):
            fuera.append(a)
    return fuera


def _registro_motor_vlm():
    dir_ = os.path.join(ROOT, "registros", "motores")
    for nombre in sorted(os.listdir(dir_)):
        if not nombre.endswith(".json"):
            continue
        with open(os.path.join(dir_, nombre), encoding="utf-8") as f:
            m = json.load(f)
        if m.get("clase") == "vlm":
            return m
    return None


def _verdad():
    p = os.path.join(ROOT, "pruebas", "agentes", "verdad.json")
    with open(p, encoding="utf-8") as f:
        return json.load(f).get("fotos", [])


def _opcion_correcta_por_pais(agente, pais):
    """La opción (si hay exactamente una) cuyo `paises` incluye `pais` --
    `None` si ninguna o más de una coinciden (un país cubierto por varias
    opciones no da una verdad inequívoca por sí solo, y se salta esa foto
    para ese agente en vez de arriesgar un falso acierto/fallo)."""
    candidatas = [o["id"] for o in agente.get("opciones", []) if pais in o.get("paises", [])]
    return candidatas[0] if len(candidatas) == 1 else None


def evaluar(carpeta):
    from lumi_motores import Vlm

    agentes = _registro_agentes()
    motor_info = _registro_motor_vlm()
    if motor_info is None:
        print("sin motor vlm en el registro -- nada que evaluar", file=sys.stderr)
        return 1
    fotos = [f for f in _verdad() if os.path.isfile(os.path.join(carpeta, f["fichero"]))]
    if not fotos:
        print("ninguna foto de verdad.json existe en %s" % carpeta, file=sys.stderr)
        return 1

    dispositivo = "cuda" if _hay_cuda() else "cpu"
    motor = Vlm(os.path.join(ROOT, "pesos"), dispositivo, motor_info["id"],
                cuantizacion=motor_info.get("cuantizacion"))

    filas = []
    for a in agentes:
        if a.get("modo") != "eleccion":
            print("%-16s  transcripción, sin métrica de acierto (spec §5)" % a["id"])
            continue
        contesta = 0
        acierta = 0
        suma_confianza_cuando_acierta = 0.0
        t0 = time.time()
        for foto in fotos:
            ruta = os.path.join(carpeta, foto["fichero"])
            etiqueta_id, confianza, _, _ = motor.responder(a, ruta)
            if etiqueta_id is None or confianza < a.get("umbral", 0.5) or etiqueta_id == "indeterminado":
                continue
            contesta += 1
            esperado = foto.get("verdad", {}).get(a["id"]) or _opcion_correcta_por_pais(a, foto.get("pais", ""))
            if esperado is None:
                continue
            if etiqueta_id == esperado:
                acierta += 1
                suma_confianza_cuando_acierta += confianza
        coste = (time.time() - t0) / len(fotos)
        cobertura = contesta / len(fotos)
        acierto = acierta / contesta if contesta else 0.0
        calibracion = (suma_confianza_cuando_acierta / acierta) if acierta else None
        ok = acierto >= ACIERTO_MINIMO and cobertura >= COBERTURA_MINIMA
        filas.append((a["id"], acierto, cobertura, calibracion, coste, ok))

    print("\n%-16s  %8s  %10s  %11s  %8s  %s" % ("agente", "acierto", "cobertura", "calibración", "s/foto", "veredicto"))
    for id_, acierto, cobertura, calibracion, coste, ok in filas:
        cal = "%.2f" % calibracion if calibracion is not None else "n/d"
        marca = "✓ activo" if ok else "✗ por debajo del mínimo"
        print("%-16s  %7.0f%%  %9.0f%%  %11s  %7.1fs  %s" % (id_, acierto * 100, cobertura * 100, cal, coste, marca))
    return 0


def _hay_cuda():
    try:
        import torch
        return torch.cuda.is_available()
    except Exception:
        return False


def main():
    if len(sys.argv) != 2:
        print(__doc__, file=sys.stderr)
        sys.exit(2)
    sys.exit(evaluar(sys.argv[1]))


if __name__ == "__main__":
    main()
