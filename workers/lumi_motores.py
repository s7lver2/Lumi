#!/usr/bin/env python3
"""Los motores que atienden a los agentes.

Un único VLM (Qwen3-VL) contesta las preguntas de elección cerrada Y las de
transcripción libre -- desde el rediseño de 2026-09-17, PaddleOCR y Depth
Anything V2 salen del catálogo (spec 2026-09-17 §6): el propio VLM lee texto
igual de bien y la "forma del espacio" nunca dio una señal geográfica real
sin escala métrica conocida.

Licencias, todas comprobadas antes de entrar y todas permisivas por decision
de producto (ver la spec del 5b: si no permite uso comercial, no entra):

  - Qwen3-VL          Apache-2.0
  - Real-ESRGAN       BSD-3-Clause (no es un motor de agentes, ver Upscalador)

La comprobacion de LICENCIA.txt es la de `lumi_pesos`, sin excepcion. Qwen3-VL
es un repositorio ENTERO de HuggingFace, no un fichero sha256'd a mano (se
instala con huggingface_hub.snapshot_download, ver workers/lumi_bajar.py) --
la integridad de cada fichero la verifica el propio hub, no un sha256 propio
de este proyecto.
"""
import os

from lumi_pesos import _licencia


def _directorio(pesos_dir, nombre):
    d = os.path.join(pesos_dir, nombre)
    _licencia(d)
    return d


