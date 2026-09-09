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
import time

DISPOSITIVO = os.environ.get("LUMI_DEVICE", "cpu")
REGISTRO = os.environ.get("LUMI_REGISTRO_VERIF", "registros/verificadores")
PESOS = os.environ.get("LUMI_PESOS", "pesos")
#: Segura por defecto -- activa salvo que se ponga explicitamente a "0", igual
#: criterio que ya usa el proyecto para otros flags. Se lee una sola vez al
#: arrancar el proceso, no en cada job.
LIMPIEZA_PRESION = os.environ.get("LUMI_LIMPIEZA_PRESION", "1") != "0"

_cargados = {}
#: Último uso (`time.time()`) de cada verificador en `_cargados` -- ver
#: `lumi_pesos.purgar_inactivos`, llamado al principio de cada tanda.
_ultimo_uso = {}


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
        # `use_custom_corr=True` (el default de romatch) exige poder hacer
        # `import local_corr` -- una extension CUDA que romatch no trae ni
        # publica en PyPI bajo ese nombre; el paquete mas cercano
        # (`fused-local-corr`) va atado a una version de PyTorch/CUDA que
        # no es la nuestra y arrastra un downgrade al instalarlo (probado a
        # mano: rompe torch 2.14+cu126 -> 2.11+cu13). En su lugar se instala
        # `local-corr-lumi` (kernel Triton propio, mismo contrato que la
        # extension original, compila contra el PyTorch/CUDA que ya haya en
        # el entorno en vez de traer un binario prebuilt) -- ver su propio
        # repo para el porque y las pruebas de correctitud/velocidad.
        # Sin esto, cada candidato de "roma" tardaba varios MINUTOS con el
        # fallback en PyTorch puro que trae romatch
        # (`shitty_native_torch_local_corr`); con el kernel, ~15-18x mas
        # rapido de extremo a extremo (medido: match() real, 27s vs ~8min).
        return romatch.roma_outdoor(
            device=DISPOSITIVO, weights=pesos, dinov2_weights=dinov2_weights, use_custom_corr=True,
        )
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


#: Un verificador que falló una vez (sha256 sin rellenar, licencia sin
#: aceptar, OOM al construirlo...) se reintentaba en CADA candidato de la
#: tanda -- 12 veces, cada una repitiendo el SHA-256 completo del fichero de
#: pesos (puede ser un fichero de varios GB) antes de fallar de nuevo por lo
#: mismo. `None` aquí significa "ya se intentó y no se puede", el mismo trato
#: que ya usa `lumi_agentes._motor` para el mismo problema.
_fallidos = {}


def _cargar(verificador):
    """Los pesos se verifican por sha256 igual que los del embebedor: se
    reutiliza `lumi_pesos._verificar` para no tener dos posturas distintas
    sobre lo mismo."""
    if verificador in _cargados:
        _ultimo_uso[verificador] = time.time()
        return _cargados[verificador]
    if verificador in _fallidos:
        raise _fallidos[verificador]
    try:
        import lumi_pesos
        import torch
        # Compartido con los demás trabajadores -- ver el docstring de
        # `lumi_pesos._limitar_hilos`.
        lumi_pesos._limitar_hilos()

        # Justo antes de pedir memoria para un verificador nuevo, no en cada
        # tanda entera (eso ya lo hace `purgar_inactivos` en `_verificar`).
        for v in lumi_pesos.quizas_purgar_por_presion(_cargados, _ultimo_uso, LIMPIEZA_PRESION):
            _log("verificador %s desalojado por presion de memoria" % v)

        ficha = lumi_pesos._ficha(verificador, REGISTRO)
        directorio = os.path.join(PESOS, verificador)
        ruta = os.path.join(directorio, "pesos.pth")
        lumi_pesos._licencia(directorio)
        lumi_pesos._verificar(ruta, ficha.get("sha256", ""))
        # Publicado como state_dict crudo, no como módulo entero: por eso
        # `weights_only=True` sí puede leerlo directamente (es un contenedor
        # básico de tensores, nada de pickling arbitrario) y por qué hace
        # falta `_construir` -- cargarlo tal cual y llamar `.eval()` fallaba
        # con "'collections.OrderedDict' object has no attribute 'eval'".
        pesos = torch.load(ruta, map_location=DISPOSITIVO, weights_only=True)
        m = _construir(verificador, pesos)
    except Exception as e:
        # Cachear también el fallo: sin esto, un verificador roto se
        # reintentaba una vez por candidato (hasta 12 veces por análisis),
        # cada una desde el SHA-256 completo del fichero de pesos.
        _fallidos[verificador] = e
        raise
    # lightglue-aliked devuelve (extractor, matcher) en vez de un solo
    # módulo -- cada uno ya sale de _construir en modo eval, así que aquí
    # basta con no llamar .eval() sobre la tupla misma.
    if not isinstance(m, tuple):
        m.eval()
    _cargados[verificador] = m
    _ultimo_uso[verificador] = time.time()
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


