#!/usr/bin/env python3
"""Trabajador de verificacion geometrica (subsistema 5b).

Recibe una imagen de consulta y una lista de candidatos con su ruta, y contesta
UNA LINEA POR (candidato, verificador) con cuantas correspondencias sobreviven
a RANSAC. No decide nada: quien arbitra es el daemon, en Rust, porque el
arbitraje es logica pura y esta probada alli.

Protocolo: una linea de JSON por mensaje, igual que los demas trabajadores. El
log va por stderr y no tiene contrato.
"""
import contextlib
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


@contextlib.contextmanager
def _sin_descargas(mapa_urls):
    """LightGlue (`features="aliked"`) y ALIKED llaman los dos, sin
    excepcion y sin ningun parametro para evitarlo, a
    `torch.hub.load_state_dict_from_url` con una URL fija -- ninguno de los
    dos acepta por su API publica un fichero ya verificado en disco. Se
    sustituye esa función durante la construcción para que devuelva los
    pesos que este registro ya verificó por sha256, y se restaura al salir
    -- igual de estricto que el resto del proyecto sobre "sin sha256/licencia
    no se carga", solo que aquí hay que interceptar la descarga en vez de
    evitarla desde fuera."""
    import torch.hub

    original = torch.hub.load_state_dict_from_url

    def _interceptado(url, *args, **kwargs):
        for prefijo, contenido in mapa_urls.items():
            if url.startswith(prefijo):
                return contenido
        raise RuntimeError(f"descarga no verificada bloqueada: {url}")

    torch.hub.load_state_dict_from_url = _interceptado
    try:
        yield
    finally:
        torch.hub.load_state_dict_from_url = original


def _pesos_de(verificador_id):
    """Carga (con licencia + sha256 verificados) el fichero de un
    verificador que vive en su PROPIA entrada de registro -- el patrón que
    usan `roma` (necesita "dinov2-vitl14" aparte) y `lightglue-aliked"
    (necesita "aliked-n16" aparte) para su segundo fichero, en vez de
    inventar un segundo campo en la ficha del verificador principal."""
    import torch
    import lumi_pesos

    ficha = lumi_pesos._ficha(verificador_id, REGISTRO)
    directorio = os.path.join(PESOS, verificador_id)
    ruta = os.path.join(directorio, "pesos.pth")
    lumi_pesos._licencia(directorio)
    lumi_pesos._verificar(ruta, ficha.get("sha256", ""))
    return torch.load(ruta, map_location=DISPOSITIVO, weights_only=True)


