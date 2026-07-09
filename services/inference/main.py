# services/inference/main.py
import base64
import binascii
import io
import os

import numpy as np
import psycopg2
import torch
from fastapi import Depends, FastAPI, HTTPException
from PIL import Image
from pydantic import BaseModel

from loader import load_retrieval_model, load_verification_model 
from settings import get_active_model_ids
from tta import augment_variants, mean_normalize 
from verify import verify_pair


app = FastAPI(title="netryx-fork inference service")

_model_holder: dict = {}


class EmbedRequest(BaseModel):
    images_base64: list[str]
    augment: bool = False  # Lumi Preview query TTA (spec §15.1); off for index images


class EmbedResponse(BaseModel):
    embeddings: list[list[float]]


class VerifyRequest(BaseModel):
    query_image_base64: str
    candidate_images_base64: list[str]


class VerifyResult(BaseModel):
    inliers: int
    reproj_error: float
    score: float


class VerifyResponse(BaseModel):
    results: list[VerifyResult]


def get_verification_model():
    if "verification_model" not in _model_holder:
        raise HTTPException(status_code=503, detail="Verification model not loaded yet")
    return _model_holder["verification_model"]


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
    """
    Loads both retrieval and verification models exactly once during application
    startup using the credentials and identifiers retrieved from the database
    (spec §14.5, §15.4).
    """
    conn = psycopg2.connect(
        host=os.environ.get("POSTGRES_HOST", "localhost"),
        port=os.environ.get("POSTGRES_PORT", "5432"),
        user=os.environ.get("POSTGRES_USER", "netryx"),
        password=os.environ.get("POSTGRES_PASSWORD", "changeme"),
        dbname=os.environ.get("POSTGRES_DB", "netryx_dev"),
    )
    try:
        # Extraemos ambos IDs usando la misma conexión según especificación
        retrieval_model_id, verification_model_id = get_active_model_ids(conn)
    finally:
        conn.close()

    # Inicialización en caliente de los modelos dentro del contenedor persistente
    _model_holder["model"] = load_retrieval_model(retrieval_model_id)
    _model_holder["verification_model"] = load_verification_model(verification_model_id)


def _decode_image(image_base64: str) -> np.ndarray:
    try:
        raw = base64.b64decode(image_base64, validate=True)
        img = Image.open(io.BytesIO(raw)).convert("RGB")
        return np.array(img)
    except (binascii.Error, ValueError, OSError) as exc:
        raise HTTPException(status_code=400, detail=f"Invalid image data: {exc}") from exc


_IMAGENET_MEAN = np.array([0.485, 0.456, 0.406], dtype=np.float32)
_IMAGENET_STD = np.array([0.229, 0.224, 0.225], dtype=np.float32)
_MODEL_INPUT_SIZE = 224


def _to_model_batch(images: list[np.ndarray]) -> torch.Tensor:
    tensors = []
    for img in images:
        resized = Image.fromarray(img).resize((_MODEL_INPUT_SIZE, _MODEL_INPUT_SIZE), Image.BILINEAR)
        arr = np.asarray(resized, dtype=np.float32) / 255.0
        arr = (arr - _IMAGENET_MEAN) / _IMAGENET_STD
        tensors.append(torch.from_numpy(arr.transpose(2, 0, 1)).float())
    return torch.stack(tensors, dim=0)


def _run_model(model, images: list[np.ndarray]) -> np.ndarray:
    batch = _to_model_batch(images)
    with torch.no_grad():
        output = model(batch)
    if isinstance(output, torch.Tensor):
        output = output.detach().cpu().numpy()
    return np.asarray(output, dtype=np.float64)


@app.post("/embed", response_model=EmbedResponse)
def embed(request: EmbedRequest, model=Depends(get_retrieval_model)) -> EmbedResponse:
    if len(request.images_base64) == 0:
        raise HTTPException(status_code=400, detail="images_base64 must not be empty")

    images = [_decode_image(img) for img in request.images_base64]

    if request.augment:
        embeddings = []
        for img in images:
            variants = augment_variants(img)
            raw_vectors = _run_model(model, variants)
            embeddings.append(mean_normalize(raw_vectors).tolist())
        return EmbedResponse(embeddings=embeddings)

    raw_vectors = _run_model(model, images)
    embeddings = []
    for vec in raw_vectors:
        vec = np.asarray(vec, dtype=np.float64)
        norm = np.linalg.norm(vec)
        normalized = vec / norm if norm > 0 else vec
        embeddings.append(normalized.tolist())
    return EmbedResponse(embeddings=embeddings)


def _roma_matcher_adapter(model):
    def matcher(tile_a: np.ndarray, tile_b: np.ndarray):
        return model.match_points(tile_a, tile_b)
    return matcher


@app.post("/verify", response_model=VerifyResponse)
def verify(request: VerifyRequest, model=Depends(get_verification_model)) -> VerifyResponse:
    query = _decode_image(request.query_image_base64)
    if len(request.candidate_images_base64) == 0:
        raise HTTPException(status_code=400, detail="candidate_images_base64 must not be empty")

    matcher = _roma_matcher_adapter(model)
    results = []
    for c_b64 in request.candidate_images_base64:
        candidate = _decode_image(c_b64)
        r = verify_pair(query, candidate, matcher)
        results.append(VerifyResult(**r))
    return VerifyResponse(results=results)