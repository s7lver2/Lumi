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