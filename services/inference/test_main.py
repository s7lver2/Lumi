# services/inference/test_main.py
import base64
import numpy as np
from fastapi.testclient import TestClient
import main
from main import *
import pytest
from fastapi import HTTPException


class _FakeModel:
    """Records how many images it was asked to embed in total (for the augment test)."""

    def __init__(self):
        self.total_images_seen = 0

    def __call__(self, batch):
        self.total_images_seen += len(batch)
        return [np.ones(8448, dtype=np.float64) * (i + 1) for i in range(len(batch))]


@pytest.fixture
def fake_model():
    return _FakeModel()


@pytest.fixture
def client(fake_model):
    # Deliberately NOT `with TestClient(...) as c:` — entering the context
    # manager runs the real ASGI lifespan, which triggers main.py's startup
    # handler and tries to download/load the REAL MegaLoc + RoMa weights over
    # the network. That's unnecessary here: dependency_overrides replaces
    # get_retrieval_model entirely, so the route never touches _model_holder
    # regardless of whether startup ran or even succeeded.
    main.app.dependency_overrides[main.get_retrieval_model] = lambda: fake_model
    yield TestClient(main.app)
    main.app.dependency_overrides.clear()


class FakeModel:
    """Returns a fixed, NON-unit-norm vector per image so the test can prove main.py normalizes it."""

    def __call__(self, batch):
        # batch: torch-like stand-in, len(batch) images -> one 4-d vector each
        return np.array([[3.0, 0.0, 4.0, 0.0] for _ in range(len(batch))])


def _override_model():
    return FakeModel()


app.dependency_overrides[get_retrieval_model] = _override_model
_module_client = TestClient(app)


def _fake_image_base64() -> str:
    # 1x1 pixel PNG, content doesn't matter — main.py only needs valid image bytes to decode.
    png_1x1 = bytes.fromhex(
        "89504e470d0a1a0a0000000d49484452000000010000000108020000009077"
        "53de0000000c4944415478da6360606060000000050001a5f645400000000049454e44ae426082"
    )
    return base64.b64encode(png_1x1).decode("ascii")


def test_embed_returns_one_l2_normalized_vector_per_image():
    img = _fake_image_base64()
    res = _module_client.post("/embed", json={"images_base64": [img, img]})

    assert res.status_code == 200
    body = res.json()
    assert len(body["embeddings"]) == 2
    for vec in body["embeddings"]:
        norm = sum(v * v for v in vec) ** 0.5
        assert abs(norm - 1.0) < 1e-6  # [3,0,4,0] has norm 5 -> normalized to unit length


def test_embed_rejects_an_empty_batch():
    res = _module_client.post("/embed", json={"images_base64": []})
    assert res.status_code == 400


def test_embed_rejects_invalid_base64():
    res = _module_client.post("/embed", json={"images_base64": ["not-valid-base64!!"]})
    assert res.status_code == 400

def test_embed_with_augment_runs_the_model_on_three_variants_per_image(client, fake_model):
    # fake_model records how many images it was asked to embed in total.
    import base64, io
    from PIL import Image

    buf = io.BytesIO()
    Image.new("RGB", (8, 8), (120, 30, 200)).save(buf, format="PNG")
    b64 = base64.b64encode(buf.getvalue()).decode()

    resp = client.post("/embed", json={"images_base64": [b64], "augment": True})
    assert resp.status_code == 200
    # one query image -> 3 augmented variants passed to the model
    assert fake_model.total_images_seen == 3
    # a single averaged, unit-length descriptor comes back
    out = resp.json()["embeddings"]
    assert len(out) == 1
    import numpy as np
    assert np.isclose(np.linalg.norm(np.array(out[0])), 1.0, atol=1e-6)

def test_verify_scores_each_candidate_in_order(monkeypatch):
    import base64, io
    import numpy as np
    from PIL import Image
    from fastapi.testclient import TestClient
    import main

    def b64_solid(color):
        buf = io.BytesIO()
        Image.new("RGB", (32, 32), color).save(buf, format="PNG")
        return base64.b64encode(buf.getvalue()).decode()

    # fake RoMa-shaped matcher returned by get_verification_model:
    grid = np.array([[x, y] for x in range(0, 30, 5) for y in range(0, 30, 5)], dtype=np.float64)

    class FakeMatcher:
        def match_points(self, a, b):
            return grid.copy(), grid.copy() + np.array([2.0, 2.0])

    main.app.dependency_overrides[main.get_verification_model] = lambda: FakeMatcher()
    try:
        # No `with ... as c:` here either — same reason as the client fixture
        # above: entering the lifespan would try to download real MegaLoc +
        # RoMa weights, which this test doesn't need since it overrides
        # get_verification_model directly.
        c = TestClient(main.app)
        resp = c.post(
            "/verify",
            json={
                "query_image_base64": b64_solid((10, 20, 30)),
                "candidate_images_base64": [b64_solid((10, 20, 30)), b64_solid((200, 0, 0))],
            },
        )
        assert resp.status_code == 200
        results = resp.json()["results"]
        assert len(results) == 2
        assert all("score" in r and "inliers" in r for r in results)
    finally:
        main.app.dependency_overrides.clear()

