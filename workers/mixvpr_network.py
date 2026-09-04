"""Arquitectura de MixVPR, vendida tal cual (sin licencia declarada por el
autor -- ver aviso en registros/modelos/mixvpr.json) desde
amaralibey/MixVPR @ models/backbones/resnet.py, models/aggregators/mixvpr.py
y main.py (clase VPRModel).

El .ckpt publicado para la variante de 4096 dims
(resnet50_MixVPR_4096_channels(1024)_rows(4).ckpt, enlazada por Google Drive
desde el propio README) es un state_dict crudo: el propio demo.py del autor
lo carga con `model.load_state_dict(torch.load(ckpt_path))`, no con
`torch.load(ckpt_path)` a secas -- por eso hace falta reconstruir aqui la
misma arquitectura, con los mismos nombres de atributo (`backbone`,
`aggregator`, y dentro de cada uno los mismos submodulos), o las claves del
dict no casan con ningun parametro real de la red.

El VPRModel real del autor es un pytorch_lightning.LightningModule (trae
optimizador, scheduler, funcion de perdida...) pero nada de eso forma parte
del state_dict de inferencia: LightningModule es en el fondo un nn.Module,
y sus claves de estado son las de los submodulos que cuelgan de el como
atributos (`self.backbone`, `self.aggregator`) mas los buffers registrados
via nn.Module normal -- no lleva prefijo de Lightning. Por eso aqui basta
con una version en nn.Module puro que replique esos dos atributos con
exactamente esos nombres; no hace falta arrastrar pytorch_lightning como
dependencia solo para cargar pesos.
"""
import torch
import torch.nn as nn
import torch.nn.functional as F
import torchvision


class ResNet(nn.Module):
    """Backbone recortado: igual que backbones/resnet.py del autor, pero sin
    las ramas de arquitecturas que MixVPR-4096 no usa (efficientnet, swin,
    resnext, variantes swsl/ssl) -- esas existen en el repo original para
    poder entrenar otras variantes, no para cargar esta.

    `pretrained` se deja en False por defecto a proposito: el state_dict
    real se carga encima justo despues (ver `Embebedor`/`_reconstruir` en
    lumi_pesos.py) y pedir los pesos de ImageNet aqui solo seria una
    descarga de red que se va a pisar entera, no una que aporte nada.
    """

    def __init__(self, pretrained: bool = False, layers_to_crop=(4,)):
        super().__init__()
        self.model = torchvision.models.resnet50(
            weights="IMAGENET1K_V1" if pretrained else None)

        # sin avgpool ni fc: MixVPR agrega directamente sobre el mapa de
        # activaciones de la ultima capa convolucional que sobreviva al
        # recorte, no sobre un vector ya reducido.
        self.model.avgpool = None
        self.model.fc = None

        # la variante de 4096 dims recorta layer4 (layers_to_crop=[4] en el
        # propio main.py del autor): con resnet50 completo el mapa de salida
        # seria 2048 canales a 10x10; recortando layer4 se queda en 1024
        # canales a 20x20, que es justo la entrada que espera el agregador
        # MixVPR de esta variante (in_channels=1024, in_h=in_w=20).
        if 4 in layers_to_crop:
            self.model.layer4 = None
        if 3 in layers_to_crop:
            self.model.layer3 = None

        out_channels = 2048
        self.out_channels = out_channels // 2 if self.model.layer4 is None else out_channels
        self.out_channels = self.out_channels // 2 if self.model.layer3 is None else self.out_channels

    def forward(self, x):
        x = self.model.conv1(x)
        x = self.model.bn1(x)
        x = self.model.relu(x)
        x = self.model.maxpool(x)
        x = self.model.layer1(x)
        x = self.model.layer2(x)
        if self.model.layer3 is not None:
            x = self.model.layer3(x)
        if self.model.layer4 is not None:
            x = self.model.layer4(x)
        return x


