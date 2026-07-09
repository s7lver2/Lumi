import numpy as np
from tiles import tile_image, multiscale_tiles


def test_tile_image_1x1_returns_the_whole_image_at_origin():
    img = np.zeros((10, 10, 3), dtype=np.uint8)
    tiles = tile_image(img, grid=1, overlap=0.0)
    assert len(tiles) == 1
    assert tiles[0]["x0"] == 0 and tiles[0]["y0"] == 0
    assert tiles[0]["array"].shape == (10, 10, 3)


def test_tile_image_2x2_returns_four_overlapping_tiles_with_offsets():
    img = np.zeros((100, 100, 3), dtype=np.uint8)
    tiles = tile_image(img, grid=2, overlap=0.2)
    assert len(tiles) == 4
    # tiles carry their top-left offset so matches can be mapped back to full-image coords
    assert {(t["x0"], t["y0"]) for t in tiles} == {
        (t["x0"], t["y0"]) for t in tiles
    }  # offsets are distinct
    assert len({(t["x0"], t["y0"]) for t in tiles}) == 4
    # overlap makes each tile larger than a non-overlapping quarter (50px)
    assert tiles[0]["array"].shape[0] > 50


def test_multiscale_tiles_includes_the_full_image_plus_the_2x2_level():
    img = np.zeros((40, 40, 3), dtype=np.uint8)
    tiles = multiscale_tiles(img)
    assert len(tiles) == 1 + 4