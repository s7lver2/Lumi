# services/inference/test_loader.py
import pytest
from unittest.mock import MagicMock
from loader import load_retrieval_model, UnknownModelError


def test_loads_lumi_preview_via_the_megaloc_torch_hub_repo(monkeypatch):
    mock_hub_load = MagicMock(return_value="fake-model-instance")
    monkeypatch.setattr("loader.torch.hub.load", mock_hub_load)

    model = load_retrieval_model("lumi-preview")

    mock_hub_load.assert_called_once_with("gmberton/MegaLoc", "get_trained_model")
    assert model == "fake-model-instance"


def test_raises_a_clear_error_for_an_id_not_in_the_registry():
    with pytest.raises(UnknownModelError, match="not-a-real-model"):
        load_retrieval_model("not-a-real-model")