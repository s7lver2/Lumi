# services/inference/loader.py
"""
Loads the frozen retrieval backbone selected in system_settings (spec §3.1,
§15.1, §15.3). No fine-tuning happens anywhere in this file — it only
resolves a registry id to a torch.hub call.
"""
import torch
from models.registry import RETRIEVAL_MODELS

from models.registry import RETRIEVAL_MODELS, VERIFICATION_MODELS  # extend existing import

# Indirection so tests can inject a fake instead of hitting the network.
_HUB_LOAD = torch.hub.load


def load_verification_model(model_id: str):
    entry = next((m for m in VERIFICATION_MODELS if m["id"] == model_id), None)
    if entry is None:
        raise UnknownModelError(f"Unknown verification model id: {model_id}")

    if model_id == "laila":
        # Laila wraps frozen RoMa (spec §15.2). Outdoor weights.
        return _HUB_LOAD("Parskatt/RoMa", "roma_outdoor")

    raise UnknownModelError(f"No loader implemented for verification model id: {model_id}")

class UnknownModelError(Exception):
    pass


def load_retrieval_model(model_id: str):
    entry = next((m for m in RETRIEVAL_MODELS if m["id"] == model_id), None)
    if entry is None:
        raise UnknownModelError(f"Unknown retrieval model id: {model_id}")

    if model_id == "lumi-preview":
        return torch.hub.load("gmberton/MegaLoc", "get_trained_model")

    raise UnknownModelError(f"No loader implemented for retrieval model id: {model_id}")