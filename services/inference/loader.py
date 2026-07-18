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
    # Every registry entry present today loads via the same RoMa-based
    # matcher (spec §15.2) — entry is only looked up for existence, never
    # branched on, so adding a second verification model with a different
    # implementation later means adding a real dispatch, not more copies
    # of this function. Wraps frozen RoMa. Uses CUDA when available (this
    # box has an RTX 4070 SUPER) — dense multi-tile matching on CPU is
    # ~9s/tile-pair vs GPU, which makes verify.py's 5-tile pipeline
    # impractically slow on CPU. Falls back to CPU/float32 otherwise
    # (spec §7.1 — Windows-native, CUDA optional, not guaranteed).
    entry = next((m for m in VERIFICATION_MODELS if m["id"] == model_id), None)
    if entry is None:
        raise UnknownModelError(f"Unknown verification model id: {model_id}")

    global _LOAD_ROMA_OUTDOOR
    if _LOAD_ROMA_OUTDOOR is None:
        from romatch import roma_outdoor

        _LOAD_ROMA_OUTDOOR = roma_outdoor
    device = "cuda" if torch.cuda.is_available() else "cpu"
    amp_dtype = torch.float16 if device == "cuda" else torch.float32
    # Visible at startup on purpose: RoMa on CPU is ~9s/tile-pair x 5
    # tiles = ~45s PER CANDIDATE (confirmed live: 92 candidates reading as
    # "stuck" for over an hour). If this ever prints "cpu" unexpectedly on
    # a machine with a GPU, that — not a code bug — is almost certainly
    # why /verify looks hung: check `torch.cuda.is_available()` in this
    # venv (wrong torch build, driver mismatch, etc.).
    # use_custom_corr=True (romatch's own default) needs a separate
    # compiled CUDA extension called "local_corr" — it isn't part of
    # romatch's own pip install (see requirements.txt), and romatch only
    # checks "are we on Linux", not "is local_corr actually importable".
    # Confirmed live under WSL2: /verify crashed with
    # `ModuleNotFoundError: No module named 'local_corr'` the first time
    # a real verification request reached this code path (never
    # surfaced on native Windows, where romatch's own sys.platform check
    # already disables use_custom_corr). local_corr ships as PyPI's
    # `fused-local-corr` package (Linux-only, romatch's own declared
    # extra) — NOT listed in requirements.txt because it hard-pins an
    # exact torch version (torch==2.11.0 as of fused-local-corr 0.3.211)
    # that conflicts with the cu121 torch pin fresh installs use here;
    # it's an opt-in manual install into an existing WSL venv, not part
    # of the standard setup flow. Detecting it at runtime means this
    # works either way: the fast kernel when someone has manually
    # installed fused-local-corr, the safe pure-PyTorch fallback
    # (romatch's own shitty_native_torch_local_corr) everywhere else —
    # same model weights either way, just a different code path for one
    # internal correlation step.
    try:
        import local_corr  # noqa: F401

        use_custom_corr = True
    except ImportError:
        use_custom_corr = False
    print(
        f"[loader] modelo de verificación ({model_id}/RoMa) cargado en "
        f"device={device!r}, use_custom_corr={use_custom_corr!r}"
    )
    roma_model = _LOAD_ROMA_OUTDOOR(device=device, amp_dtype=amp_dtype, use_custom_corr=use_custom_corr)
    return RomaMatcher(roma_model, device)