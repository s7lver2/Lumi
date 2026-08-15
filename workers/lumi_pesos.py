#!/usr/bin/env python3
"""Carga de pesos de verdad, compartida por los dos trabajadores.

Vive aparte porque `lumi_geo.py` (Station) y `lumi_embed.py` (Indexer) tienen
que producir EL MISMO VECTOR para el mismo modelo. Un vector es el modelo: si
los dos lados cargaran los pesos de forma distinta nada fallaria al arrancar y
las consultas devolverian basura para siempre.

A diferencia de los trabajadores, este modulo SI necesita el venv: importa
torch. El runner del 7a es quien lo instala.
"""
import hashlib
import json
import os


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


def _verificar(ruta, esperado):
    """Sin hash no se carga. Es la misma postura que el aprovisionamiento de
    Qdrant del subsistema 1: no hay «cargar de todas formas»."""
    if not esperado:
        raise ValueError(
            "el registro no trae sha256 para estos pesos; rellenalo a mano "
            "descargando el fichero y calculando el hash, nunca inventandolo")
    h = hashlib.sha256()
    with open(ruta, "rb") as f:
        for trozo in iter(lambda: f.read(1 << 20), b""):
            h.update(trozo)
    real = h.hexdigest()
    if real != esperado:
        raise ValueError("el sha256 de %s no coincide: %s" % (ruta, real))


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
    raise ValueError(
        f"{modelo_id} trae un state_dict crudo y no se sabe reconstruir su arquitectura "
        "-- hace falta añadir su definición de red, igual que cosplace_network.py"
    )


class Embebedor(object):
    def __init__(self, ficha, pesos_dir, dispositivo):
        import torch

        self.id = ficha["id"]
        self.dims = int(ficha["dims"])
        self.dispositivo = dispositivo
        directorio = os.path.join(pesos_dir, self.id)
        ruta = os.path.join(directorio, "pesos.pth")
        _licencia(directorio)
        _verificar(ruta, ficha.get("sha256", ""))
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

    def _prep(self):
        from torchvision import transforms
        return transforms.Compose([
            transforms.Resize((322, 322)),
            transforms.ToTensor(),
            transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
        ])

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
        ok = list(zip(buenas, d.cpu().tolist()))
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
