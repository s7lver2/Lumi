"""Arquitectura de CosPlace, vendida tal cual (MIT) desde
gmberton/CosPlace @ cosplace_model/{cosplace_network,layers}.py.

El .pth publicado es un state_dict crudo, no un nn.Module completo:
torch.load() por si solo no da nada con .eval()/.to(). Hace falta
reconstruir esta arquitectura exacta antes de poder cargarle el
state_dict encima -- equivocarse aqui no rompe nada a la vista, solo
produce vectores que parecen validos y no lo son. Por eso se copia el
codigo real del autor en vez de reescribirlo de memoria.
"""
import torch
import torch.nn as nn
import torch.nn.functional as F
import torchvision
from torch.nn.parameter import Parameter

CHANNELS_NUM_IN_LAST_CONV = {
    "ResNet18": 512, "ResNet50": 2048, "ResNet101": 2048, "ResNet152": 2048,
}


def gem(x, p=torch.ones(1) * 3, eps: float = 1e-6):
    return F.avg_pool2d(x.clamp(min=eps).pow(p), (x.size(-2), x.size(-1))).pow(1. / p)


class GeM(nn.Module):
    def __init__(self, p=3, eps=1e-6):
        super().__init__()
        self.p = Parameter(torch.ones(1) * p)
        self.eps = eps

    def forward(self, x):
        return gem(x, p=self.p, eps=self.eps)


class Flatten(nn.Module):
    def forward(self, x):
        assert x.shape[2] == x.shape[3] == 1
        return x[:, :, 0, 0]


class L2Norm(nn.Module):
    def __init__(self, dim=1):
        super().__init__()
        self.dim = dim

    def forward(self, x):
        return F.normalize(x, p=2.0, dim=self.dim)


def _backbone(nombre):
    modelo = getattr(torchvision.models, nombre.lower())(weights=None)
    capas = list(modelo.children())[:-2]  # sin avgpool ni fc
    return nn.Sequential(*capas), CHANNELS_NUM_IN_LAST_CONV[nombre]


class GeoLocalizationNet(nn.Module):
    def __init__(self, backbone: str, fc_output_dim: int):
        super().__init__()
        self.backbone, dims = _backbone(backbone)
        self.aggregation = nn.Sequential(
            L2Norm(), GeM(), Flatten(), nn.Linear(dims, fc_output_dim), L2Norm(),
        )

    def forward(self, x):
        return self.aggregation(self.backbone(x))
