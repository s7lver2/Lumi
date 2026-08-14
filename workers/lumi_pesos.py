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
            self.red = _reconstruir(self.id, self.dims)
            self.red.load_state_dict(crudo)
        else:
            self.red = crudo
        self.red.eval()
        self.red.to(dispositivo)

    def vector(self, ruta_imagen):
        """Devuelve el descriptor normalizado a L2. La normalizacion es
        PRECONDICION del formato de fragmento (`lumi_index::vectors`): sin ella
        la escala fija del int8 no vale."""
        import torch
        from PIL import Image
        from torchvision import transforms

        prep = transforms.Compose([
            transforms.Resize((322, 322)),
            transforms.ToTensor(),
            transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
        ])
        img = Image.open(ruta_imagen).convert("RGB")
        lote = prep(img).unsqueeze(0).to(self.dispositivo)
        with torch.no_grad():
            d = self.red(lote)
        d = torch.nn.functional.normalize(d.flatten(), p=2, dim=0)
        return d.cpu().tolist()


def cargar(modelo_id, registro_dir, pesos_dir, dispositivo):
    return Embebedor(_ficha(modelo_id, registro_dir), pesos_dir, dispositivo)
