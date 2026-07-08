# services/inference/test_main.py
import base64
import numpy as np
from fastapi.testclient import TestClient
from main import app, get_retrieval_model


class FakeModel:
    """Returns a fixed, NON-unit-norm vector per image so the test can prove main.py normalizes it."""

    def __call__(self, batch):
        # batch: torch-like stand-in, len(batch) images -> one 4-d vector each
        return np.array([[3.0, 0.0, 4.0, 0.0] for _ in range(len(batch))])


def _override_model():
    return FakeModel()


app.dependency_overrides[get_retrieval_model] = _override_model
client = TestClient(app)


def _fake_image_base64() -> str:
    # 1x1 pixel PNG, content doesn't matter — main.py only needs valid image bytes to decode.
    png_1x1 = bytes.fromhex(
        "89504e470d0a1a0a0000000d49484452000000010000000108020000009077"
        "53de0000000c4944415478da6360606060000000050001a5f645400000000049454e44ae426082"
    )
    return base64.b64encode(png_1x1).decode("ascii")


def test_embed_returns_one_l2_normalized_vector_per_image():
    img = _fake_image_base64()
    res = client.post("/embed", json={"images_base64": [img, img]})

    assert res.status_code == 200
    body = res.json()
    assert len(body["embeddings"]) == 2
    for vec in body["embeddings"]:
        norm = sum(v * v for v in vec) ** 0.5
        assert abs(norm - 1.0) < 1e-6  # [3,0,4,0] has norm 5 -> normalized to unit length


def test_embed_rejects_an_empty_batch():
    res = client.post("/embed", json={"images_base64": []})
    assert res.status_code == 400


def test_embed_rejects_invalid_base64():
    res = client.post("/embed", json={"images_base64": ["not-valid-base64!!"]})
    assert res.status_code == 400