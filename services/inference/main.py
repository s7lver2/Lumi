# services/inference/main.py
import base64
import binascii
import io

import numpy as np
from fastapi import Depends, FastAPI, HTTPException
from PIL import Image
from pydantic import BaseModel

from loader import load_retrieval_model
from settings import get_active_model_ids

app = FastAPI(title="netryx-fork inference service")

_model_holder: dict = {}


class EmbedRequest(BaseModel):
    images_base64: list[str]


class EmbedResponse(BaseModel):
    embeddings: list[list[float]]


def get_retrieval_model():
    """
    Overridden in tests via app.dependency_overrides. In production this is
    populated once at startup by the lifespan handler below — never per
    request (spec §6.2, §14.5, §15.4).
    """
    if "model" not in _model_holder:
        raise HTTPException(status_code=503, detail="Retrieval model not loaded yet")
    return _model_holder["model"]


@app.on_event("startup")
def load_model_once() -> None:
    import psycopg2
    import os

    conn = psycopg2.connect(
        host=os.environ.get("POSTGRES_HOST", "localhost"),
        port=os.environ.get("POSTGRES_PORT", "5432"),
        user=os.environ.get("POSTGRES_USER", "netryx"),
        password=os.environ.get("POSTGRES_PASSWORD", "changeme"),
        dbname=os.environ.get("POSTGRES_DB", "netryx_dev"),
    )
    try:
        retrieval_model_id, _verification_model_id = get_active_model_ids(conn)
    finally:
        conn.close()

    _model_holder["model"] = load_retrieval_model(retrieval_model_id)


def _decode_image(image_base64: str) -> np.ndarray:
    try:
        raw = base64.b64decode(image_base64, validate=True)
        img = Image.open(io.BytesIO(raw)).convert("RGB")
        return np.array(img)
    except (binascii.Error, ValueError, OSError) as exc:
        raise HTTPException(status_code=400, detail=f"Invalid image data: {exc}") from exc


@app.post("/embed", response_model=EmbedResponse)
def embed(request: EmbedRequest, model=Depends(get_retrieval_model)) -> EmbedResponse:
    if len(request.images_base64) == 0:
        raise HTTPException(status_code=400, detail="images_base64 must not be empty")

    batch = [_decode_image(img) for img in request.images_base64]
    raw_vectors = model(batch)

    embeddings = []
    for vec in raw_vectors:
        vec = np.asarray(vec, dtype=np.float64)
        norm = np.linalg.norm(vec)
        normalized = vec / norm if norm > 0 else vec
        embeddings.append(normalized.tolist())

    return EmbedResponse(embeddings=embeddings)