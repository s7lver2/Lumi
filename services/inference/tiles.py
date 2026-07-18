"""
Multi-resolution overlapping tiling for RoMa-based verification (spec §15.2). Pure NumPy: no model,
no torch — so it is unit-testable. Each tile carries its (x0, y0) top-left offset
so keypoint matches found in a tile can be mapped back to full-image coordinates.
"""
import numpy as np


def tile_image(img: np.ndarray, grid: int, overlap: float) -> list[dict]:
    h, w = img.shape[0], img.shape[1]
    if grid <= 1:
        return [{"array": img, "x0": 0, "y0": 0}]

    step_x = w / grid
    step_y = h / grid
    pad_x = int(step_x * overlap)
    pad_y = int(step_y * overlap)

    tiles = []
    for gy in range(grid):
        for gx in range(grid):
            x0 = max(0, int(gx * step_x) - pad_x)
            y0 = max(0, int(gy * step_y) - pad_y)
            x1 = min(w, int((gx + 1) * step_x) + pad_x)
            y1 = min(h, int((gy + 1) * step_y) + pad_y)
            tiles.append({"array": img[y0:y1, x0:x1, ...], "x0": x0, "y0": y0})
    return tiles


def _center_tile(img: np.ndarray) -> list[dict]:
    """A single tile over the middle 60% of the image — the subject of a
    Street View comparison is usually centered, so this tends to add a
    useful, distinct viewpoint rather than more of the same edges the 2x2
    grids already cover."""
    h, w = img.shape[0], img.shape[1]
    x0, y0 = int(w * 0.2), int(h * 0.2)
    x1, y1 = int(w * 0.8), int(h * 0.8)
    return [{"array": img[y0:y1, x0:x1, ...], "x0": x0, "y0": y0}]


def multiscale_tiles(img: np.ndarray, passes: int = 5) -> list[dict]:
    """
    Builds up to `passes` tiles (clamped 1-10) from a fixed, front-loaded,
    most-informative-first schedule — NOT by naively growing the grid
    dimension (a 10x10 grid alone would be 100 tiles, ~20x slower for barely
    more precision). Each RoMa tile-pair match costs several seconds (spec:
    services/inference/loader.py's use_custom_corr comments), so this scales
    verification time roughly LINEARLY with `passes`, matching what a
    1-10 slider setting (VERIFICATION_TILE_PASSES) should feel like.

    passes=1: full image only — fastest, least precise.
    passes=5: full image + 2x2 grid (5 tiles) — the ORIGINAL fixed schedule,
    kept as the default so the new setting doesn't change anything for
    existing users unless they actually move the slider.
    passes=6-9: + a second, denser 2x2 grid (heavier overlap) — catches
    matches the first split's tile seams could miss.
    passes=10: + one center-focused crop.
    """
    passes = max(1, min(10, passes))
    schedule = (
        tile_image(img, grid=1, overlap=0.0)
        + tile_image(img, grid=2, overlap=0.2)
        + tile_image(img, grid=2, overlap=0.4)
        + _center_tile(img)
    )
    return schedule[:passes]