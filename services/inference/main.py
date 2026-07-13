# services/inference/main.py
import base64
import binascii
import io
import os
import threading
import time


def _apply_custom_cache_dir() -> None:
    """
    Relocates the model weight caches (several GB for MegaLoc + RoMa) off the
    user's default ~/.cache. Default: <repo clone>/data/models-cache, so a
    fresh clone works with zero configuration and keeps the weights inside
    the project checkout instead of scattering them into the user's home
    profile. MODELS_CACHE_DIR (optional) overrides this with any other path.
    When the setup wizard's WSL2 install path spawns this process, it already
    sets TORCH_HOME/HF_HOME itself (through a symlink — see
    apps/web/app/api/setup/run/[step]/route.ts's wslCacheExport), so this
    only computes a fallback for when nobody set them first (e.g. running
    `uvicorn` by hand in a fresh terminal).

    MUST run before `import torch` / anything that pulls in huggingface_hub
    below: huggingface_hub reads HF_HOME into a module-level constant once,
    at import time, not per call, so setting it after import would silently
    do nothing.
    """
    if os.environ.get("TORCH_HOME") and os.environ.get("HF_HOME"):
        return
    base = os.environ.get("MODELS_CACHE_DIR")
    if not base:
        # dirname x3: main.py -> services/inference -> services -> repo root.
        # Resolved relative to THIS file, so it's correct whether this
        # process is a native Windows python.exe or a WSL python3 running
        # against the same checkout mounted at /mnt/<drive>/...
        repo_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        base = os.path.join(repo_root, "data", "models-cache")
    os.environ.setdefault("TORCH_HOME", os.path.join(base, "torch"))
    os.environ.setdefault("HF_HOME", os.path.join(base, "huggingface"))


_apply_custom_cache_dir()

# Confirmed live: repeated OOM/retry cycles on a memory-constrained (6GB)
# GPU fragment PyTorch's caching allocator until even a single-image batch
# fails to find a contiguous free block, despite enough memory being free
# in aggregate. expandable_segments avoids that by growing one virtual
# segment instead of carving out new fixed-size blocks per allocation —
# exactly what the torch.OutOfMemoryError message itself suggests trying.
# Must be set before `import torch` (read once at CUDA init).
os.environ.setdefault("PYTORCH_CUDA_ALLOC_CONF", "expandable_segments:True")

import numpy as np
import psycopg2
import torch
from fastapi import Depends, FastAPI, HTTPException
from PIL import Image
from pydantic import BaseModel

from loader import load_retrieval_model, load_verification_model
from settings import (
    DEFAULT_VERIFICATION_TILE_PASSES,
    get_active_model_ids,
    get_verification_tile_passes,
    get_verify_config,
)
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


_verification_load_lock = threading.Lock()


def _load_verification_model_now() -> None:
    """Loads RoMa/Laila and warms it up — the first time it's actually
    needed, not at startup. See load_model_once() for why this got moved
    out of eager startup loading."""
    verification_model = load_verification_model(_model_holder["verification_model_id"])
    _model_holder["verification_model"] = verification_model
    print("[loader] modelo de verificación (Laila/RoMa) cargado bajo demanda (primer /verify)")

    warmup_start = time.perf_counter()
    try:
        dummy_a = np.zeros((480, 640, 3), dtype=np.uint8)
        dummy_b = np.zeros((480, 640, 3), dtype=np.uint8)
        verification_model.match_points(dummy_a, dummy_b)
        print(f"[loader] modelo de verificación calentado en {time.perf_counter() - warmup_start:.2f}s")
    except Exception as exc:  # pragma: no cover - best-effort warmup, never fatal
        print(f"[loader] no se pudo calentar el modelo de verificación: {exc}")


