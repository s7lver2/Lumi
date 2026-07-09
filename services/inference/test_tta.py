import numpy as np
from tta import augment_variants, mean_normalize


def test_augment_variants_returns_original_flip_and_crop():
    img = np.arange(4 * 4 * 3, dtype=np.uint8).reshape(4, 4, 3)
    variants = augment_variants(img)
    assert len(variants) == 3
    # variant 0 is the original
    assert np.array_equal(variants[0], img)
    # variant 1 is the horizontal flip (columns reversed)
    assert np.array_equal(variants[1], img[:, ::-1, :])
    # variant 2 (center crop) is smaller than the original in both spatial dims
    assert variants[2].shape[0] < img.shape[0]
    assert variants[2].shape[1] < img.shape[1]


def test_mean_normalize_produces_a_unit_vector():
    vecs = [np.array([3.0, 0.0]), np.array([0.0, 4.0])]
    out = mean_normalize(vecs)
    assert np.isclose(np.linalg.norm(out), 1.0)