class FeatureMixerLayer(nn.Module):
    """Un bloque MLP-Mixer (LayerNorm + 2 lineales con ReLU en medio) con
    conexion residual, aplicado sobre la dimension espacial aplanada
    (in_h*in_w), no sobre los canales -- de ahi "feature mixing": mezcla
    posiciones espaciales entre si en vez de mezclar canales como haria una
    conv 1x1."""

    def __init__(self, in_dim, mlp_ratio=1):
        super().__init__()
        self.mix = nn.Sequential(
            nn.LayerNorm(in_dim),
            nn.Linear(in_dim, int(in_dim * mlp_ratio)),
            nn.ReLU(),
            nn.Linear(int(in_dim * mlp_ratio), in_dim),
        )
        # la inicializacion no importa para cargar un checkpoint (se pisa
        # entera con load_state_dict), pero se deja igual que el original
        # por si algun dia se necesita instanciar sin pesos.
        for m in self.modules():
            if isinstance(m, nn.Linear):
                nn.init.trunc_normal_(m.weight, std=0.02)
                if m.bias is not None:
                    nn.init.zeros_(m.bias)

    def forward(self, x):
        return x + self.mix(x)


class MixVPR(nn.Module):
    """Agregador de MixVPR: aplana el mapa de activaciones (C, H, W) a
    (C, H*W), lo pasa por `mix_depth` FeatureMixerLayer apiladas, proyecta
    canales (channel_proj) y filas espaciales (row_proj) a las dimensiones
    de salida, y L2-normaliza el vector aplanado resultante.

    Con los hiperparametros de la variante 4096 (out_channels=1024,
    out_rows=4) la salida final es 4*1024 = 4096 -- el numero que da nombre
    al checkpoint y coincide con dims en el registro.
    """

    def __init__(self, in_channels=1024, in_h=20, in_w=20,
                 out_channels=1024, mix_depth=4, mlp_ratio=1, out_rows=4):
        super().__init__()
        self.in_h = in_h
        self.in_w = in_w
        self.in_channels = in_channels
        self.out_channels = out_channels
        self.out_rows = out_rows
        self.mix_depth = mix_depth
        self.mlp_ratio = mlp_ratio

        hw = in_h * in_w
        self.mix = nn.Sequential(*[
            FeatureMixerLayer(in_dim=hw, mlp_ratio=mlp_ratio)
            for _ in range(self.mix_depth)
        ])
        self.channel_proj = nn.Linear(in_channels, out_channels)
        self.row_proj = nn.Linear(hw, out_rows)

    def forward(self, x):
        x = x.flatten(2)
        x = self.mix(x)
        x = x.permute(0, 2, 1)
        x = self.channel_proj(x)
        x = x.permute(0, 2, 1)
        x = self.row_proj(x)
        x = F.normalize(x.flatten(1), p=2, dim=-1)
        return x


class VPRModel(nn.Module):
    """Envoltorio nn.Module puro del VPRModel del autor (que en el repo
    original es un pytorch_lightning.LightningModule con optimizador,
    scheduler y perdida incluidos) -- para cargar y usar un checkpoint ya
    entrenado no hace falta nada de eso, solo backbone + aggregator con
    esos mismos nombres de atributo, que es lo que define las claves del
    state_dict publicado.
    """

    def __init__(self, backbone: ResNet, aggregator: MixVPR):
        super().__init__()
        self.backbone = backbone
        self.aggregator = aggregator

    def forward(self, x):
        x = self.backbone(x)
        x = self.aggregator(x)
        return x


def crear_4096() -> VPRModel:
    """Unica variante que trae el registro (mixvpr.json, dims=4096):
    resnet50 con layer4 recortado + MixVPR(out_channels=1024, mix_depth=4,
    out_rows=4) -- son los mismos argumentos que demo.py::load_model() del
    autor pasa a VPRModel() para el checkpoint
    resnet50_MixVPR_4096_channels(1024)_rows(4).ckpt.
    """
    backbone = ResNet(pretrained=False, layers_to_crop=(4,))
    aggregator = MixVPR(
        in_channels=1024, in_h=20, in_w=20,
        out_channels=1024, mix_depth=4, mlp_ratio=1, out_rows=4,
    )
    return VPRModel(backbone, aggregator)