def _construir(verificador, pesos):
    """Un state_dict crudo no dice qué arquitectura reconstruir por sí solo —
    misma razón que `lumi_pesos._reconstruir` para el embebedor.

    `tiny_roma_v1_outdoor(xfeat=None)` deja que XFeat lo traiga ELLA por
    dentro con `torch.hub.load(..., trust_repo="check")` -- que sin una
    terminal donde contestar "sí, confío en este repo" no pregunta, revienta
    con `EOFError: EOF when reading a line` en el instante (stdin ya viene
    cerrado, `verificar::afinar` lo cierra nada más mandar el trabajo). Por
    eso una verificación "funcionaba" en un segundo sin verificar nada: el
    proceso moría antes de tocar una sola imagen. Cargar XFeat aquí con
    `trust_repo=True` explícito y pasarlo ya resuelto evita que `romatch`
    llegue a hacer esa llamada sin confirmar."""
    import romatch
    import torch

    if verificador == "tiny-roma":
        xfeat = torch.hub.load(
            "verlab/accelerated_features", "XFeat", pretrained=True, top_k=4096, trust_repo=True,
        ).net
        return romatch.tiny_roma_v1_outdoor(device=DISPOSITIVO, weights=pesos, xfeat=xfeat)
    if verificador == "roma":
        # roma_outdoor (a diferencia de tiny_roma_v1_outdoor) necesita DOS
        # state_dicts crudos: el matcher (`pesos`, ya resuelto por _cargar
        # como cualquier otro verificador) y el backbone DINOv2 completo,
        # que aquí SÍ viene de su propia entrada de registro
        # ("dinov2-vitl14") en vez de un torch.hub.load_state_dict_from_url
        # sin verificar dentro de romatch. Exige además matmul en precisión
        # "highest" o revienta con RuntimeError -- se fija aquí, no
        # globalmente al importar, para no afectar a otros verificadores
        # que puedan cargarse en el mismo proceso.
        torch.set_float32_matmul_precision("highest")
        dinov2_weights = _pesos_de("dinov2-vitl14")
        return romatch.roma_outdoor(device=DISPOSITIVO, weights=pesos, dinov2_weights=dinov2_weights)
    if verificador == "lightglue-aliked":
        # LightGlue+ALIKED es un pipeline disperso (keypoints + emparejador),
        # no un flujo denso como RoMa -- necesita DOS redes distintas, no
        # una, así que aquí se devuelve una tupla en vez de un solo módulo;
        # `_inliers` más abajo distingue por tipo, no por una tabla aparte.
        from lightglue import LightGlue
        from lightglue.aliked import ALIKED

        pesos_aliked = _pesos_de("aliked-n16")
        mapa = {
            "https://github.com/Shiaoming/ALIKED/raw/main/models/": pesos_aliked,
            "https://github.com/cvg/LightGlue/releases/download/": pesos,
        }
        with _sin_descargas(mapa):
            extractor = ALIKED(model_name="aliked-n16", max_num_keypoints=4096).eval().to(DISPOSITIVO)
            matcher = LightGlue(features="aliked").eval().to(DISPOSITIVO)
        return (extractor, matcher)
    raise ValueError(
        f"{verificador} no tiene una arquitectura conocida para reconstruir su state_dict "
        "-- hace falta añadir su caso en _construir(), igual que tiny-roma"
    )


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
    # Publicado como state_dict crudo, no como módulo entero: por eso
    # `weights_only=True` sí puede leerlo directamente (es un contenedor
    # básico de tensores, nada de pickling arbitrario) y por qué hace falta
    # `_construir` -- cargarlo tal cual y llamar `.eval()` fallaba con
    # "'collections.OrderedDict' object has no attribute 'eval'".
    pesos = torch.load(ruta, map_location=DISPOSITIVO, weights_only=True)
    m = _construir(verificador, pesos)
    # lightglue-aliked devuelve (extractor, matcher) en vez de un solo
    # módulo -- cada uno ya sale de _construir en modo eval, así que aquí
    # basta con no llamar .eval() sobre la tupla misma.
    if not isinstance(m, tuple):
        m.eval()
    _cargados[verificador] = m
    _decir({"tipo": "listo", "dispositivo": DISPOSITIVO, "modelo": verificador})
    return m


#: Lado más largo al que se reescala cada imagen antes de verificar. tiny-roma
#: monta una correlación densa O((alto·ancho)²) sobre el mapa de rasgos de
#: XFeat -- a resolución de cámara real (varios megapíxeles) eso pide decenas
#: de GB de VRAM en una GPU de 12 GB, y bajo WSL2 ese OOM no siempre es
#: limpio: puede colgar el driver entero y con él la máquina, que es justo lo
#: que pasó al reintentar tras arreglar el prompt de confianza de XFeat. Los
#: propios `assets/*.jpg` de demo del proyecto (`Parskatt/RoMa`) son VGA,
#: 640×480 -- se replica esa escala aquí, no una intuida.
LADO_MAX = 640


def _redimensionar(ruta):
    from PIL import Image

    img = Image.open(ruta).convert("RGB")
    ancho, alto = img.size
    escala = LADO_MAX / max(ancho, alto)
    if escala < 1:
        img = img.resize((max(1, round(ancho * escala)), max(1, round(alto * escala))), Image.LANCZOS)
    return img


