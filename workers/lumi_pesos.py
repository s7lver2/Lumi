#!/usr/bin/env python3
"""Carga de pesos de verdad, compartida por los dos trabajadores.

Vive aparte porque `lumi_geo.py` (Station) y `lumi_embed.py` (Indexer) tienen
que producir EL MISMO VECTOR para el mismo modelo. Un vector es el modelo: si
los dos lados cargaran los pesos de forma distinta nada fallaria al arrancar y
las consultas devolverian basura para siempre.

A diferencia de los trabajadores, este modulo SI necesita el venv: importa
torch. El runner del 7a es quien lo instala.
"""
import glob
import hashlib
import json
import os
import time

_hilos_limitados = False

#: Cuánto puede estar un motor/modelo/verificador sin usarse antes de que un
#: proceso persistente lo suelte -- ver `purgar_inactivos`. 10 minutos es un
#: punto de partida razonable: bastante para no desalojar entre análisis
#: seguidos de una sesión activa, poco para que la RAM/VRAM de un proceso que
#: lleva horas vivo no crezca sin límite con cada modelo distinto que haya
#: tocado alguna vez.
UMBRAL_INACTIVIDAD_SEG = 600

#: Margen de memoria libre (MB) por debajo del cual `quizas_purgar_por_presion`
#: fuerza un desalojo total antes de cargar un modelo nuevo -- un colchon de
#: seguridad ANTES de que el OOM killer del kernel pueda entrar en juego, no
#: "memoria en cero". 512 es un punto de partida razonable: de sobra para que
#: quepa un modelo mas sin que el proceso llegue a pedir memoria que el kernel
#: ya no tiene.
UMBRAL_MEMORIA_LIBRE_MB = 512


def _memoria_libre_mb():
    """`MemAvailable` de /proc/meminfo, no `MemFree`: `MemAvailable` ya cuenta
    como recuperable la cache/buffers del kernel, que es la metrica correcta
    de "cuanta memoria puedo pedir de verdad" -- `MemFree` a secas subestima
    mucho lo disponible en Linux (una caja con mucha cache de disco pero poca
    memoria "libre" en el sentido estricto parece al borde del OOM sin estarlo).

    Devuelve `None` si no se puede leer (no es Linux, permisos, el fichero no
    trae esa linea...) -- sin ese dato real la limpieza por presion
    simplemente no puede activarse, nunca se inventa un numero."""
    try:
        with open("/proc/meminfo", "r") as f:
            for linea in f:
                if linea.startswith("MemAvailable:"):
                    return int(linea.split()[1]) / 1024
    except Exception:
        pass
    return None


def tamano_estimado_mb(pesos_dir, modelo_id):
    """Tamaño (MB) de todos los ficheros del directorio de pesos de
    `modelo_id` -- casi siempre un único `pesos.pth`, pero se suman todos los
    ficheros del directorio por si el modelo trae más de uno. Es el mismo
    fichero que `_verificar` va a leer para el sha256 de todas formas, así
    que este tamaño sale gratis antes de cargar."""
    directorio = os.path.join(pesos_dir, modelo_id)
    total = sum(
        os.path.getsize(p)
        for p in glob.glob(os.path.join(directorio, "*"))
        if os.path.isfile(p)
    )
    return total / (1024 * 1024)


def quizas_purgar_por_presion(cache, usos, activo, necesita_mb=0):
    """Segunda via de desalojo, complementaria a `purgar_inactivos`: si la
    memoria disponible del sistema esta al limite justo cuando se va a cargar
    un modelo nuevo, fuerza una limpieza inmediata sin esperar los
    `UMBRAL_INACTIVIDAD_SEG` de inactividad.

    Si `activo` es `False` no mide memoria ni hace nada -- ni siquiera abre
    /proc/meminfo, el interruptor tiene que ser gratis cuando esta apagado.

    `necesita_mb` es el tamaño estimado (en MB) del modelo que se está a
    punto de cargar -- el umbral ya no es una constante fija: se desaloja si
    la memoria libre no alcanza para ese modelo MÁS el margen de seguridad de
    `UMBRAL_MEMORIA_LIBRE_MB`. Con 512 MB de constante y un VLM de varios GB,
    comparar solo contra la constante dejaba pasar cargas que el sistema no
    podía sostener (M1) -- el valor por defecto `0` conserva el comportamiento
    de hoy para cualquier llamante que aún no conozca el tamaño.

    A diferencia de `purgar_inactivos`, aqui no importa cuanto tiempo llevan
    cargadas las entradas de `usos`: si hay presion de memoria YA, se
    descartan TODAS, no solo las mas antiguas -- no hay diez minutos que
    esperar cuando el margen de seguridad ya se cruzo.

    Devuelve la lista de claves desalojadas, para que cada trabajador decida
    como registrarlo en su propio log."""
    if not activo:
        return []
    libre = _memoria_libre_mb()
    if libre is None or libre >= necesita_mb + UMBRAL_MEMORIA_LIBRE_MB:
        return []
    desalojadas = list(usos.keys())
    for clave in desalojadas:
        cache.pop(clave, None)
        usos.pop(clave, None)
    if desalojadas:
        try:
            import torch
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
        except ImportError:
            pass
    return desalojadas


