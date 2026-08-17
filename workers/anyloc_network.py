"""AnyLoc (DINOv2 + VLAD, sin afinar), vendido (BSD-3-Clause) desde
AnyLoc/AnyLoc @ demo/utilities.py — `DinoV2ExtractFeatures` y `VLAD`,
recortado: la version original guarda residuos/etiquetas en disco para
acelerar consultas repetidas sobre un set de entrenamiento fijo; aqui
cada imagen se ve una vez, asi que esa cache nunca se usaria.

A diferencia de cosplace/eigenplaces/salad, aqui NO hay una red
afinada que cargar de un fichero propio: el backbone es DINOv2-giant
TAL CUAL lo publica Meta (sin afinar, de ahi "sin afinar" en el
registro), y lo unico que aporta AnyLoc es el vocabulario VLAD --
unos centros de cluster precalculados, el fichero que si pasa por
nuestro pesos/. Por eso este modulo no encaja en `_reconstruir` +
`load_state_dict`: aqui "cargar los pesos" es cargar un tensor de
centros, no un state_dict de una red.

El backbone DINOv2 se pide con `pretrained=True` (a diferencia de
salad_network, que lo pide en blanco): aqui no hay checkpoint propio
que vaya a sobreescribirlo despues, asi que los pesos reales de Meta
SI importan para el resultado.
"""
import torch
import torch.nn.functional as F


class _DinoV2ExtractFeatures:
    def __init__(self, dino_model, layer, facet, device):
        self.dino_model = torch.hub.load("facebookresearch/dinov2", dino_model)
        self.dino_model = self.dino_model.eval().to(device)
        self.layer = layer
        self.facet = facet
        if facet == "token":
            self._handle = self.dino_model.blocks[layer].register_forward_hook(self._hook())
        else:
            self._handle = self.dino_model.blocks[layer].attn.qkv.register_forward_hook(self._hook())
        self._hook_out = None

    def _hook(self):
        def _forward_hook(module, inputs, output):
            self._hook_out = output
        return _forward_hook

    def __call__(self, img):
        en_cuda = img.is_cuda
        # fp16 en vez de fp32: DINOv2-giant es el modelo mas caro de los
        # cinco (1.1B parametros) y el unico que corre imagen a imagen, asi
        # que es donde mas se nota el tensor-core de una RTX -- misma logica
        # que en lumi_pesos.Embebedor.vectores.
        with torch.inference_mode(), torch.autocast("cuda", enabled=en_cuda):
            self.dino_model(img)
            res = self._hook_out[:, 1:, ...]  # sin el token CLS
            if self.facet in ("query", "key", "value"):
                d_len = res.shape[2] // 3
                idx = {"query": 0, "key": 1, "value": 2}[self.facet]
                res = res[:, :, idx * d_len:(idx + 1) * d_len]
        res = F.normalize(res.float(), dim=-1)
        self._hook_out = None
        return res


class _VLAD:
    """VLAD con asignacion dura contra un vocabulario YA calculado —
    sin `fit`, sin cache en disco: los centros vienen dados."""

    def __init__(self, c_centers):
        self.c_centers = c_centers
        self.num_clusters, self.desc_dim = c_centers.shape

    def generate(self, query_descs):
        query_descs = F.normalize(query_descs)
        # Residuo de cada descriptor contra cada centro: [q, c, d]
        residuals = query_descs.unsqueeze(1) - self.c_centers.unsqueeze(0)
        # Asignacion dura: a que centro cae mas cerca cada descriptor
        dist = torch.cdist(query_descs.unsqueeze(0), self.c_centers.unsqueeze(0)).squeeze(0)
        labels = dist.argmin(dim=1)  # [q]

        un_vlad = torch.zeros(self.num_clusters * self.desc_dim)
        for k in labels.unique().tolist():
            cd_sum = residuals[labels == k, k].sum(dim=0)
            cd_sum = F.normalize(cd_sum, dim=0)
            un_vlad[k * self.desc_dim:(k + 1) * self.desc_dim] = cd_sum
        return F.normalize(un_vlad, dim=0)


class Embebedor:
    """Misma interfaz publica que `lumi_pesos.Embebedor` (`.dims`,
    `.vector`, `.vectores`) para que `lumi_embed.py` no tenga que saber
    que este modelo se carga distinto."""

    def __init__(self, ruta_centros, dispositivo):
        self.dims = 32 * 1536  # num_clusters * desc_dim de dinov2_vitg14
        self.dispositivo = dispositivo
        self._extractor = _DinoV2ExtractFeatures("dinov2_vitg14", 31, "value", dispositivo)
        # Solo un tensor de centros de cluster, nunca una clase reconstruida:
        # weights_only=True basta y evita el unpickling arbitrario de
        # torch.load con weights_only=False.
        c_centers = torch.load(ruta_centros, map_location=dispositivo, weights_only=True)
        self._vlad = _VLAD(c_centers.to(dispositivo))

    def vector(self, ruta_imagen):
        ok, saltadas = self.vectores([ruta_imagen])
        if saltadas:
            raise ValueError(saltadas[0][1])
        return ok[0][1]

    def vectores(self, rutas_imagen):
        """Una imagen a la vez, no en lote: cada imagen aporta un numero
        de parches distinto (depende de su tamano tras el recorte a
        multiplos de 14), y no se pueden apilar en un solo tensor sin
        forzarlas todas al mismo tamano — el propio AnyLoc original
        tampoco las agrupa por el mismo motivo."""
        from PIL import Image
        from torchvision import transforms as tvf
        from torchvision.transforms import functional as T

        base_tf = tvf.Compose([
            tvf.ToTensor(),
            tvf.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
        ])
        ok, saltadas = [], []
        for ruta in rutas_imagen:
            try:
                img = Image.open(ruta).convert("RGB")
                img_pt = base_tf(img).to(self.dispositivo)
                max_lado = 700
                if max(img_pt.shape[-2:]) > max_lado:
                    c, h, w = img_pt.shape
                    if h >= w:
                        w, h = int(w * max_lado / h), max_lado
                    else:
                        h, w = int(h * max_lado / w), max_lado
                    img_pt = T.resize(img_pt, (h, w), interpolation=T.InterpolationMode.BICUBIC)
                c, h, w = img_pt.shape
                h_new, w_new = (h // 14) * 14, (w // 14) * 14
                img_pt = tvf.CenterCrop((h_new, w_new))(img_pt)[None, ...]
                descs = self._extractor(img_pt)  # [1, num_parches, 1536]
                vector = self._vlad.generate(descs.squeeze(0))
                ok.append((ruta, vector.cpu().tolist()))
            except Exception as e:
                saltadas.append((ruta, str(e)))
        return ok, saltadas