def _inliers(matcher, consulta, candidato):
    """Correspondencias que sobreviven a RANSAC sobre la matriz fundamental.
    Es la unica senal del arbitraje, y por eso es lo unico que se devuelve.

    `matcher.match()` no da puntos sueltos: da un campo de flujo denso
    (`warp`) más una `certainty` por pixel -- `sample()` es lo que reduce eso
    a un puñado de correspondencias, y `to_pixel_coordinates()` las pasa de
    coordenadas normalizadas [-1,1] a píxeles reales de cada imagen. Mismo
    patrón que el propio `demo_fundamental.py` del proyecto.

    Verifica sobre las imágenes YA reescaladas (`_redimensionar`), no las
    originales: el conteo de inliers no depende de en qué escala se midió,
    solo de cuántas correspondencias sobreviven a RANSAC.

    `cv2.FM_RANSAC` con umbral 3.0px y confianza 0.99 (lo que había antes) NO
    discrimina nada aquí: comprobado contra los propios pares de control de
    `Parskatt/RoMa` (misma escena Sacre Coeur A/B → 3394 inliers) frente a
    pares de escenas DISTINTAS del mismo repo (Sacre Coeur vs Toronto → 586)
    -- de sobra por encima de cualquier umbral razonable, porque un flujo
    denso es localmente suave incluso entre fotos que no se corresponden, y
    con miles de puntos muestreados RANSAC casi siempre encuentra una F que
    "explica" la mayoría. `USAC_MAGSAC` con el umbral/confianza/iteraciones
    que usa el propio `demo_fundamental.py` del proyecto separa mucho mejor
    (mismos pares: 652 y 139 en positivos, 84-123 en negativos) -- la
    calibración de verdad, con pares reales del corpus, vive en
    `lumi_index::arbitro::UMBRAL_INLIERS`, no aquí: ese número puede cambiar
    sin tocar este fichero."""
    import cv2
    import numpy as np
    import torch

    img_a, img_b = _redimensionar(consulta), _redimensionar(candidato)
    ancho_a, alto_a = img_a.size
    ancho_b, alto_b = img_b.size
    with torch.inference_mode():
        warp, certeza = matcher.match(img_a, img_b)
        parejas, _ = matcher.sample(warp, certeza)
        if len(parejas) < 8:
            # Por debajo de ocho puntos la matriz fundamental no se puede
            # estimar: no es «pocas correspondencias», es «ninguna respuesta».
            return 0
        kpts_a, kpts_b = matcher.to_pixel_coordinates(parejas, alto_a, ancho_a, alto_b, ancho_b)
        kpts_a, kpts_b = kpts_a.cpu().numpy(), kpts_b.cpu().numpy()
    _, mascara = cv2.findFundamentalMat(
        kpts_a, kpts_b, method=cv2.USAC_MAGSAC, ransacReprojThreshold=0.2, confidence=0.999999, maxIters=10000,
    )
    return int(np.sum(mascara)) if mascara is not None else 0


def _inliers_disperso(envoltorio, consulta, candidato):
    """LightGlue+ALIKED es disperso, no denso: no hay `warp`+`certainty` que
    muestrear (esa API es exclusiva de RoMa/tiny-roma). Se extraen keypoints
    de cada imagen por separado con ALIKED y se emparejan con LightGlue --
    `match_pair()` (el propio helper de `lightglue.utils`) hace ambos pasos
    y ya filtra por `filter_threshold` antes de devolver las correspondencias.
    Los puntos emparejados van al mismo `cv2.findFundamentalMat` con el
    mismo umbral/confianza/iteraciones que `_inliers` calibró para RoMa --
    RANSAC no tiene por qué discriminar distinto según de dónde vinieron las
    correspondencias."""
    import cv2
    import numpy as np
    import torch
    from lightglue.utils import match_pair, numpy_image_to_torch

    extractor, matcher = envoltorio
    img_a, img_b = _redimensionar(consulta), _redimensionar(candidato)
    tensor_a = numpy_image_to_torch(np.array(img_a))
    tensor_b = numpy_image_to_torch(np.array(img_b))

    with torch.inference_mode():
        feats_a, feats_b, matches01 = match_pair(extractor, matcher, tensor_a, tensor_b, device=DISPOSITIVO)
        parejas = matches01["matches"]
        if len(parejas) < 8:
            return 0
        kpts_a = feats_a["keypoints"][parejas[:, 0]].cpu().numpy()
        kpts_b = feats_b["keypoints"][parejas[:, 1]].cpu().numpy()
    _, mascara = cv2.findFundamentalMat(
        kpts_a, kpts_b, method=cv2.USAC_MAGSAC, ransacReprojThreshold=0.2, confidence=0.999999, maxIters=10000,
    )
    return int(np.sum(mascara)) if mascara is not None else 0


def _verificar(job):
    fuera = []
    consulta = job["consulta"]
    for cand in job["candidatos"]:
        for verificador in job["verificadores"]:
            try:
                m = _cargar(verificador)
                # _construir devuelve una tupla (extractor, matcher) solo
                # para el caso disperso (lightglue-aliked) -- ningún otro
                # verificador hoy o en el futuro cercano necesita dos redes,
                # así que el tipo de `m` ya basta como señal, sin una tabla
                # de despacho aparte.
                n = _inliers_disperso(m, consulta, cand["ruta"]) if isinstance(m, tuple) \
                    else _inliers(m, consulta, cand["ruta"])
            except Exception as e:
                _log("verificador %s sobre %s: %s" % (verificador, cand["id"], e))
                continue
            finally:
                # Con `inference_mode` cada tensor se libera solo al salir de
                # `_inliers`, pero en una tanda de una docena de candidatos
                # seguidos la fragmentación de VRAM se acumula igual -- esto
                # la devuelve al asignador de CUDA entre uno y otro, no solo
                # al final del proceso.
                try:
                    import torch
                    if torch.cuda.is_available():
                        torch.cuda.empty_cache()
                except ImportError:
                    pass
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