def purgar_inactivos(cache, usos, umbral_seg=UMBRAL_INACTIVIDAD_SEG):
    """Descarta de `cache` las entradas de `usos` (dict paralelo de
    último-uso en segundos, mismas claves) que llevan más de `umbral_seg`
    sin usarse -- sin esto un proceso persistente (`lumi_geo.py`,
    `lumi_verify.py`) no suelta nunca un modelo ya cargado, y la memoria solo
    puede crecer durante toda la vida del proceso, sin importar cuánto
    tiempo lleve sin usarse ese modelo en concreto.

    Las entradas que fallaron al cargar (`_fallidos`) no pasan por `usos` y
    por tanto nunca se desalojan aquí -- reintentar un motor roto no cuesta
    memoria, así que no hay nada que ganar desalojándolo.

    Devuelve la lista de claves desalojadas, para que cada trabajador decida
    cómo registrarlo en su propio log."""
    ahora = time.time()
    desalojadas = [clave for clave, ultimo in usos.items() if ahora - ultimo > umbral_seg]
    for clave in desalojadas:
        cache.pop(clave, None)
        usos.pop(clave, None)
    if desalojadas:
        # Solo tiene sentido sincronizar y devolver bloques al driver cuando
        # de verdad se soltó algo -- llamarlo en cada job sin haber desalojado
        # nada sería el mismo coste que el `empty_cache()` de más que ya se
        # quitó del bucle de verificación por candidato.
        try:
            import torch
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
        except ImportError:
            pass
    return desalojadas