def get_verification_model():
    # Lazy, not loaded in load_model_once() alongside the retrieval model:
    # holding both MegaLoc + RoMa resident on GPU at once leaves too little
    # headroom on smaller cards. Confirmed live on a 6GB laptop GPU: with
    # both loaded, even a single-image /embed call OOM'd inside MegaLoc's
    # own aggregation layer ("CUDA out of memory... this process has 2.53
    # GiB memory in use" with under 250MiB free). Indexing (/embed) never
    # touches the verification model at all — deferring its load to the
    # first real /verify call (the "Refinar" action, already an on-demand,
    # not hot-path, request) frees that memory for every /embed call
    # indexing makes instead.
    if "verification_model" not in _model_holder:
        if "verification_model_id" not in _model_holder:
            raise HTTPException(status_code=503, detail="Verification model not configured yet")
        with _verification_load_lock:
            if "verification_model" not in _model_holder:
                _load_verification_model_now()
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
        _model_holder["verification_tile_passes"] = get_verification_tile_passes(conn)
        _model_holder["verify_config"] = get_verify_config(conn)
    finally:
        conn.close()

    # Inicialización en caliente de los modelos dentro del contenedor persistente
    retrieval_model = load_retrieval_model(retrieval_model_id)
    # load_retrieval_model() (loader.py) never moves MegaLoc off the CPU it's
    # loaded on by default — unlike load_verification_model(), which already
    # does this for RoMa. Confirmed live: /embed was running the retrieval
    # backbone on CPU even with an RTX 4070 SUPER present, making each
    # embedding chunk take much longer than it should. Moved here (not in
    # loader.py) so test_loader.py's MagicMock-returned "fake-model-instance"
    # string stand-in doesn't need a real .to()/.eval() to keep passing.
    retrieval_device = "cuda" if torch.cuda.is_available() else "cpu"
    retrieval_model = retrieval_model.to(retrieval_device)
    retrieval_model.eval()
    print(f"[loader] modelo de recuperación (Lumi Preview/MegaLoc) cargado en device={retrieval_device!r}")
    _model_holder["model"] = retrieval_model
    # Verification (RoMa/Laila) is NOT loaded here — see get_verification_model()'s
    # lazy-load docstring for why holding both models resident at once is a
    # real GPU-memory problem on smaller cards.
    _model_holder["verification_model_id"] = verification_model_id
    print(f"[loader] pasadas de verificación (VERIFICATION_TILE_PASSES) = {_model_holder['verification_tile_passes']}")
    print(f"[loader] calibración de verificación = {_model_holder['verify_config']}")


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
    try:
        # Move the input batch onto whatever device load_model_once() put the
        # real model on (see there for why this matters). Test doubles in
        # test_main.py are plain callables with no .parameters(), so this is
        # a no-op for them (batch stays on CPU, which is all they expect).
        batch = batch.to(next(model.parameters()).device)
    except (AttributeError, StopIteration):
        pass
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
    total = len(request.candidate_images_base64)
    request_start = time.perf_counter()
    for i, c_b64 in enumerate(request.candidate_images_base64):
        candidate_start = time.perf_counter()
        candidate = _decode_image(c_b64)
        # .get(), not a direct index: test_main.py's /verify tests override
        # get_verification_model without running the real startup lifespan
        # (deliberately, to avoid downloading real weights — see its own
        # comments), so _model_holder never gets these keys set in that case.
        passes = _model_holder.get("verification_tile_passes", DEFAULT_VERIFICATION_TILE_PASSES)
        verify_config = _model_holder.get("verify_config")  # None -> verify_pair uses its own DEFAULT_VERIFY_CONFIG
        r = verify_pair(query, candidate, matcher, config=verify_config, passes=passes)
        elapsed = time.perf_counter() - candidate_start
        results.append(VerifyResult(**r))
        # Visible per-candidate, not just per-request: RoMa on CPU can take
        # tens of seconds PER candidate, so a request of even 8 could run
        # for minutes with zero output otherwise — confirmed live reading as
        # a hang with no way to tell it apart from a genuine crash. Timing is
        # here specifically to tell apart "slow but working on GPU" from
        # "still bottlenecked somewhere even with CUDA".
        print(f"[verify] {i + 1}/{total} candidatos verificados ({elapsed:.2f}s)")
    print(f"[verify] request completa: {total} candidatos en {time.perf_counter() - request_start:.2f}s")
    return VerifyResponse(results=results)