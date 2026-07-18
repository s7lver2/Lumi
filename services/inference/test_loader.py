# services/inference/test_loader.py
import pytest
from unittest.mock import MagicMock
from loader import load_retrieval_model, load_verification_model, UnknownModelError


def test_loads_lumi_preview_via_the_megaloc_torch_hub_repo(monkeypatch):
    mock_hub_load = MagicMock(return_value="fake-model-instance")
    monkeypatch.setattr("loader.torch.hub.load", mock_hub_load)

    model = load_retrieval_model("lumi-preview")

    mock_hub_load.assert_called_once_with("gmberton/MegaLoc", "get_trained_model")
    assert model == "fake-model-instance"


def test_raises_a_clear_error_for_an_id_not_in_the_registry():
    with pytest.raises(UnknownModelError, match="not-a-real-model"):
        load_retrieval_model("not-a-real-model")

def test_load_verification_model_rejects_unknown_id():
    with pytest.raises(UnknownModelError):
        load_verification_model("does-not-exist")


def test_load_verification_model_loads_via_roma_for_any_registered_id(monkeypatch):
    # VERIFICATION_MODELS ships empty (catalog-installed at runtime, see
    # models/registry.py) — this test registers a fake entry itself so it
    # doesn't depend on any specific hardcoded id. We don't download RoMa
    # weights in the unit test; we assert the id is recognized (no
    # UnknownModelError for the registered id) by monkeypatching the
    # romatch.roma_outdoor loader to a sentinel and checking it comes back
    # wrapped in a RomaMatcher exposing match_points (spec §15.2).
    import loader
    monkeypatch.setattr(
        "loader.VERIFICATION_MODELS",
        [{"id": "test-verify", "display_name": "Test", "base_model": "RoMa (frozen)", "status": "stable"}],
    )
    loader._LOAD_ROMA_OUTDOOR = lambda *a, **k: "ROMA_SENTINEL"  # injected hook, see impl
    model = load_verification_model("test-verify")
    assert isinstance(model, loader.RomaMatcher)
    assert model._roma_model == "ROMA_SENTINEL"