"""
Laila geometric verification (spec §15.2): aggregate multi-resolution tile
matches, fit a homography with MAGSAC++, and turn (inliers, reprojection error)
into a calibrated confidence score. The matcher (RoMa) is injected so this file
is unit-testable without model weights.

The score is a principled default, calibrated once against one real data point
(spec §15.2 says full calibration happens on real indexed areas, this is a
first pass, not the final word): running the full pipeline with real RoMa on
GPU against a genuine same-scene pair vs. an unrelated pair (RoMa's own
sacre_coeur_A/B.jpg vs. toronto_A.jpg sample images) gave 15,633 inliers for
the true match vs. 681 for the unrelated one — a ~23x gap that the original
score_inlier_saturation=100 couldn't see at all (both saturated to 1.0, since
RoMa's dense multi-tile matching routinely produces inlier counts in the
hundreds to tens of thousands, nothing like classical sparse-feature matchers).
score_inlier_saturation=3000 makes that real gap visible (~0.82 vs ~0.19).
"""
import cv2
import numpy as np

from tiles import multiscale_tiles

DEFAULT_VERIFY_CONFIG = {
    "magsac_reproj_threshold": 3.0,  # px
    "score_inlier_saturation": 3000.0,  # inliers at which the inlier term maxes out
    "score_error_scale": 8.0,  # px; reprojection error that halves the error term
    "min_inliers_for_score": 4,  # below this, homography isn't trustworthy -> score 0
}


def calibrate_score(inliers: int, reproj_error: float, config: dict) -> float:
    if inliers < config["min_inliers_for_score"]:
        return 0.0
    inlier_term = min(inliers / config["score_inlier_saturation"], 1.0)
    error_term = config["score_error_scale"] / (config["score_error_scale"] + reproj_error)
    return float(inlier_term * error_term)


def _collect_matches(query_img, candidate_img, matcher, passes: int = 5):
    q_tiles = multiscale_tiles(query_img, passes)
    c_tiles = multiscale_tiles(candidate_img, passes)
    pts_q, pts_c = [], []
    # match tile-for-tile at the same scale/position index
    for qt, ct in zip(q_tiles, c_tiles):
        a, b = matcher(qt["array"], ct["array"])
        if len(a) == 0:
            continue
        a = np.asarray(a, dtype=np.float64) + np.array([qt["x0"], qt["y0"]])
        b = np.asarray(b, dtype=np.float64) + np.array([ct["x0"], ct["y0"]])
        pts_q.append(a)
        pts_c.append(b)
    if not pts_q:
        return np.zeros((0, 2)), np.zeros((0, 2))
    return np.concatenate(pts_q), np.concatenate(pts_c)


def verify_pair(query_img, candidate_img, matcher, config: dict | None = None, passes: int = 5) -> dict:
    cfg = config or DEFAULT_VERIFY_CONFIG
    src, dst = _collect_matches(query_img, candidate_img, matcher, passes)

    if len(src) < 4:
        return {"inliers": int(len(src)), "reproj_error": float("inf"), "score": 0.0}

    H, mask = cv2.findHomography(src, dst, cv2.USAC_MAGSAC, cfg["magsac_reproj_threshold"])
    if H is None or mask is None:
        return {"inliers": 0, "reproj_error": float("inf"), "score": 0.0}

    inlier_mask = mask.ravel().astype(bool)
    inliers = int(inlier_mask.sum())
    if inliers == 0:
        return {"inliers": 0, "reproj_error": float("inf"), "score": 0.0}

    # mean reprojection error over inliers
    src_h = np.hstack([src[inlier_mask], np.ones((inliers, 1))])
    proj = (H @ src_h.T).T
    proj = proj[:, :2] / proj[:, 2:3]
    reproj_error = float(np.linalg.norm(proj - dst[inlier_mask], axis=1).mean())

    return {
        "inliers": inliers,
        "reproj_error": reproj_error,
        "score": calibrate_score(inliers, reproj_error, cfg),
    }