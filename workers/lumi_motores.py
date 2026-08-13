#!/usr/bin/env python3
"""Los tres motores que atienden a los agentes.

Un VLM compartido para casi todos, OCR para lo que hay que leer, y profundidad
monocular para la forma del espacio. El VLM se carga UNA VEZ y contesta N
preguntas: es lo que hace que «veinte agentes» no sean veinte descargas.

Licencias, todas comprobadas antes de entrar y todas permisivas por decision de
producto (ver la spec del 5b: si no permite uso comercial, no entra):

  - Qwen3-VL          Apache-2.0
  - PaddleOCR         Apache-2.0
  - Depth Anything V2 **Small**  Apache-2.0
    Las variantes Base, Large y Giant son CC-BY-NC-4.0 y NO se usan. Es el
    mismo caso que MASt3R en el 5b: mejor modelo, licencia incompatible.

La comprobacion de hash y de LICENCIA.txt es la de `lumi_pesos`, sin excepcion:
una regla que solo se aplica al peso incomodo se olvida el dia que entra el
siguiente.
"""
import json
import os
import re

from lumi_pesos import _licencia, _verificar

# Rangos Unicode por escritura, en el orden en que se prueban. Se resuelve con
# aritmetica y no con un modelo: que la letra pi sea griega no es una prediccion.
ESCRITURAS = [
    ("cirilico", (0x0400, 0x04FF)),
    ("griego", (0x0370, 0x03FF)),
    ("hebreo", (0x0590, 0x05FF)),
    ("arabe", (0x0600, 0x06FF)),
    ("devanagari", (0x0900, 0x097F)),
    ("tailandes", (0x0E00, 0x0E7F)),
    ("hangul", (0xAC00, 0xD7AF)),
    ("kana", (0x3040, 0x30FF)),
    ("cjk", (0x4E00, 0x9FFF)),
    ("latino", (0x0041, 0x024F)),
]


def _directorio(pesos_dir, nombre):
    d = os.path.join(pesos_dir, nombre)
    _licencia(d)
    return d


def _hash_esperado(pesos_dir, nombre):
    """El sha256 de un motor vive junto a sus pesos, en `sha256.txt`, y no en
    el registro de agentes: un motor lo comparten varios agentes y repetir el
    hash en doce ficheros es doce sitios donde desincronizarse."""
    ruta = os.path.join(pesos_dir, nombre, "sha256.txt")
    if not os.path.exists(ruta):
        return ""
    with open(ruta) as f:
        return f.read().strip()


class Vlm(object):
    """Qwen3-VL. Contesta eligiendo entre las etiquetas del agente.

    La confianza NO se le pregunta al modelo: se calcula puntuando cada
    etiqueta por la verosimilitud que el propio modelo le da y normalizando con
    softmax. Un modelo que se autoevalua dice «0.9» siempre; esto al menos es
    una medida de algo, y es determinista.
    """

    def __init__(self, pesos_dir, dispositivo):
        import torch
        from transformers import AutoModelForImageTextToText, AutoProcessor

        d = _directorio(pesos_dir, "qwen3-vl")
        pesos = os.path.join(d, "model.safetensors")
        if os.path.exists(pesos):
            _verificar(pesos, _hash_esperado(pesos_dir, "qwen3-vl"))
        self.dispositivo = dispositivo
        self.proc = AutoProcessor.from_pretrained(d)
        self.red = AutoModelForImageTextToText.from_pretrained(
            d, torch_dtype=torch.float16 if dispositivo != "cpu" else torch.float32)
        self.red.to(dispositivo)
        self.red.eval()

    def responder(self, agente, ruta_imagen):
        import torch
        from PIL import Image

        etiquetas = agente.get("etiquetas") or []
        if not etiquetas:
            return (None, 0.0, "")
        img = Image.open(ruta_imagen).convert("RGB")
        mensajes = [{"role": "user", "content": [
            {"type": "image"},
            {"type": "text", "text": agente["pregunta"]},
        ]}]
        texto = self.proc.apply_chat_template(mensajes, add_generation_prompt=True)

        puntos = []
        for etiqueta in etiquetas:
            entrada = self.proc(text=[texto + etiqueta], images=[img], return_tensors="pt")
            entrada = {k: v.to(self.dispositivo) for k, v in entrada.items()}
            with torch.no_grad():
                salida = self.red(**entrada, labels=entrada["input_ids"])
            # `loss` es la media de log-verosimilitud negativa: menos es mejor.
            puntos.append(-float(salida.loss))
        t = torch.tensor(puntos)
        probs = torch.softmax(t, dim=0).tolist()
        i = max(range(len(probs)), key=lambda k: probs[k])
        return (etiquetas[i], probs[i], "")


