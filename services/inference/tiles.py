"""
Multi-resolution overlapping tiling for Laila (spec §15.2). Pure NumPy: no model,
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


def multiscale_tiles(img: np.ndarray) -> list[dict]:
    """Full image (grid 1) + a 2x2 overlapping level (spec §15.2)."""
    return tile_image(img, grid=1, overlap=0.0) + tile_image(img, grid=2, overlap=0.2)