def _redimensionar(ruta, cache=None):
    """`cache`, cuando se pasa, es el dict de una sola tanda de `_verificar`
    (nunca uno global entre trabajos): la MISMA consulta se abría, convertía
    y reescalaba con LANCZOS una vez por (candidato × verificador) -- 24
    veces en Pro, 48 en Vision, siempre con el mismo resultado exacto porque
    ni la ruta ni `LADO_MAX` cambian dentro de una tanda. Un candidato
    repetido entre `roma` y `lightglue-aliked` también se reaprovecha."""
    if cache is not None and ruta in cache:
        return cache[ruta]
    from PIL import Image

    img = Image.open(ruta).convert("RGB")
    ancho, alto = img.size
    escala = LADO_MAX / max(ancho, alto)
    if escala < 1:
        img = img.resize((max(1, round(ancho * escala)), max(1, round(alto * escala))), Image.LANCZOS)
    if cache is not None:
        cache[ruta] = img
    return img


def _inliers(matcher, consulta, candidato, cache_redim=None):
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

    img_a, img_b = _redimensionar(consulta, cache_redim), _redimensionar(candidato, cache_redim)
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


def _inliers_disperso(envoltorio, consulta, candidato, cache_redim=None, cache_feats_consulta=None):
    """LightGlue+ALIKED es disperso, no denso: no hay `warp`+`certainty` que
    muestrear (esa API es exclusiva de RoMa/tiny-roma). Se extraen keypoints
    de cada imagen por separado con ALIKED y se emparejan con LightGlue.
    Los puntos emparejados van al mismo `cv2.findFundamentalMat` con el
    mismo umbral/confianza/iteraciones que `_inliers` calibró para RoMa --
    RANSAC no tiene por qué discriminar distinto según de dónde vinieron las
    correspondencias.

    `cache_feats_consulta`, cuando se pasa, evita volver a extraer los
    keypoints ALIKED de la CONSULTA en cada candidato -- los del candidato sí
    cambian y se calculan siempre, pero los de la consulta son los mismos 12
    veces en una tanda de Pro. Antes esto llamaba a `match_pair()` (el
    helper de `lightglue.utils`), que extrae las dos imágenes sin excepción;
    aquí se hace el mismo trabajo a mano, extrayendo la consulta solo la
    primera vez -- verificado bit a bit contra `match_pair()` (mismos
    keypoints, mismas correspondencias) antes de desplegarlo."""
    import cv2
    import numpy as np
    import torch
    from lightglue.utils import batch_to_device, numpy_image_to_torch, rbd

    extractor, matcher = envoltorio
    img_a, img_b = _redimensionar(consulta, cache_redim), _redimensionar(candidato, cache_redim)
    # Sin este `.to()` el tensor de entrada se quedaba en CPU mientras los
    # pesos estaban en GPU: "Input type (torch.FloatTensor) and weight type
    # (torch.cuda.FloatTensor) should be the same", en el primer candidato,
    # siempre. El extractor ya vive en `DISPOSITIVO` (`_construir` lo manda
    # ahí al cargarlo).
    tensor_b = numpy_image_to_torch(np.array(img_b)).to(DISPOSITIVO)

    with torch.inference_mode():
        if cache_feats_consulta is not None and "consulta" in cache_feats_consulta:
            feats_a = cache_feats_consulta["consulta"]
        else:
            tensor_a = numpy_image_to_torch(np.array(img_a)).to(DISPOSITIVO)
            # SIN `rbd()` todavía -- el matcher exige la dimensión de batch
            # que `extractor.extract()` deja puesta; se quita solo al final,
            # igual que hace `match_pair()` internamente.
            feats_a = extractor.extract(tensor_a)
            if cache_feats_consulta is not None:
                cache_feats_consulta["consulta"] = feats_a
        feats_b = extractor.extract(tensor_b)
        matches01 = matcher({"image0": feats_a, "image1": feats_b})
        feats_a_r, feats_b_r, matches01 = [
            batch_to_device(rbd(x), DISPOSITIVO) for x in (feats_a, feats_b, matches01)
        ]
        parejas = matches01["matches"]
        if len(parejas) < 8:
            return 0
        kpts_a = feats_a_r["keypoints"][parejas[:, 0]].cpu().numpy()
        kpts_b = feats_b_r["keypoints"][parejas[:, 1]].cpu().numpy()
    _, mascara = cv2.findFundamentalMat(
        kpts_a, kpts_b, method=cv2.USAC_MAGSAC, ransacReprojThreshold=0.2, confidence=0.999999, maxIters=10000,
    )
    return int(np.sum(mascara)) if mascara is not None else 0


