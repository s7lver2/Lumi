"""Arquitectura de BoQ (Bag-of-Queries), vendida tal cual (MIT) desde
amaralibey/Bag-of-Queries @ src/backbones.py (clase DinoV2) y src/boq.py
(BoQBlock, BoQ), mas el VPRModel de hubconf.py que las encadena.

El .pth de la release v1.0 (dinov2_12288.pth) es un state_dict crudo: el
propio hubconf.py del autor lo confirma -- construye VPRModel(backbone,
aggregator) y le hace `vpr_model.load_state_dict(torch.hub.load_state_dict_from_url(...))`
en vez de un `torch.load` que ya devuelva el modulo entero. Sin esta clase
exacta debajo, `load_state_dict` no tiene donde encajar los pesos.

Hiperparametros para la variante "dinov2_12288" (backbone_name="dinov2",
output_dim=12288 en hubconf.get_trained_boq), leidos del propio repo:
  - backbone: DinoV2(backbone_name="dinov2_vitb14") -- default de la clase,
    out_channels = embed_dim de dinov2_vitb14 = 768.
  - agregador: BoQ(in_channels=768, proj_channels=384, num_queries=64,
    num_layers=2, row_dim=output_dim//384=32) -- row_dim sale directo de
    hubconf.py ("32 for dinov2"), el resto son los defaults que hubconf pasa
    explicitos para la rama "dinov2" de get_trained_boq.
  - La cuenta de salida cuadra con dims=12288 del registro: BoQ concatena
    num_layers*num_queries=128 vectores de proj_channels=384, los proyecta a
    row_dim=32 con un Linear, y aplana -> 384*32=12288. Si esta cuenta no
    diera 12288 seria señal de haber copiado mal algun hiperparametro.

BoQBlock trae self_attn/norm_q "solo para entrenamiento" segun el comentario
del propio autor en el codigo original, pero sus pesos SI estan en el
state_dict publicado (son parametros de la clase, no un modulo aparte que
se pueda omitir) -- hay que instanciarlos igual aunque el forward de
inferencia los use lo mismo que en entrenamiento; no hay atajo real posible
sin reescribir el forward, y reescribirlo es precisamente lo que este
fichero evita hacer.
"""
import torch
import torch.nn as nn


