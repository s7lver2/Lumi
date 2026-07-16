# services/inference/test_registry.py
from models.registry import RETRIEVAL_MODELS


def test_every_retrieval_model_has_a_version():
    for model in RETRIEVAL_MODELS:
        assert isinstance(model.get("version"), str)
        assert model["version"] != ""
