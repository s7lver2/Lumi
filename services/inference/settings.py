# services/inference/settings.py
"""
Reads RETRIEVAL_MODEL / VERIFICATION_MODEL directly from system_settings.
Called exactly once, at process startup (spec §14.5, §15.4) — this service
never re-reads system_settings on a per-/embed-request basis.

These two settings are never marked is_secret (see packages/shared-types/src/
settings.ts, spec §15.3), so no decryption is needed here — that keeps this
service free of any dependency on the Node-side AES-256-GCM key file.
"""

DEFAULT_RETRIEVAL_MODEL = "lumi-preview"
DEFAULT_VERIFICATION_MODEL = "laila"
DEFAULT_VERIFICATION_TILE_PASSES = 5
DEFAULT_LOW_VRAM_MODE = "auto"


def get_active_model_ids(conn) -> tuple[str, str]:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT key, value FROM system_settings WHERE key IN "
            "('RETRIEVAL_MODEL', 'VERIFICATION_MODEL')"
        )
        rows = dict(cur.fetchall())

    return (
        rows.get("RETRIEVAL_MODEL", DEFAULT_RETRIEVAL_MODEL),
        rows.get("VERIFICATION_MODEL", DEFAULT_VERIFICATION_MODEL),
    )


def get_verification_tile_passes(conn) -> int:
    """VERIFICATION_TILE_PASSES (packages/shared-types/src/settings.ts, a 1-10
    slider) — how many of tiles.py's multiscale_tiles() schedule to run per
    candidate. Read once at startup alongside the model ids (spec §15.4's
    existing "changing this needs a restart" convention), not per-/verify-request."""
    with conn.cursor() as cur:
        cur.execute("SELECT value FROM system_settings WHERE key = 'VERIFICATION_TILE_PASSES'")
        row = cur.fetchone()
    if row is None or row[0] is None:
        return DEFAULT_VERIFICATION_TILE_PASSES
    try:
        return max(1, min(10, int(row[0])))
    except ValueError:
        return DEFAULT_VERIFICATION_TILE_PASSES


# Mirrors verify.py's DEFAULT_VERIFY_CONFIG exactly — these keys/defaults
# MUST match that dict's shape, since get_verify_config()'s result is passed
# straight through as verify_pair()'s `config` argument.
_VERIFY_CONFIG_DEFAULTS = {
    "VERIFICATION_MIN_INLIERS": ("min_inliers_for_score", 4, int),
    "VERIFICATION_INLIER_SATURATION": ("score_inlier_saturation", 3000.0, float),
    "VERIFICATION_ERROR_SCALE_PX": ("score_error_scale", 8.0, float),
    "VERIFICATION_MAGSAC_THRESHOLD_PX": ("magsac_reproj_threshold", 3.0, float),
}


def get_verify_config(conn) -> dict:
    """Reads the 4 VERIFICATION_* calibration settings (Settings UI, spec: lets
    users tune Laila's score calibration instead of only via Python source
    edits) into a dict shaped exactly like verify.py's DEFAULT_VERIFY_CONFIG.
    Read once at startup, same convention as get_verification_tile_passes."""
    with conn.cursor() as cur:
        cur.execute(
            "SELECT key, value FROM system_settings WHERE key IN %s",
            (tuple(_VERIFY_CONFIG_DEFAULTS.keys()),),
        )
        rows = dict(cur.fetchall())

    config = {}
    for setting_key, (config_key, default, cast) in _VERIFY_CONFIG_DEFAULTS.items():
        raw = rows.get(setting_key)
        if raw is None:
            config[config_key] = default
            continue
        try:
            config[config_key] = cast(raw)
        except ValueError:
            config[config_key] = default
    return config


def get_low_vram_mode_setting(conn) -> str:
    """Raw INFERENCE_LOW_VRAM_MODE value ("auto"/"on"/"off") — resolving it
    against actual hardware happens in vram.py's resolve_low_vram_mode(),
    called once from load_model_once() alongside this, same "read once at
    startup" convention as every other model-affecting setting here."""
    with conn.cursor() as cur:
        cur.execute("SELECT value FROM system_settings WHERE key = 'INFERENCE_LOW_VRAM_MODE'")
        row = cur.fetchone()
    if row is None or row[0] is None:
        return DEFAULT_LOW_VRAM_MODE
    return row[0]