class DinoV2(nn.Module):
    """Envoltorio de amaralibey/Bag-of-Queries sobre el DINOv2 real de Meta:
    igual que salad_network.DINOv2Backbone, trae la arquitectura via
    torch.hub (sin pesos de Meta -- el checkpoint de BoQ ya trae el backbone
    entrenado entero) y solo se queda con los tokens de parche, sin el CLS,
    reacomodados a B,C,H,W."""

    AVAILABLE_MODELS = [
        "dinov2_vits14", "dinov2_vitb14", "dinov2_vitl14", "dinov2_vitg14",
    ]

    def __init__(self, backbone_name="dinov2_vitb14", unfreeze_n_blocks=2, reshape_output=True):
        super().__init__()
        if backbone_name not in self.AVAILABLE_MODELS:
            backbone_name = "dinov2_vitb14"
        self.backbone_name = backbone_name
        self.unfreeze_n_blocks = unfreeze_n_blocks
        self.reshape_output = reshape_output
        # trust_repo=True explicito: mismo bug ya visto con XFeat en
        # lumi_verify._construir -- sin el, torch.hub.load pregunta por
        # stdin si confiamos en el repo, y stdin ya viene cerrado aqui, asi
        # que revienta con EOFError en el instante en vez de cargar nada.
        self.dino = torch.hub.load("facebookresearch/dinov2", self.backbone_name, pretrained=False, trust_repo=True)
        self.out_channels = self.dino.embed_dim

    @property
    def patch_size(self):
        return self.dino.patch_embed.patch_size[0]

    def forward(self, x):
        b, _, h, w = x.shape
        with torch.no_grad():
            x = self.dino.prepare_tokens_with_masks(x)
            for blk in self.dino.blocks[:-self.unfreeze_n_blocks]:
                x = blk(x)
        for blk in self.dino.blocks[-self.unfreeze_n_blocks:]:
            x = blk(x)
        x = x[:, 1:]  # fuera el token [CLS], BoQ solo usa los parches
        if self.reshape_output:
            _, _, c = x.shape
            patch_size = self.patch_size
            x = x.permute(0, 2, 1).view(b, c, h // patch_size, w // patch_size)
        return x


class BoQBlock(nn.Module):
    def __init__(self, in_dim, num_queries, nheads=8):
        super().__init__()
        self.encoder = nn.TransformerEncoderLayer(
            d_model=in_dim, nhead=nheads, dim_feedforward=4 * in_dim, batch_first=True, dropout=0.,
        )
        self.queries = nn.Parameter(torch.randn(1, num_queries, in_dim))
        self.self_attn = nn.MultiheadAttention(in_dim, num_heads=nheads, batch_first=True)
        self.norm_q = nn.LayerNorm(in_dim)
        self.cross_attn = nn.MultiheadAttention(in_dim, num_heads=nheads, batch_first=True)
        self.norm_out = nn.LayerNorm(in_dim)

    def forward(self, x):
        b = x.size(0)
        x = self.encoder(x)

        q = self.queries.repeat(b, 1, 1)
        q = q + self.self_attn(q, q, q)[0]
        q = self.norm_q(q)

        out, attn = self.cross_attn(q, x, x)
        out = self.norm_out(out)
        return x, out, attn.detach()


class BoQ(nn.Module):
    def __init__(self, in_channels=1024, proj_channels=512, num_queries=32, num_layers=2, row_dim=32):
        super().__init__()
        self.proj_c = nn.Conv2d(in_channels, proj_channels, kernel_size=3, padding=1)
        self.norm_input = nn.LayerNorm(proj_channels)

        in_dim = proj_channels
        self.boqs = nn.ModuleList([
            BoQBlock(in_dim, num_queries, nheads=in_dim // 64) for _ in range(num_layers)
        ])
        self.fc = nn.Linear(num_layers * num_queries, row_dim)

    def forward(self, x):
        x = self.proj_c(x)
        x = x.flatten(2).permute(0, 2, 1)
        x = self.norm_input(x)

        outs = []
        for boq in self.boqs:
            x, out, _attn = boq(x)
            outs.append(out)

        out = torch.cat(outs, dim=1)
        out = self.fc(out.permute(0, 2, 1))
        out = out.flatten(1)
        return nn.functional.normalize(out, p=2, dim=-1)


class VPRModel(nn.Module):
    """Encadena backbone + agregador, igual que el VPRModel de hubconf.py.
    A diferencia del original no devuelve `attns` (los pesos de atencion de
    cada BoQBlock, pensados para visualizar heatmaps de que parches mira
    cada query): aqui solo hace falta el vector final, y devolverlos sin
    usarlos seria una salida que Embebedor.vectores() tendria que aprender a
    ignorar sin motivo."""

    def __init__(self, backbone: nn.Module, aggregator: nn.Module):
        super().__init__()
        self.backbone = backbone
        self.aggregator = aggregator

    def forward(self, x):
        x = self.backbone(x)
        # `BoQ.forward` ya normaliza y aplana a un solo tensor -- no una
        # tupla (vector, attns) -- así que aquí no hay nada que desempaquetar.
        # Desempaquetarlo (`x, _attns = ...`) funcionaba "por accidente" con
        # lotes de exactamente 2 imágenes (2 filas del tensor se reparten en
        # 2 variables sin error, pero cada una se queda con el vector de UNA
        # sola imagen, no con las dos) y reventaba con "too many values to
        # unpack" en cualquier otro tamaño de lote -- que es como se
        # descubrió, al embeber lotes reales de 32.
        return self.aggregator(x)


def crear_dinov2_12288():
    """Reconstruye la variante publicada como dinov2_12288.pth (registro
    lumi-2, dims=12288): los hiperparametros vienen literales de la rama
    "dinov2" de hubconf.get_trained_boq, no de una suposicion."""
    backbone = DinoV2(backbone_name="dinov2_vitb14", unfreeze_n_blocks=2)
    aggregator = BoQ(
        in_channels=backbone.out_channels,  # 768, embed_dim de dinov2_vitb14
        proj_channels=384,
        num_queries=64,
        num_layers=2,
        row_dim=32,  # 12288 // 384, tal cual hubconf.py
    )
    return VPRModel(backbone, aggregator)
