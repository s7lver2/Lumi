# services/inference/tta.py
"""
Test-time augmentation for query images (Lumi Preview, spec §15.1). Pure NumPy —
no torch, no model — so it is unit-testable without loading MegaLoc. Applied only
to the user's query image, never to index images (those stay single-pass, spec §4).
"""
import numpy as np


def augment_variants(img: np.ndarray) -> list[np.ndarray]:
    """Original + horizontal flip + center crop (80% of each spatial dim)."""
    h, w = img.shape[0], img.shape[1]
    ch, cw = int(h * 0.8), int(w * 0.8)
    top, left = (h - ch) // 2, (w - cw) // 2
    center_crop = img[top : top + ch, left : left + cw, ...]
    return [img, img[:, ::-1, ...], center_crop]


def mean_normalize(vectors: list[np.ndarray]) -> np.ndarray:
    """Mean of the vectors, L2-normalized (matches how /embed normalizes)."""
    stacked = np.stack([np.asarray(v, dtype=np.float64) for v in vectors], axis=0)
    mean = stacked.mean(axis=0)
    norm = np.linalg.norm(mean)
    return mean / norm if norm > 0 else mean