# services/inference/test_main.py
import base64
import numpy as np
from fastapi.testclient import TestClient
import main
from main import *
import pytest


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