def _limitar_hilos():
    """Sin esto, torch coge TODOS los nucleos logicos para su propio
    paralelismo interno (redimensionar/normalizar imagenes incluido), y ese
    hilo de mas compite con la interfaz del sistema por CPU -- "el pc va
    fatal" mientras embebe no era falta de GPU, era esto. Se deja al menos
    la mitad de los nucleos libres para el resto de la maquina.

    Vive aquí (no en cada trabajador por separado, como estaba antes solo en
    `lumi_embed.py`) porque en Station puede haber varios procesos Python
    vivos a la vez por análisis (embebedor persistente + verificación) --
    sin esto en todos, cada uno cogiendo todos los núcleos, es al daemon y al cliente a
    quien muerde, no solo "al pc" del comentario original. Guardado en un
    flag de módulo: `set_num_threads` no es gratis reinvocarlo sin necesidad
    en cada job, y los trabajadores que lo llaman lo hacen desde su propio
    punto de carga perezosa (una vez por modelo pedido), no una vez por
    trabajo."""
    global _hilos_limitados
    if _hilos_limitados:
        return
    import torch
    nucleos = os.cpu_count() or 4
    torch.set_num_threads(max(1, nucleos // 2))
    _hilos_limitados = True

#: Lado del redimensionado antes del forward, por modelo -- 322 de defecto
#: (23*14, encaja con el patch size 14 de los backbones DINOv2/ViT). MixVPR
#: es la excepcion: su `FeatureMixerLayer` fija `in_h=in_w=20` al construirse
#: (un `nn.LayerNorm(400)`, no una capa que se adapte a otro tamano), y esos
#: 20x20 solo salen de un ResNet50-menos-layer4 (downsample x16) con entrada
#: de 320x320 EXACTOS -- con 322 sale 21x21=441 y `LayerNorm(400)` revienta
#: con "Given normalized_shape=[400] ... but got input of size[N, 1024, 441]".
#: dino-mix es el mismo caso con otra cuenta: su mezclador fija `in_h=in_w=16`
#: (un ViT-B/14 -- patch size 14 -- solo da 16x16 parches con 224x224 EXACTOS,
#: 224/14=16; con 322 salen 23x23=529 y revienta igual que MixVPR con su
#: `LayerNorm`, aqui de tamano 256 en vez de 400).
LADO = {"mixvpr": 320, "dino-mix": 224}


def _ficha(modelo_id, registro_dir):
    """Busca la entrada del registro por id, no por nombre de fichero: el
    fichero se llama megaloc.json pero el id es lumi-preview."""
    for nombre in sorted(os.listdir(registro_dir)):
        if not nombre.endswith(".json"):
            continue
        with open(os.path.join(registro_dir, nombre), "rb") as f:
            d = json.load(f)
        if d.get("id") == modelo_id:
            return d
    raise ValueError("el modelo %s no esta en el registro" % modelo_id)


def _licencia(directorio):
    """Sin licencia al lado, no se carga.

    MIT, Apache-2.0 y BSD-3 obligan a incluir su texto al redistribuir, y la
    licencia propia de DINOv3 —que entra por RoMa v2— obliga ademas a entregar
    el acuerdo junto con los materiales. Se exige para TODOS por igual: una
    regla que solo se aplica al peso incomodo se olvida el dia que entra el
    siguiente.
    """
    ruta = os.path.join(directorio, "LICENCIA.txt")
    if not os.path.exists(ruta):
        raise ValueError(
            "faltan los terminos de licencia en %s; descargalos del repositorio "
            "del modelo y guardalos ahi antes de usar estos pesos" % ruta)


def _sello_verificado(ruta):
    return ruta + ".verificado"


def _leer_sello(ruta, st):
    """Devuelve el sha256 ya conocido para `ruta` si el sello
    `<ruta>.verificado` existe y su `mtime`/`size` coinciden con el fichero
    real de hoy -- si no, `None` (no hay respuesta ya sabida para este
    inodo)."""
    sello = _sello_verificado(ruta)
    try:
        with open(sello, "r") as f:
            d = json.load(f)
    except Exception:
        return None
    if d.get("mtime") == st.st_mtime and d.get("size") == st.st_size:
        return d.get("sha256")
    return None


def _escribir_sello(ruta, sha256, st):
    sello = _sello_verificado(ruta)
    try:
        with open(sello, "w") as f:
            json.dump({"sha256": sha256, "mtime": st.st_mtime, "size": st.st_size}, f)
    except Exception:
        # El sello es solo una optimizacion -- si no se puede escribir (disco
        # de solo lectura, permisos...) el proximo arranque vuelve a hashear
        # completo, nunca se relaja la comprobacion en si.
        pass


def _verificar(ruta, esperado):
    """Sin hash no se carga. Es la misma postura que el aprovisionamiento de
    Qdrant del subsistema 1: no hay «cargar de todas formas».

    Antes de rehashear el fichero completo, mira si ya existe un sello
    `<ruta>.verificado` con `(sha256_esperado, mtime, size)` para este mismo
    inodo -- si `mtime`/`size` coinciden, el hash ya se conoce y no hace
    falta releer el fichero entero (W5: en `pro` son ~2 GB por análisis,
    ~2,5 s con caché caliente). Si no hay sello o no coincide, se hashea
    completo como siempre y, si el resultado coincide con `esperado`, se
    escribe el sello para la próxima vez."""
    if not esperado:
        raise ValueError(
            "el registro no trae sha256 para estos pesos; rellenalo a mano "
            "descargando el fichero y calculando el hash, nunca inventandolo")
    st = os.stat(ruta)
    sellado = _leer_sello(ruta, st)
    if sellado == esperado:
        return
    h = hashlib.sha256()
    with open(ruta, "rb") as f:
        for trozo in iter(lambda: f.read(1 << 20), b""):
            h.update(trozo)
    real = h.hexdigest()
    if real != esperado:
        raise ValueError("el sha256 de %s no coincide: %s" % (ruta, real))
    _escribir_sello(ruta, real, st)


def _reconstruir(modelo_id, dims):
    """Los .pth publicados no son todos iguales: algunos son un nn.Module
    entero (torch.save(model, ...)) y ya traen con qué correr; otros son un
    state_dict crudo (torch.save(model.state_dict(), ...)) que primero hay
    que cargar sobre la arquitectura real, o no hay dónde meterlo. Un
    diccionario que se intenta usar como modelo falla con un error de Python
    ("'OrderedDict' object has no attribute 'eval'"), no con nada que
    explique la causa -- por eso este mapa existe explícito en vez de
    intentar adivinar la arquitectura desde las claves del propio dict."""
    if modelo_id == "cosplace":
        import cosplace_network
        return cosplace_network.GeoLocalizationNet("ResNet18", dims)
    if modelo_id == "eigenplaces":
        # eigenplaces_network.GeoLocalizationNet_ (gmberton/EigenPlaces) es,
        # capa por capa, la misma arquitectura que cosplace_network -- GeM +
        # Flatten + L2Norm sobre un backbone de torchvision sin avgpool ni
        # fc. La unica diferencia de EigenPlaces en su propio codigo es
        # sembrar el backbone con pesos de CosPlace ANTES de entrenar; el
        # checkpoint publicado ya trae el backbone entrenado entero, asi que
        # ese sembrado no aporta nada a la hora de solo cargar y usar.
        import cosplace_network
        return cosplace_network.GeoLocalizationNet("ResNet50", dims)
    if modelo_id in ("salad", "cliquemining"):
        # cliquemining es SALAD afinado sobre el mismo backbone y la misma
        # agregacion (serizba/salad) -- solo cambia el checkpoint, no la
        # arquitectura que hay que reconstruir para cargarlo.
        import salad_network
        return salad_network.VPRModel("dinov2_vitb14", num_channels=768, num_clusters=64, cluster_dim=128, token_dim=256)
    if modelo_id == "lumi-2":
        import boq_network
        return boq_network.crear_dinov2_12288()
    if modelo_id == "mixvpr":
        import mixvpr_network
        return mixvpr_network.crear_4096()
    if modelo_id == "lumi-preview":
        import megaloc_network
        return megaloc_network.MegaLoc()
    if modelo_id == "dino-mix":
        import dino_mix_network
        return dino_mix_network.crear_vitb14_mix()
    raise ValueError(
        f"{modelo_id} trae un state_dict crudo y no se sabe reconstruir su arquitectura "
        "-- hace falta añadir su definición de red, igual que cosplace_network.py"
    )


class Embebedor(object):
    def __init__(self, ficha, pesos_dir, dispositivo):
        import torch
        from torchvision import transforms

        self.id = ficha["id"]
        self.dims = int(ficha["dims"])
        self.dispositivo = dispositivo
        directorio = os.path.join(pesos_dir, self.id)
        ruta = os.path.join(directorio, "pesos.pth")
        _licencia(directorio)
        _verificar(ruta, ficha.get("sha256", ""))
        if self.id == "lumi-preview":
            # MegaLoc se publica en .safetensors, no en el pickle que lee
            # torch.load -- lee distinto, pero de aqui en adelante es el
            # mismo camino generico (state_dict crudo + _reconstruir) que
            # cualquier otro modelo, así que no hace falta una clase aparte
            # como la de anyloc (que sí necesita todo su propio forward).
            from safetensors.torch import load_file
            crudo = load_file(ruta)
        else:
            # weights_only=True restringe qué clases puede reconstruir el
            # pickle de PyTorch (tensores y contenedores básicos, nada
            # arbitrario) y es lo que hay que usar siempre que el fichero
            # sea un state_dict — que es el caso normal. Algunos .pth
            # antiguos guardan el módulo entero en vez de solo sus pesos, y
            # para esos no hay forma de evitar el unpickling completo sin
            # dejar de poder cargarlos: se intenta el camino seguro primero
            # y solo se cae al inseguro si de verdad hace falta, nunca al
            # revés.
            try:
                crudo = torch.load(ruta, map_location=dispositivo, weights_only=True)
            except Exception:
                crudo = torch.load(ruta, map_location=dispositivo, weights_only=False)
        if isinstance(crudo, dict):
            # Un .ckpt de PyTorch Lightning no es el state_dict en si: es un
            # sobre con el state_dict metido bajo la clave "state_dict",
            # junto a epoch/optimizer/hparams que no son pesos de nada.
            # cargarlo tal cual falla porque las claves no coinciden con
            # ningun parametro real de la red.
            if "state_dict" in crudo:
                crudo = crudo["state_dict"]
            self.red = _reconstruir(self.id, self.dims)
            self.red.load_state_dict(crudo)
        else:
            self.red = crudo
        self.red.eval()
        self.red.to(dispositivo)
        if str(dispositivo).startswith("cuda"):
            # Todas las imagenes se redimensionan al mismo 322x322 antes del
            # forward: con el tamano de entrada siempre igual, cudnn puede
            # probar varios algoritmos de convolucion la primera vez y
            # quedarse con el mas rapido para el resto de la sesion. Sin
            # esto usa el algoritmo generico "seguro" para cualquier forma.
            torch.backends.cudnn.benchmark = True
        # W14: construido una sola vez aquí, no en `_prep()` -- ese método se
        # llamaba una vez POR LOTE (`vectores()`), rehaciendo el mismo
        # `Compose` (con la misma talla y las mismas medias/desviaciones, que
        # nunca cambian para este modelo) en cada job.
        self._transform = transforms.Compose([
            transforms.Resize((LADO.get(self.id, 322),) * 2),
            transforms.ToTensor(),
            transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
        ])

    def _prep(self):
        return self._transform

    def vector(self, ruta_imagen):
        """Un solo vector. Existe para pruebas rapidas contra un fichero
        suelto; el trabajador de verdad llama a `vectores()`, no a esto."""
        ok, saltadas = self.vectores([ruta_imagen])
        if saltadas:
            raise ValueError(saltadas[0][1])
        return ok[0][1]

    def vectores(self, rutas_imagen):
        """Un solo forward para todo el lote, no uno por imagen.

        Antes cada imagen pasaba por la red en su propia llamada -- 32
        lanzamientos de kernel de 1 imagen cada uno, en vez de 1 de 32. Con
        modelos pequenos (ResNet18/50) el coste fijo de cada lanzamiento
        domina sobre el trabajo real, y la GPU pasaba la mayor parte del
        tiempo esperando a la CPU en vez de calculando: "usa poca grafica"
        no era falta de trabajo, era como se estaba pidiendo.

        Devuelve `(ok, saltadas)`: `ok` es `[(ruta, vector), ...]` en el
        mismo orden que las que sí se pudieron decodificar; `saltadas` es
        `[(ruta, motivo), ...]` para las que fallaron ANTES del forward
        (fichero roto, vacío...) -- esas nunca deben tumbar el lote entero.
        """
        import torch
        from PIL import Image

        prep = self._prep()
        tensores, buenas = [], []
        saltadas = []
        for ruta in rutas_imagen:
            try:
                img = Image.open(ruta).convert("RGB")
                tensores.append(prep(img))
                buenas.append(ruta)
            except Exception as e:
                saltadas.append((ruta, str(e)))
        if not tensores:
            return [], saltadas

        lote = torch.stack(tensores).to(self.dispositivo)
        en_cuda = str(self.dispositivo).startswith("cuda")
        # fp16 en vez de fp32: es solo inferencia (nada de gradientes que
        # puedan desbordarse), y una RTX de esta generacion hace el doble de
        # rapido el mismo forward en media precision gracias a sus tensor
        # cores -- el vector final se guarda igual, la perdida de precision
        # no es perceptible para lo que hace falta de un embedding de
        # recuperacion. En CPU no hay tensor cores que aprovechar, así que
        # ahí se queda en fp32 tal cual.
        with torch.inference_mode(), torch.autocast("cuda", enabled=en_cuda):
            d = self.red(lote)
        d = torch.nn.functional.normalize(d.float().flatten(1), p=2, dim=1)
        # W13: `.tolist()` convertia cada componente del vector (hasta 12288
        # por imagen) en un objeto Python de por si, solo para que el
        # llamante volviera a desempaquetarlos con `struct.pack("<%df", *v)`
        # -- dos copias donde basta una vez que se sale de la GPU. Se
        # devuelve el array de numpy tal cual; cada llamante hace
        # `.astype('<f4').tobytes()` directamente sobre el, sin pasar por
        # una lista de floats de Python en medio.
        ok = list(zip(buenas, d.cpu().numpy()))
        return ok, saltadas


def cargar(modelo_id, registro_dir, pesos_dir, dispositivo):
    ficha = _ficha(modelo_id, registro_dir)
    if modelo_id == "anyloc":
        # No hay una red afinada que reconstruir aqui: el backbone es
        # DINOv2-giant tal cual, sin afinar, y lo unico que descarga
        # nuestro pesos/ es el vocabulario VLAD (un tensor de centros de
        # cluster, no un state_dict) -- no encaja en el flujo generico
        # de Embebedor, por eso tiene su propia clase.
        directorio = os.path.join(pesos_dir, modelo_id)
        ruta = os.path.join(directorio, "pesos.pth")
        _licencia(directorio)
        _verificar(ruta, ficha.get("sha256", ""))
        import anyloc_network
        return anyloc_network.Embebedor(ruta, dispositivo)
    return Embebedor(ficha, pesos_dir, dispositivo)
