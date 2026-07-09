# services/inference/test_verify.py
import numpy as np
from verify import verify_pair, calibrate_score, DEFAULT_VERIFY_CONFIG


def test_calibrate_score_rises_with_inliers_and_falls_with_error():
    low = calibrate_score(10, 3.0, DEFAULT_VERIFY_CONFIG)
    more_inliers = calibrate_score(80, 3.0, DEFAULT_VERIFY_CONFIG)
    more_error = calibrate_score(10, 12.0, DEFAULT_VERIFY_CONFIG)
    assert 0.0 <= low <= 1.0
    assert more_inliers > low
    assert more_error < low


def test_verify_pair_scores_a_strong_match_high():
    # A fake matcher returns a rigid, near-perfect set of correspondences:
    # candidate points = query points shifted by (5, 5) -> a clean homography.
    # Dense enough (2500 points/tile-pair x 5 tile-pairs) to clear
    # score_inlier_saturation=3000 — real RoMa runs routinely produce inlier
    # counts in the thousands (spec §15.2 note in verify.py), so a "strong
    # match" fixture needs to be dense at that same order of magnitude to mean
    # anything, not just clear an arbitrarily low bar.
    grid = np.array([[x, y] for x in range(0, 100, 2) for y in range(0, 100, 2)], dtype=np.float64)

    def matcher(tile_a, tile_b):
        return grid.copy(), grid.copy() + np.array([5.0, 5.0])

    query = np.zeros((100, 100, 3), dtype=np.uint8)
    candidate = np.zeros((100, 100, 3), dtype=np.uint8)
    result = verify_pair(query, candidate, matcher)
    assert result["inliers"] >= 3000
    assert result["reproj_error"] < 1.0
    assert result["score"] > 0.5


def test_verify_pair_scores_no_matches_zero():
    def matcher(tile_a, tile_b):
        return np.zeros((0, 2)), np.zeros((0, 2))

    query = np.zeros((20, 20, 3), dtype=np.uint8)
    result = verify_pair(query, query, matcher)
    assert result["inliers"] == 0
    assert result["score"] == 0.0