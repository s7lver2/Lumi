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

La comprobacion de LICENCIA.txt es la de `lumi_pesos`, sin excepcion: una
regla que solo se aplica al peso incomodo se olvida el dia que entra el
siguiente. Qwen3-VL y Depth Anything V2 Small son un repositorio ENTERO de
HuggingFace, no un fichero sha256'd a mano (se instalan con
huggingface_hub.snapshot_download, ver workers/lumi_bajar.py) -- la
integridad de cada fichero la verifica el propio hub, no un sha256 propio de
este proyecto.
"""
import base64
import io
import json
import os
import re

from lumi_pesos import _licencia

#: Confianza fija para una sub-respuesta de un agente fusionado (spec
#: 2026-09-10 §1, `Vlm.responder_fusionado`). No sale de un softmax como
#: `responder()`: eso exigiría puntuar cada etiqueta de cada sub-pregunta por
#: separado, justo la N-llamadas que la fusión existe para evitar. Se fija
#: POR ENCIMA de todos los `umbral_confianza` que hoy usan las sub-preguntas
#: fusionadas (0.5-0.8, ver `registros/agentes/*.json`) para que la señal que
#: manda sea "el modelo respetó el conjunto cerrado ofrecido" y no un número
#: que además tenga que decidir abstención. ponytail: si algún día hace falta
#: una confianza graduada por sub-pregunta, la vía es puntuar cada una sobre
#: el mismo texto ya generado (sin repetir la llamada de generación), no
#: cambiar esta constante.
CONFIANZA_FUSIONADO = 0.9


def _json_de(texto):
    """El primer objeto JSON balanceado dentro de `texto` -- un VLM que
    generó markdown alrededor (```json ... ```) o una frase antes/después no
    debería tirar todo el resultado. `None` si no hay ninguno o no parsea:
    ausencia, no un JSON inventado."""
    inicio = texto.find("{")
    fin = texto.rfind("}")
    if inicio == -1 or fin == -1 or fin < inicio:
        return None
    try:
        return json.loads(texto[inicio:fin + 1])
    except ValueError:
        return None

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


class Vlm(object):
    """Qwen3-VL. Contesta eligiendo entre las etiquetas del agente.

    La confianza NO se le pregunta al modelo: se calcula puntuando cada
    etiqueta por la verosimilitud que el propio modelo le da y normalizando con
    softmax. Un modelo que se autoevalua dice «0.9» siempre; esto al menos es
    una medida de algo, y es determinista.

    El softmax YA es una distribucion completa sobre el conjunto cerrado de
    etiquetas -- antes se calculaba entero y se tiraban todas las probabilidades
    menos la ganadora. `responder()` expone la lista ordenada entera como
    `alternativas`: no hay ningun dato nuevo que inventar, solo dejar de
    descartar el que ya salia de aqui. Sin rasgos: no hay interpretabilidad de
    atencion implementada para Qwen3-VL con esta tecnica (puntuar etiquetas),
    y un mapa de atencion fabricado seria peor que ninguno.
    """

    def __init__(self, pesos_dir, dispositivo):
        import torch
        from transformers import AutoModelForImageTextToText, AutoProcessor

        # Sin sha256 propio que comprobar: Qwen3-VL se instala entero con
        # huggingface_hub.snapshot_download (ver workers/lumi_bajar.py), que
        # verifica cada fichero por su cuenta (ETags) -- ese chequeo con
        # _verificar() era el de un unico .safetensors sha256'd a mano, y
        # aqui ademas el checkpoint real viene partido en dos fragmentos
        # (model-00001-of-00002.safetensors, ...00002...), asi que ni
        # siquiera existiria el fichero que ese chequeo esperaba.
        d = _directorio(pesos_dir, "qwen3-vl")
        self.dispositivo = dispositivo
        self.proc = AutoProcessor.from_pretrained(d)
        # `low_cpu_mem_usage=True` + `device_map` (necesitan `accelerate`,
        # ver tasks.rs) cargan el checkpoint mapeado desde el propio fichero
        # safetensors directo al dispositivo destino, en vez de materializar
        # el modelo entero en RAM del sistema (`from_pretrained` + `.to()`
        # normal) antes de copiarlo a la GPU -- con un checkpoint de 8GB+ y
        # una caja donde la RAM de sistema es mas ajustada que la VRAM
        # disponible, esa doble copia era el cuello de botella real detras
        # de cargas en frio que se pasaban de largo del timeout de
        # `agentar::LIMITE_STANDALONE` (240s) sin que la GPU tuviera nada
        # que ver.
        self.red = AutoModelForImageTextToText.from_pretrained(
            d, dtype=torch.float16 if dispositivo != "cpu" else torch.float32,
            low_cpu_mem_usage=True, device_map=dispositivo)
        self.red.eval()

    def responder(self, agente, ruta_imagen):
        import torch
        from PIL import Image

        etiquetas = agente.get("etiquetas") or []
        if not etiquetas:
            return (None, 0.0, "", [], None)
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
        alternativas = sorted(zip(etiquetas, probs), key=lambda par: -par[1])
        return (etiquetas[i], probs[i], "", alternativas, None)

    def responder_fusionado(self, agente, ruta_imagen):
        """Un agente fusionado (`sub_preguntas` no vacío, spec 2026-09-10 §1):
        UNA sola llamada de generación con `agente["pregunta"]` (que ya pide
        el JSON compuesto, ver `registros/agentes/*.json`), en vez de las N
        llamadas de puntuación que haría `responder()` una vez por
        sub-pregunta. Devuelve una lista `(sub_id, etiqueta, confianza,
        detalle, alternativas, rasgos)` -- vacía la sub-pregunta cuyo valor
        no vino en el JSON o no está en su conjunto cerrado de etiquetas: es
        una abstención, igual que ya lo es un agente suelto por debajo de su
        umbral, nunca un valor inventado."""
        import torch
        from PIL import Image

        subs = agente.get("sub_preguntas") or []
        if not subs:
            return []
        img = Image.open(ruta_imagen).convert("RGB")
        mensajes = [{"role": "user", "content": [
            {"type": "image"},
            {"type": "text", "text": agente["pregunta"]},
        ]}]
        texto = self.proc.apply_chat_template(mensajes, add_generation_prompt=True)
        entrada = self.proc(text=[texto], images=[img], return_tensors="pt")
        entrada = {k: v.to(self.dispositivo) for k, v in entrada.items()}
        with torch.no_grad():
            salida = self.red.generate(**entrada, max_new_tokens=200, do_sample=False)
        generado = self.proc.batch_decode(
            salida[:, entrada["input_ids"].shape[1]:], skip_special_tokens=True)[0]
        datos = _json_de(generado) or {}

        fuera = []
        for s in subs:
            valor = datos.get(s["id"])
            if not isinstance(valor, str) or not valor.strip():
                continue
            valor = valor.strip()
            etiquetas = s.get("etiquetas") or []
            if etiquetas and valor not in etiquetas:
                # El modelo se salió del conjunto cerrado ofrecido: se
                # abstiene esta sub-pregunta, no se adivina la más parecida.
                continue
            fuera.append((s["id"], valor, CONFIANZA_FUSIONADO, "", [], None))
        # El texto generado, TAL CUAL, antes de este mismo parseo -- es lo
        # que espera `lumi_agentes.py` para rellenar `respuesta_cruda` (spec
        # 2026-09-10 §4c) cuando `modo_calibracion` está activo. Se devuelve
        # siempre (barato: ya está en memoria) y es la propia llamada de
        # arriba quien decide si se queda o se descarta con el modo apagado.
        return generado, fuera


class Ocr(object):
    """PaddleOCR. Dos agentes tiran de el y le piden cosas distintas del mismo
    pase: `idioma` quiere la escritura dominante, `toponimos` el texto tal cual.
    """

    def __init__(self, pesos_dir, dispositivo):
        from paddleocr import PaddleOCR

        # ponytail: fijado a PaddleOCR 2.x (`tasks.rs`) a propósito. La 3.x
        # rehizo esta API entera (otro nombre de idioma, otros parámetros de
        # construcción, otro método de inferencia, otro formato de salida) Y
        # además trae un runtime CPU con un fallo propio (`NotImplementedError:
        # ConvertPirAttribute2RuntimeAttribute...`) en la versión probada — no
        # es solo cambiar nombres de argumentos aquí. El día que 3.x sea
        # imprescindible, esto se reescribe entero contra su API nueva.
        _directorio(pesos_dir, "paddleocr")
        self.red = PaddleOCR(use_angle_cls=True, lang="latin", show_log=False,
                             use_gpu=(dispositivo != "cpu"))

    def _lineas(self, ruta_imagen):
        from PIL import Image

        # El ancho/alto hacen falta para normalizar las cajas a fraccion 0-1
        # (`entrada[0]`, las cuatro esquinas del cuadrilatero que PaddleOCR ya
        # calcula y que antes se tiraba sin mirar -- solo se usaba
        # `entrada[1]`, texto+confianza). El cliente dibuja sobre cualquier
        # tamano de render sin conocer las dimensiones originales del
        # fichero.
        ancho, alto = Image.open(ruta_imagen).size
        salida = self.red.ocr(ruta_imagen, cls=True) or []
        fuera = []
        for pagina in salida:
            for entrada in (pagina or []):
                texto, confianza = entrada[1]
                puntos = entrada[0] or []
                caja = None
                if puntos and ancho > 0 and alto > 0:
                    xs = [p[0] for p in puntos]
                    ys = [p[1] for p in puntos]
                    x0, x1 = min(xs) / ancho, max(xs) / ancho
                    y0, y1 = min(ys) / alto, max(ys) / alto
                    caja = (x0, y0, x1 - x0, y1 - y0)
                fuera.append((texto, float(confianza), caja))
        return fuera

    def _escritura_de(self, texto):
        """La escritura dominante de UNA linea, con la misma aritmetica de
        rangos Unicode que agrega `responder()` para el veredicto entero --
        aqui sirve para etiquetar cada caja con su propio texto, no con la
        etiqueta ganadora global (que podria no ser la de esa linea en
        concreto)."""
        cuenta = {}
        for ch in texto:
            punto = ord(ch)
            for nombre, (lo, hi) in ESCRITURAS:
                if lo <= punto <= hi:
                    cuenta[nombre] = cuenta.get(nombre, 0) + 1
                    break
        return max(cuenta, key=lambda k: cuenta[k]) if cuenta else None

    def _rasgos_de(self, lineas, etiquetador):
        """Cajas reales para el veredicto, o `None` si no hay ninguna con
        posicion conocida. `etiquetador(texto)` decide la etiqueta que lleva
        cada caja -- distinta para el texto libre (el texto mismo) que para
        las etiquetas cerradas (la escritura de esa linea)."""
        cajas = []
        for texto, _, caja in lineas:
            if not caja or not texto.strip():
                continue
            x, y, w, h = caja
            etq = etiquetador(texto)
            if not etq:
                continue
            cajas.append({"x": x, "y": y, "w": w, "h": h, "etiqueta": etq})
        if not cajas:
            return None
        return {"tipo": "ocr", "cajas": cajas}

    def _responder_toponimos(self, lineas):
        # Descriptivo: el texto entero, sin interpretar. Un nombre de calle
        # legible vale mas que cualquier etiqueta que le pusieramos. Sin
        # distribucion genuina que ofrecer (texto libre, no un conjunto
        # cerrado) -- `alternativas` se queda vacia a proposito.
        textos = [t for t, _, _ in lineas if t.strip()]
        texto = " · ".join(textos)
        if not texto:
            return (None, 0.0, "", [], None)
        media = sum(c for _, c, _ in lineas) / len(lineas)
        rasgos = self._rasgos_de(lineas, lambda t: t[:40])
        return ("hay texto legible", media, texto[:400], [], rasgos)

    def _responder_idioma(self, lineas):
        cuenta = {}
        total = 0
        for texto, confianza, _ in lineas:
            for ch in texto:
                punto = ord(ch)
                for nombre, (lo, hi) in ESCRITURAS:
                    if lo <= punto <= hi:
                        cuenta[nombre] = cuenta.get(nombre, 0.0) + confianza
                        total += 1
                        break
        if not cuenta or total < 4:
            # Menos de cuatro caracteres no es un cartel, es ruido.
            return ("sin texto", 0.0, "", [], None)
        suma = sum(cuenta.values())
        nombre = max(cuenta, key=lambda k: cuenta[k])
        confianza = cuenta[nombre] / suma
        # La misma proporcion por escritura que decide la ganadora, expuesta
        # entera: es una distribucion real (proporcion de caracteres por
        # escritura), no una inventada para rellenar la lista.
        alternativas = sorted(
            ((k, v / suma) for k, v in cuenta.items()), key=lambda par: -par[1])
        muestra = " · ".join(t for t, _, _ in lineas if t.strip())[:200]
        rasgos = self._rasgos_de(lineas, self._escritura_de)
        return (nombre, confianza, muestra, alternativas, rasgos)

    def responder(self, agente, ruta_imagen):
        lineas = self._lineas(ruta_imagen)
        if agente["id"] == "toponimos":
            return self._responder_toponimos(lineas)
        return self._responder_idioma(lineas)

    def responder_fusionado(self, agente, ruta_imagen):
        """`texto-en-escena` fusiona `idioma` + `toponimos` (spec 2026-09-10
        §1), y los dos ya salían del MISMO pase de PaddleOCR (docstring de la
        clase) -- antes `lumi_agentes.py` llamaba a `responder()` dos veces
        para dos agentes sueltos, repitiendo el OCR entero. Aquí se corre una
        vez y se reparte."""
        subs = agente.get("sub_preguntas") or []
        if not subs:
            return []
        lineas = self._lineas(ruta_imagen)
        fuera = []
        for s in subs:
            etiqueta, confianza, detalle, alternativas, rasgos = (
                self._responder_toponimos(lineas) if s["id"] == "toponimos"
                else self._responder_idioma(lineas)
            )
            if not etiqueta:
                continue
            fuera.append((s["id"], etiqueta, confianza, detalle, alternativas, rasgos))
        # Sin un "texto crudo" único que devolver (dos sub-preguntas, cada
        # una con su propia interpretación de las mismas líneas de OCR) --
        # `None` aquí, a diferencia de `Vlm.responder_fusionado`: ausencia
        # deliberada y no un texto a medias inventado para rellenar el campo.
        return None, fuera


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

        # Mismo caso que Vlm.__init__: se instala entero con
        # huggingface_hub.snapshot_download, que verifica cada fichero por
        # su cuenta -- no hay un sha256.txt propio que este proyecto escriba
        # para un motor de hf_repo, así que ese chequeo era el candidato
        # perfecto para reventar con "el registro no trae sha256" en vez de
        # cargar nada.
        d = _directorio(pesos_dir, "depth-anything-v2-small")
        self.dispositivo = dispositivo
        self.proc = AutoImageProcessor.from_pretrained(d)
        # Mismo criterio que ya usa `Vlm.__init__` (`dtype`, `low_cpu_mem_usage`
        # + `device_map`): un modelo bastante más pequeño, pero misma
        # asimetría a evitar entre cómo cargan los distintos motores.
        self.red = AutoModelForDepthEstimation.from_pretrained(
            d, dtype=torch.float16 if dispositivo != "cpu" else torch.float32,
            low_cpu_mem_usage=True, device_map=dispositivo)
        self.red.eval()

    def _mapa_de_calor(self, mapa):
        """El mismo tensor `mapa` que ya calculo `responder()`, reescalado a
        0-255 y codificado en PNG -- no se repite ninguna inferencia, solo se
        deja de tirar el mapa entero despues de reducirlo a medias de franja.
        Escala de grises y no una paleta de color: es la distincion mas
        simple que sigue siendo un dato real, sin inventar una paleta que
        alguien podria leer como si tuviera un significado calibrado."""
        import numpy as np
        from PIL import Image

        arr = mapa.detach().to("cpu").float().numpy()
        rango = float(arr.max() - arr.min()) or 1.0
        normalizado = ((arr - arr.min()) / rango * 255.0).astype(np.uint8)
        buf = io.BytesIO()
        Image.fromarray(normalizado, mode="L").save(buf, format="PNG")
        return base64.b64encode(buf.getvalue()).decode("ascii")

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

        # Sigue siendo un arbol de reglas con confianza fija por rama -- no
        # hay una distribucion genuina que exponer como `alternativas`, asi
        # que se queda vacia a proposito (fuera de alcance del diseno:
        # rehacer esto para que de una distribucion real). El mapa de calor
        # si es un dato real y se adjunta siempre, gane la rama que gane.
        rasgos = {"tipo": "profundidad", "png_base64": self._mapa_de_calor(mapa)}
        if (centro - bordes) / rango > 0.15:
            return ("calle profunda", 0.7, "", [], rasgos)
        if (arriba - abajo) / rango > 0.15:
            return ("espacio abierto", 0.6, "", [], rasgos)
        if ancho > alto:
            return ("fachada ancha y baja", 0.6, "", [], rasgos)
        return ("fachada estrecha y alta", 0.6, "", [], rasgos)


class Upscalador(object):
    """Real-ESRGAN (o equivalente, ver `registros/motores/real-esrgan.json`):
    entra una imagen, sale una versión de mayor resolución generada por un
    modelo real -- nunca una interpolación disfrazada de IA (spec 2026-09-10
    §2, "fuera de alcance"). Mismo patrón de carga bajo demanda que
    `Vlm`/`Profundidad`: se instancia una vez y vive en el mismo caché de
    pesos (`workers/lumi_upscale.py::_motor`), sujeto al mismo desalojo por
    inactividad/presión que ya usan los demás.

    ponytail: sin acceso de red para bajar un peso real en este entorno, el
    `fichero_url`/`sha256` de `real-esrgan.json` se han dejado vacíos a
    propósito -- `_directorio()` (la misma comprobación de LICENCIA.txt que
    usan todos los motores de aquí, sin excepción) hace que instanciar esta
    clase falle con un motivo legible ("sin LICENCIA.txt") hasta que alguien
    rellene esos campos y baje el peso de verdad. Es el mismo criterio que
    "nunca se inventa": preferible que el trabajo falle explícito a que
    devuelva una imagen que no mejoró nada."""

    def __init__(self, pesos_dir, dispositivo):
        import torch

        d = _directorio(pesos_dir, "real-esrgan")
        self.dispositivo = dispositivo
        self.dir = d
        # La carga real del checkpoint (arquitectura RRDBNet + pesos) es
        # deliberadamente la última línea, no la primera: todo lo de arriba
        # (comprobación de licencia, resolución de dispositivo) debe fallar
        # primero y con un motivo claro si el peso no está, en vez de un
        # `FileNotFoundError` genérico de `torch.load` a medio construir el
        # objeto.
        import glob
        pesos = glob.glob(os.path.join(d, "*.pth")) + glob.glob(os.path.join(d, "*.safetensors"))
        if not pesos:
            raise RuntimeError(
                "sin peso instalado para real-esrgan -- rellena fichero_url/sha256 en "
                "registros/motores/real-esrgan.json y descárgalo antes de activar upscaler_activo")
        self._ruta_peso = pesos[0]
        self._torch = torch

    def procesar(self, ruta_entrada, ruta_salida):
        """Escala `ruta_entrada` x4 y escribe el resultado en `ruta_salida`.
        No hay aquí ninguna arquitectura de red cargada de verdad (ver el
        docstring de la clase): esto es la superficie que `lumi_upscale.py`
        llama, lista para conectar la inferencia real de RRDBNet en cuanto
        el peso exista en disco."""
        raise RuntimeError("real-esrgan sin peso real instalado -- ver docstring de Upscalador")


CLASES = {"vlm": Vlm, "ocr": Ocr, "profundidad": Profundidad, "upscalador": Upscalador}


def cargar_motor(clase, pesos_dir, dispositivo):
    if clase not in CLASES:
        raise ValueError("no hay motor «%s»" % clase)
    return CLASES[clase](pesos_dir, dispositivo)
