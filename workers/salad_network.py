"""Arquitectura de SALAD, vendida (GPL-3.0) desde serizba/salad @
models/aggregators/salad.py, models/backbones/dinov2.py y vpr_model.py
(el `forward` que encadena backbone+agregador).

El backbone en si (DINOv2, de Meta, Apache-2.0) NO se vende aqui: se
construye via `torch.hub.load("facebookresearch/dinov2", ..., pretrained=False)`,
que solo trae el codigo de la arquitectura (unos cientos de KB, cacheados
tras la primera vez) SIN descargar los pesos preentrenados de Meta -- el
checkpoint de SALAD que si pasa por nuestro propio pesos/ trae el backbone
YA entrenado entero, asi que los pesos base de Meta no aportan nada al
resultado final; solo hace falta la arquitectura para que `load_state_dict`
tenga donde encajar los valores reales.

cliquemining reusa esta misma clase: es SALAD afinado sobre el mismo
backbone y la misma agregacion, solo cambia el checkpoint.
"""
import math

import torch
import torch.nn as nn


DINOV2_CANALES = {
    "dinov2_vits14": 384, "dinov2_vitb14": 768, "dinov2_vitl14": 1024, "dinov2_vitg14": 1536,
}


class DINOv2Backbone(nn.Module):
    """Envoltorio de serizba/salad sobre el DINOv2 real de Meta: congela los
    primeros bloques, deja entrenables los últimos `num_trainable_blocks`, y
    devuelve el mapa de características más el token global — es lo que
    SALAD espera como entrada, no lo que DINOv2 da de fábrica."""

    def __init__(self, model_name="dinov2_vitb14", num_trainable_blocks=4, norm_layer=True, return_token=True):
        super().__init__()
        self.model = torch.hub.load("facebookresearch/dinov2", model_name, pretrained=False)
        self.num_channels = DINOV2_CANALES[model_name]
        self.num_trainable_blocks = num_trainable_blocks
        self.norm_layer = norm_layer
        self.return_token = return_token

    def forward(self, x):
        b, _, h, w = x.shape
        x = self.model.prepare_tokens_with_masks(x)
        with torch.no_grad():
            for blk in self.model.blocks[:-self.num_trainable_blocks]:
                x = blk(x)
        x = x.detach()
        for blk in self.model.blocks[-self.num_trainable_blocks:]:
            x = blk(x)
        if self.norm_layer:
            x = self.model.norm(x)
        t = x[:, 0]
        f = x[:, 1:]
        f = f.reshape((b, h // 14, w // 14, self.num_channels)).permute(0, 3, 1, 2)
        return (f, t) if self.return_token else f


def _log_otp_solver(log_a, log_b, m, num_iters: int = 20, reg: float = 1.0):
    m = m / reg
    u, v = torch.zeros_like(log_a), torch.zeros_like(log_b)
    for _ in range(num_iters):
        u = log_a - torch.logsumexp(m + v.unsqueeze(1), dim=2).squeeze()
        v = log_b - torch.logsumexp(m + u.unsqueeze(2), dim=1).squeeze()
    return m + u.unsqueeze(2) + v.unsqueeze(1)


def _matching_probs(s, dustbin_score=1.0, num_iters=3, reg=1.0):
    batch_size, m, n = s.size()
    s_aug = torch.empty(batch_size, m + 1, n, dtype=s.dtype, device=s.device)
    s_aug[:, :m, :n] = s
    s_aug[:, m, :] = dustbin_score
    norm = -torch.tensor(math.log(n + m), device=s.device)
    log_a, log_b = norm.expand(m + 1).contiguous(), norm.expand(n).contiguous()
    log_a[-1] = log_a[-1] + math.log(n - m)
    log_a, log_b = log_a.expand(batch_size, -1), log_b.expand(batch_size, -1)
    log_p = _log_otp_solver(log_a, log_b, s_aug, num_iters=num_iters, reg=reg)
    return log_p - norm


class SALAD(nn.Module):
    def __init__(self, num_channels=768, num_clusters=64, cluster_dim=128, token_dim=256, dropout=0.3):
        super().__init__()
        self.num_channels = num_channels
        self.num_clusters = num_clusters
        self.cluster_dim = cluster_dim
        self.token_dim = token_dim
        drop = nn.Dropout(dropout) if dropout > 0 else nn.Identity()

        self.token_features = nn.Sequential(
            nn.Linear(num_channels, 512), nn.ReLU(), nn.Linear(512, token_dim),
        )
        self.cluster_features = nn.Sequential(
            nn.Conv2d(num_channels, 512, 1), drop, nn.ReLU(), nn.Conv2d(512, cluster_dim, 1),
        )
        self.score = nn.Sequential(
            nn.Conv2d(num_channels, 512, 1), drop, nn.ReLU(), nn.Conv2d(512, num_clusters, 1),
        )
        self.dust_bin = nn.Parameter(torch.tensor(1.))

    def forward(self, x):
        x, t = x
        f = self.cluster_features(x).flatten(2)
        p = self.score(x).flatten(2)
        t = self.token_features(t)

        p = _matching_probs(p, self.dust_bin, 3)
        p = torch.exp(p)
        p = p[:, :-1, :]

        p = p.unsqueeze(1).repeat(1, self.cluster_dim, 1, 1)
        f = f.unsqueeze(2).repeat(1, 1, self.num_clusters, 1)

        f = torch.cat([
            nn.functional.normalize(t, p=2, dim=-1),
            nn.functional.normalize((f * p).sum(dim=-1), p=2, dim=1).flatten(1),
        ], dim=-1)
        return nn.functional.normalize(f, p=2, dim=-1)


class VPRModel(nn.Module):
    def __init__(self, backbone="dinov2_vitb14", num_channels=768, num_clusters=64, cluster_dim=128, token_dim=256):
        super().__init__()
        self.backbone = DINOv2Backbone(backbone, num_trainable_blocks=4, norm_layer=True, return_token=True)
        self.aggregator = SALAD(num_channels, num_clusters, cluster_dim, token_dim)

    def forward(self, x):
        return self.aggregator(self.backbone(x))