def _es_componente(verificador_id):
    """`dinov2-vitl14` y `aliked-n16` viven en el registro de verificadores
    (`tipo: "componente"`) porque necesitan su propio sha256/licencia, pero
    no son verificadores que se puedan correr solos -- son el segundo fichero
    que `roma`/`lightglue-aliked` cargan por su cuenta vía `_pesos_de()`.
    `nivel.geometricos` los lista igualmente (así el panel de instalación
    los cuenta como pendientes de descargar), así que aquí, al despachar
    quién corre de verdad, se filtran por el mismo dato -- no una segunda
    lista de ids a mano que pudiera desincronizarse de esa primera."""
    import lumi_pesos

    try:
        return lumi_pesos._ficha(verificador_id, REGISTRO).get("tipo") == "componente"
    except ValueError:
        return False


def _verificar(job):
    if _cargados:
        # Solo si ya se cargó algo alguna vez -- evita el import de balde en
        # el primer trabajo de un proceso recién arrancado.
        import lumi_pesos
        for v in lumi_pesos.purgar_inactivos(_cargados, _ultimo_uso):
            _log("verificador %s desalojado por inactividad" % v)

    fuera = []
    consulta = job["consulta"]
    verificadores = [v for v in job["verificadores"] if not _es_componente(v)]
    # Cachés de UNA SOLA TANDA -- se crean vacías aquí y mueren con esta
    # llamada, nunca sobreviven entre trabajos (una consulta o un candidato
    # de un análisis no tienen por qué significar lo mismo en el siguiente).
    cache_redim = {}
    cache_feats_consulta = {}
    for cand in job["candidatos"]:
        for verificador in verificadores:
            try:
                m = _cargar(verificador)
                # _construir devuelve una tupla (extractor, matcher) solo
                # para el caso disperso (lightglue-aliked) -- ningún otro
                # verificador hoy o en el futuro cercano necesita dos redes,
                # así que el tipo de `m` ya basta como señal, sin una tabla
                # de despacho aparte.
                n = _inliers_disperso(m, consulta, cand["ruta"], cache_redim, cache_feats_consulta) \
                    if isinstance(m, tuple) else _inliers(m, consulta, cand["ruta"], cache_redim)
            except Exception as e:
                _log("verificador %s sobre %s: %s" % (verificador, cand["id"], e))
                continue
            fuera.append({"tipo": "verificado", "id": job["id"], "candidato": cand["id"],
                          "verificador": verificador, "inliers": n,
                          "lat": cand["lat"], "lng": cand["lng"]})
    # Antes esto se llamaba tras CADA candidato (`finally` dentro del bucle):
    # `empty_cache()` sincroniza el dispositivo y devuelve los bloques al
    # driver, así que la siguiente asignación tiene que volver a `cudaMalloc`
    # en vez de reutilizar el caché del asignador -- convertía cada vuelta
    # del bucle en un arranque frío del asignador, 24 veces en Pro. Se deja
    # solo al final de la tanda entera: la fragmentación que esto prevenía
    # (una docena de candidatos seguidos) se sigue evitando igual, porque el
    # próximo trabajo empieza con la VRAM ya liberada.
    try:
        import torch
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
    except ImportError:
        pass
    return fuera


def main():
    _decir({"tipo": "listo", "dispositivo": DISPOSITIVO, "modelo": None})
    # `fin` cierra los mensajes de ESTE trabajo -- en modo no persistente
    # (una orden, stdin se cierra, el proceso muere) nadie la necesita porque
    # el EOF ya lo dice; en modo persistente (`crate::persistente`, ver
    # `lumid/src/agentar.rs`/`verificar.rs`) es la unica forma de saber donde
    # termina un trabajo cuando el proceso sigue vivo para el siguiente.
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
            _decir({"tipo": "fin", "id": job.get("id", 0)})
            continue
        try:
            for msg in _verificar(job):
                _decir(msg)
        except Exception as e:
            _decir({"tipo": "fallo", "id": job["id"], "motivo": str(e)})
        _decir({"tipo": "fin", "id": job["id"]})


if __name__ == "__main__":
    main()