def _reset_model_holder(**overrides):
    main._model_holder.clear()
    main._model_holder.update(overrides)
    main._active_kind = None
    main._loading_kind = None


class _FakeTorchModel:
    """Stand-in for a real torch model in _ensure_active_model tests.

    _load_kind() calls .to(device)/.eval() unconditionally on whatever
    load_retrieval_model() returns, so a bare string mock (as used for
    load_verification_model, which _load_kind never calls .to()/.eval()
    on) can't stand in here — this supports the same chainable API a real
    torch.nn.Module has while still comparing equal by name for asserts.
    """

    def __init__(self, name):
        self.name = name

    def to(self, device):
        return self

    def eval(self):
        return self

    def __eq__(self, other):
        return isinstance(other, _FakeTorchModel) and self.name == other.name

    def __repr__(self):
        return f"_FakeTorchModel({self.name!r})"


def test_ensure_active_model_off_mode_never_unloads(monkeypatch):
    # Off mode: both kinds stay cached forever once loaded (today's exact
    # existing behavior) — switching kinds must NOT delete the other.
    _reset_model_holder(low_vram_mode=False, retrieval_model_id="lumi-preview", verification_model_id="laila")
    monkeypatch.setattr(main, "load_retrieval_model", lambda model_id: _FakeTorchModel("retrieval-instance"))
    monkeypatch.setattr(main, "load_verification_model", lambda model_id: "verification-instance")

    r = main._ensure_active_model("retrieval")
    v = main._ensure_active_model("verification")
    r_again = main._ensure_active_model("retrieval")

    assert r == _FakeTorchModel("retrieval-instance")
    assert v == "verification-instance"
    assert r_again == _FakeTorchModel("retrieval-instance")
    assert "model" in main._model_holder
    assert "verification_model" in main._model_holder


def test_ensure_active_model_same_kind_never_reloads(monkeypatch):
    _reset_model_holder(low_vram_mode=True, retrieval_model_id="lumi-preview", verification_model_id="laila")
    calls = []
    monkeypatch.setattr(
        main,
        "load_retrieval_model",
        lambda model_id: calls.append(model_id) or _FakeTorchModel("retrieval-instance"),
    )

    main._ensure_active_model("retrieval")
    main._ensure_active_model("retrieval")
    main._ensure_active_model("retrieval")

    assert calls == ["lumi-preview"]  # loaded exactly once across 3 same-kind calls


def test_ensure_active_model_on_mode_unloads_previous_kind_on_switch(monkeypatch):
    _reset_model_holder(low_vram_mode=True, retrieval_model_id="lumi-preview", verification_model_id="laila")
    monkeypatch.setattr(main, "load_retrieval_model", lambda model_id: _FakeTorchModel("retrieval-instance"))
    monkeypatch.setattr(main, "load_verification_model", lambda model_id: "verification-instance")

    main._ensure_active_model("retrieval")
    assert "model" in main._model_holder

    main._ensure_active_model("verification")
    assert "model" not in main._model_holder  # unloaded on switch
    assert "verification_model" in main._model_holder


def test_ensure_active_model_raises_503_on_oom(monkeypatch):
    _reset_model_holder(low_vram_mode=True, retrieval_model_id="lumi-preview", verification_model_id="laila")

    def _raise_oom(model_id):
        raise torch.cuda.OutOfMemoryError("CUDA out of memory")

    monkeypatch.setattr(main, "load_retrieval_model", _raise_oom)

    with pytest.raises(HTTPException) as exc_info:
        main._ensure_active_model("retrieval")
    assert exc_info.value.status_code == 503
    assert "No hay memoria de GPU suficiente" in exc_info.value.detail


def test_model_status_reports_low_vram_mode_and_no_loading_when_idle():
    _reset_model_holder(low_vram_mode=True)
    res = _module_client.get("/model-status")
    assert res.status_code == 200
    assert res.json() == {"loading": None, "lowVramMode": True}