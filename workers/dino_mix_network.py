"""DINO-Mix (GaoShuang98/DINO-Mix, MIT), vendido tal cual desde su propio
hubconf.py: DINOv2 ViT-B/14 como backbone -- el mismo torch.hub que usa
boq_network.DinoV2, pero SIN el recorte de bloques finales, y con el `norm`
final del transformer anulado, tal como hace models/backbones/DINOv2_self.py
del repo original -- mas el mismo mezclador MixVPR que ya usa
mixvpr_network.py (misma clase, mismos nombres de atributo: este checkpoint
solo cambia qué alimenta al mezclador, no el mezclador en si).

El .ckpt publicado (dinov2_vitb14_mix.ckpt, release v1.0.0) es un checkpoint
de pytorch_lightning: el propio hubconf.py del autor lo confirma -- construye
esta misma VPRModel(backbone, aggregator) y le hace
`model.load_state_dict(state_dict['state_dict'])`, ya sin ningun prefijo de
Lightning por delante.
"""
import numpy as np
import torch
import torch.nn as nn

from mixvpr_network import MixVPR, VPRModel


class DinoV2Parches(nn.Module):
    """DINOv2 ViT-B/14 tal cual via torch.hub, con el `norm` final anulado
    (asi se entreno el checkpoint -- ver models/backbones/DINOv2_self.py del
    repo original) y quedandose solo con los tokens de parche, reacomodados
    a B,C,H,W."""

    def __init__(self, backbone_name="dinov2_vitb14"):
        super().__init__()
        # trust_repo=True explicito: mismo motivo que en boq_network.DinoV2 --
        # sin el, torch.hub.load pregunta por stdin si confiamos en el repo,
        # y stdin ya viene cerrado aqui, asi que revienta con EOFError en vez
        # de cargar nada.
        self.dino_model = torch.hub.load("facebookresearch/dinov2", backbone_name, pretrained=False, trust_repo=True)
        # El checkpoint se entreno con esta capa anulada (Sequential vacio,
        # sin parametros): cargar el state_dict real sobre un `norm` real
        # dejaria pesos sin usar de sobra, y sobre todo cambiaria el forward
        # -- sin normalizacion final es justo como se entreno.
        self.dino_model.norm = nn.Sequential()
        self.dino_model.head = nn.Sequential()

    def forward(self, x):
        salida = self.dino_model.forward_features(x)
        x = salida["x_norm_patchtokens"]  # sin cls, ya sin normalizar (ver arriba)
        b, f, c = x.shape
        lado = int(np.sqrt(f))
        x = x.view(b, lado, lado, c)
        return x.permute(0, 3, 1, 2)


def crear_vitb14_mix() -> VPRModel:
    """Reconstruye la variante publicada (dinov2_vitb14_mix.ckpt, registro
    dino-mix, dims=4096): hiperparametros literales de DEFAULT_AGG_CONFIG en
    el hubconf.py del repo original -- in_h=in_w=16 porque a 224x224 de
    entrada (ver LADO en lumi_pesos.py) un ViT-B/14 da exactamente 16x16
    parches (224/14=16)."""
    backbone = DinoV2Parches("dinov2_vitb14")
    aggregator = MixVPR(
        in_channels=768, in_h=16, in_w=16,
        out_channels=1024, mix_depth=2, mlp_ratio=1, out_rows=4,
    )
    return VPRModel(backbone, aggregator)
