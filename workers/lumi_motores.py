#!/usr/bin/env python3
"""Los motores de inferencia que no son de recuperación/verificación.

Licencias, comprobadas antes de entrar y permisivas por decisión de producto
(ver la spec del 5b: si no permite uso comercial, no entra):

  - Real-ESRGAN       BSD-3-Clause

La comprobacion de LICENCIA.txt es la de `lumi_pesos`, sin excepcion.
"""
import os

from lumi_pesos import _licencia


def _directorio(pesos_dir, nombre):
    d = os.path.join(pesos_dir, nombre)
    _licencia(d)
    return d


class Upscalador(object):
    """Real-ESRGAN (o equivalente, ver `registros/motores/real-esrgan.json`):
    entra una imagen, sale una versión de mayor resolución generada por un
    modelo real. Carga bajo demanda (`workers/lumi_upscale.py::_motor`),
    sujeto al mismo desalojo por inactividad/presión que el resto de motores.

    ponytail: sin acceso de red para bajar un peso real en este entorno, el
    `fichero_url`/`sha256` de `real-esrgan.json` se han dejado vacíos a
    propósito -- `_directorio()` hace que instanciar esta clase falle con un
    motivo legible ("sin LICENCIA.txt") hasta que alguien rellene esos campos
    y baje el peso de verdad."""

    def __init__(self, pesos_dir, dispositivo, motor_id):
        d = _directorio(pesos_dir, motor_id)
        self.dispositivo = dispositivo
        self.dir = d
        import glob
        pesos = glob.glob(os.path.join(d, "*.pth")) + glob.glob(os.path.join(d, "*.safetensors"))
        if not pesos:
            raise RuntimeError(
                "sin peso instalado para real-esrgan -- rellena fichero_url/sha256 en "
                "registros/motores/real-esrgan.json y descárgalo antes de activar upscaler_activo")
        self._ruta_peso = pesos[0]

    def procesar(self, ruta_entrada, ruta_salida):
        raise RuntimeError("real-esrgan sin peso real instalado -- ver docstring de Upscalador")


CLASES = {"upscalador": Upscalador}


def cargar_motor(clase, motor_id, pesos_dir, dispositivo, cuantizacion=None):
    if clase not in CLASES:
        raise ValueError("no hay motor «%s»" % clase)
    return CLASES[clase](pesos_dir, dispositivo, motor_id)