class Ocr(object):
    """PaddleOCR. Dos agentes tiran de el y le piden cosas distintas del mismo
    pase: `idioma` quiere la escritura dominante, `toponimos` el texto tal cual.
    """

    def __init__(self, pesos_dir, dispositivo):
        from paddleocr import PaddleOCR

        _directorio(pesos_dir, "paddleocr")
        self.red = PaddleOCR(use_angle_cls=True, lang="latin", show_log=False,
                             use_gpu=(dispositivo != "cpu"))

    def _lineas(self, ruta_imagen):
        salida = self.red.ocr(ruta_imagen, cls=True) or []
        fuera = []
        for pagina in salida:
            for entrada in (pagina or []):
                texto, confianza = entrada[1]
                fuera.append((texto, float(confianza)))
        return fuera

    def responder(self, agente, ruta_imagen):
        lineas = self._lineas(ruta_imagen)
        if agente["id"] == "toponimos":
            # Descriptivo: el texto entero, sin interpretar. Un nombre de calle
            # legible vale mas que cualquier etiqueta que le pusieramos.
            texto = " · ".join(t for t, _ in lineas if t.strip())
            if not texto:
                return (None, 0.0, "")
            media = sum(c for _, c in lineas) / len(lineas)
            return ("hay texto legible", media, texto[:400])

        cuenta = {}
        total = 0
        for texto, confianza in lineas:
            for ch in texto:
                punto = ord(ch)
                for nombre, (lo, hi) in ESCRITURAS:
                    if lo <= punto <= hi:
                        cuenta[nombre] = cuenta.get(nombre, 0.0) + confianza
                        total += 1
                        break
        if not cuenta or total < 4:
            # Menos de cuatro caracteres no es un cartel, es ruido.
            return ("sin texto", 0.0, "")
        nombre = max(cuenta, key=lambda k: cuenta[k])
        confianza = cuenta[nombre] / sum(cuenta.values())
        muestra = " · ".join(t for t, _ in lineas if t.strip())[:200]
        return (nombre, confianza, muestra)


class Profundidad(object):
    """Depth Anything V2 Small. Da profundidad RELATIVA, no metros.

    ponytail: sin una referencia de escala conocida en la escena, una
    profundidad monocular no se convierte en metros, asi que el agente habla de
    la FORMA del espacio y no de sus dimensiones. La salida, si algun dia hace
    falta el metro, es detectar un objeto de tamano conocido —una puerta, un
    coche— y escalar con el.
    """

    def __init__(self, pesos_dir, dispositivo):
        import torch
        from transformers import AutoImageProcessor, AutoModelForDepthEstimation

        d = _directorio(pesos_dir, "depth-anything-v2-small")
        pesos = os.path.join(d, "model.safetensors")
        if os.path.exists(pesos):
            _verificar(pesos, _hash_esperado(pesos_dir, "depth-anything-v2-small"))
        self.dispositivo = dispositivo
        self.proc = AutoImageProcessor.from_pretrained(d)
        self.red = AutoModelForDepthEstimation.from_pretrained(d)
        self.red.to(dispositivo)
        self.red.eval()

    def responder(self, agente, ruta_imagen):
        import torch
        from PIL import Image

        img = Image.open(ruta_imagen).convert("RGB")
        entrada = self.proc(images=img, return_tensors="pt")
        entrada = {k: v.to(self.dispositivo) for k, v in entrada.items()}
        with torch.no_grad():
            mapa = self.red(**entrada).predicted_depth[0]
        alto, ancho = mapa.shape
        # Tres franjas verticales y tres horizontales bastan para distinguir
        # «calle que se va al fondo» de «pared enfrente».
        centro = float(mapa[alto // 3:2 * alto // 3, ancho // 3:2 * ancho // 3].mean())
        bordes = float(torch.cat([
            mapa[:, :ancho // 3].flatten(), mapa[:, 2 * ancho // 3:].flatten()]).mean())
        arriba = float(mapa[:alto // 3, :].mean())
        abajo = float(mapa[2 * alto // 3:, :].mean())
        rango = float(mapa.max() - mapa.min()) or 1.0

        if (centro - bordes) / rango > 0.15:
            return ("calle profunda", 0.7, "")
        if (arriba - abajo) / rango > 0.15:
            return ("espacio abierto", 0.6, "")
        if ancho > alto:
            return ("fachada ancha y baja", 0.6, "")
        return ("fachada estrecha y alta", 0.6, "")


CLASES = {"vlm": Vlm, "ocr": Ocr, "profundidad": Profundidad}


def cargar_motor(clase, pesos_dir, dispositivo):
    if clase not in CLASES:
        raise ValueError("no hay motor «%s»" % clase)
    return CLASES[clase](pesos_dir, dispositivo)