class Vlm(object):
    """Qwen3-VL. Dos modos, decididos por `agente["modo"]` -- nunca por el id
    del agente, ver spec 2026-09-17 §2 ("el motor no contiene ni un solo `if`
    sobre el id de un agente"):

    - `"eleccion"`: la confianza sale de contrastar, por cada opción, la
      verosimilitud de su verbalizador CON la imagen frente a SIN ella --
      spec §3. Un modelo que dice "por la derecha" con la misma probabilidad
      mirando la foto que a ciegas no está aportando conocimiento, y eso es
      justo lo que antes producía respuestas seguras y falsas (puntuar solo
      con la imagen, sin la resta).
    - `"transcripcion"`: generación normal, sin número de confianza -- no hay
      conjunto cerrado sobre el que normalizar (spec §5).
    """

    def __init__(self, pesos_dir, dispositivo, motor_id, cuantizacion=None):
        import torch
        from transformers import AutoModelForImageTextToText, AutoProcessor

        d = _directorio(pesos_dir, motor_id)
        self.dispositivo = dispositivo
        self.proc = AutoProcessor.from_pretrained(d)
        kwargs = dict(low_cpu_mem_usage=True, device_map=dispositivo)
        if cuantizacion == "4bit" and dispositivo != "cpu":
            from transformers import BitsAndBytesConfig
            # 4 bits es lo que hace caber el 8B (spec 2026-09-17 §6: ~5.5GB
            # frente a los ~8GB del 4B en fp16) en los 12GB de una RTX 4070
            # SUPER con margen -- margen que hace falta porque leer carteles
            # obliga a subir la resolución de imagen de entrada, que infla
            # los tokens de imagen por pase.
            kwargs["quantization_config"] = BitsAndBytesConfig(
                load_in_4bit=True, bnb_4bit_compute_dtype=torch.float16)
        else:
            kwargs["dtype"] = torch.float16 if dispositivo != "cpu" else torch.float32
        self.red = AutoModelForImageTextToText.from_pretrained(d, **kwargs)
        self.red.eval()

    def _plantilla(self, pregunta, con_imagen):
        contenido = [{"type": "text", "text": pregunta}]
        if con_imagen:
            contenido.insert(0, {"type": "image"})
        mensajes = [{"role": "user", "content": contenido}]
        return self.proc.apply_chat_template(mensajes, add_generation_prompt=True)

    def _log_verosimilitud(self, texto_prompt, verbalizador, img):
        """Suma (NO media) de log-verosimilitud de los tokens del propio
        `verbalizador` bajo `texto_prompt` -- spec 2026-09-17 §3: "nunca una
        media sobre la secuencia entera". Se enmascara el prefijo con `-100`
        (que la pérdida de HF ignora) para que ni la plantilla de chat ni los
        tokens de imagen ni la pregunta entren en la cuenta -- es el mismo
        arreglo que ya funcionaba en `_puntuar_subrespuesta` del diseño
        anterior, aquí generalizado al camino normal. `img` es `None` para la
        pasada sin imagen."""
        import torch

        if img is not None:
            entrada_prefijo = self.proc(text=[texto_prompt], images=[img], return_tensors="pt")
            entrada = self.proc(text=[texto_prompt + verbalizador], images=[img], return_tensors="pt")
        else:
            entrada_prefijo = self.proc(text=[texto_prompt], return_tensors="pt")
            entrada = self.proc(text=[texto_prompt + verbalizador], return_tensors="pt")
        n_prefijo = entrada_prefijo["input_ids"].shape[1]
        n_verbalizador = entrada["input_ids"].shape[1] - n_prefijo
        if n_verbalizador <= 0:
            return 0.0
        entrada = {k: v.to(self.dispositivo) for k, v in entrada.items()}
        labels = entrada["input_ids"].clone()
        labels[:, :n_prefijo] = -100
        with torch.no_grad():
            salida = self.red(**entrada, labels=labels)
        # `loss` de HF es la MEDIA de log-verosimilitud negativa sobre los
        # tokens no enmascarados -- se multiplica de vuelta por su cuenta
        # para obtener la SUMA, que es lo que pide el spec.
        return -float(salida.loss) * n_verbalizador

    def responder(self, agente, ruta_imagen):
        """Modo `eleccion`. Devuelve `(etiqueta_id, confianza, alternativas,
        apoyo_visual)`, o `(None, 0.0, [], None)` si la ficha no trae
        opciones. `apoyo_visual` es la evidencia (con imagen − sin imagen) de
        la opción GANADORA, sin normalizar -- spec §4, la segunda lectura del
        veredicto."""
        import torch
        from PIL import Image

        opciones = agente.get("opciones") or []
        if not opciones:
            return (None, 0.0, [], None)
        img = Image.open(ruta_imagen).convert("RGB")
        pregunta = agente["pregunta"]
        texto_con_imagen = self._plantilla(pregunta, con_imagen=True)
        texto_sin_imagen = self._plantilla(pregunta, con_imagen=False)

        evidencias = []
        for opcion in opciones:
            verbalizador = opcion["verbalizador"]
            con_img = self._log_verosimilitud(texto_con_imagen, verbalizador, img)
            sin_img = self._log_verosimilitud(texto_sin_imagen, verbalizador, None)
            evidencias.append(con_img - sin_img)

        t = torch.tensor(evidencias)
        probs = torch.softmax(t, dim=0).tolist()
        i = max(range(len(probs)), key=lambda k: probs[k])
        alternativas = sorted(
            ((opciones[k]["id"], probs[k]) for k in range(len(opciones))), key=lambda par: -par[1])
        return (opciones[i]["id"], probs[i], alternativas, evidencias[i])

    def transcribir(self, agente, ruta_imagen):
        """Modo `transcripcion`. Generación normal, sin puntuar nada --
        devuelve el texto tal cual, o cadena vacía si el modelo no generó
        nada legible."""
        from PIL import Image

        img = Image.open(ruta_imagen).convert("RGB")
        texto = self._plantilla(agente["pregunta"], con_imagen=True)
        entrada = self.proc(text=[texto], images=[img], return_tensors="pt")
        entrada = {k: v.to(self.dispositivo) for k, v in entrada.items()}
        salida = self.red.generate(**entrada, max_new_tokens=120, do_sample=False)
        generado = self.proc.batch_decode(
            salida[:, entrada["input_ids"].shape[1]:], skip_special_tokens=True)[0].strip()
        return generado


class Upscalador(object):
    """Real-ESRGAN (o equivalente, ver `registros/motores/real-esrgan.json`):
    entra una imagen, sale una versión de mayor resolución generada por un
    modelo real. No es un motor de agentes -- ninguna ficha de
    `registros/agentes/` lo usa -- vive aquí por compartir el mismo patrón de
    carga bajo demanda que `Vlm` (`workers/lumi_upscale.py::_motor`), sujeto
    al mismo desalojo por inactividad/presión.

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


CLASES = {"vlm": Vlm, "upscalador": Upscalador}


def cargar_motor(clase, motor_id, pesos_dir, dispositivo, cuantizacion=None):
    if clase not in CLASES:
        raise ValueError("no hay motor «%s»" % clase)
    if clase == "vlm":
        return Vlm(pesos_dir, dispositivo, motor_id, cuantizacion=cuantizacion)
    return CLASES[clase](pesos_dir, dispositivo, motor_id)
