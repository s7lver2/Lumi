# services/inference/loader.py
"""
Loads the frozen retrieval/verification backbones selected in system_settings
(spec §3.1, §3.2, §15.1-§15.3). No fine-tuning happens anywhere in this file —
it only resolves a registry id to the right model-loading call.
"""
import torch
from models.registry import RETRIEVAL_MODELS, VERIFICATION_MODELS


class UnknownModelError(Exception):
    pass


def load_retrieval_model(model_id: str):
    entry = next((m for m in RETRIEVAL_MODELS if m["id"] == model_id), None)
    if entry is None:
        raise UnknownModelError(f"Unknown retrieval model id: {model_id}")

    if model_id == "lumi-preview":
        # Called as torch.hub.load(...), not through a pre-bound reference,
        # so test_loader.py's monkeypatch.setattr("loader.torch.hub.load", ...)
        # can intercept it.
        return torch.hub.load("gmberton/MegaLoc", "get_trained_model")

    raise UnknownModelError(f"No loader implemented for retrieval model id: {model_id}")


class RomaMatcher:
    """
    Wraps romatch's roma_outdoor model with the match_points(img_a, img_b) ->
    (pts_a, pts_b) contract verify.py's tile-based matcher expects (spec
    §15.2) — pixel-coordinate correspondences as (N, 2) numpy arrays.
    """

    def __init__(self, roma_model, device: str):
        self._roma_model = roma_model
        self._device = device

    def match_points(self, img_a, img_b):
        from PIL import Image

        im_a = Image.fromarray(img_a)
        im_b = Image.fromarray(img_b)
        h_a, w_a = img_a.shape[0], img_a.shape[1]
        h_b, w_b = img_b.shape[0], img_b.shape[1]

        warp, certainty = self._roma_model.match(im_a, im_b, device=self._device)
        matches, certainty = self._roma_model.sample(warp, certainty)
        kpts_a, kpts_b = self._roma_model.to_pixel_coordinates(matches, h_a, w_a, h_b, w_b)
        return kpts_a.detach().cpu().numpy(), kpts_b.detach().cpu().numpy()


# Indirection so tests can inject a fake instead of downloading real weights.
# Lazily resolved: romatch's `main` branch on GitHub dropped hubconf.py, so
# unlike MegaLoc this is NOT a torch.hub call — it's installed from PyPI
# (see requirements.txt) and imported directly.
_LOAD_ROMA_OUTDOOR = None


def load_verification_model(model_id: str):
    entry = next((m for m in VERIFICATION_MODELS if m["id"] == model_id), None)
    if entry is None:
        raise UnknownModelError(f"Unknown verification model id: {model_id}")

    if model_id == "laila":
        # Laila wraps frozen RoMa (spec §15.2). Uses CUDA when available (this
        # box has an RTX 4070 SUPER) — dense multi-tile matching on CPU is
        # ~9s/tile-pair vs GPU, which makes verify.py's 5-tile pipeline
        # impractically slow on CPU. Falls back to CPU/float32 otherwise
        # (spec §7.1 — Windows-native, CUDA optional, not guaranteed).
        global _LOAD_ROMA_OUTDOOR
        if _LOAD_ROMA_OUTDOOR is None:
            from romatch import roma_outdoor

            _LOAD_ROMA_OUTDOOR = roma_outdoor
        device = "cuda" if torch.cuda.is_available() else "cpu"
        amp_dtype = torch.float16 if device == "cuda" else torch.float32
        roma_model = _LOAD_ROMA_OUTDOOR(device=device, amp_dtype=amp_dtype)
        return RomaMatcher(roma_model, device)

    raise UnknownModelError(f"No loader implemented for verification model id: {model_id}")