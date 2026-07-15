# services/inference/test_settings.py
from unittest.mock import MagicMock
from settings import get_active_model_ids
from settings import get_low_vram_mode_setting



def _mock_conn(rows):
    conn = MagicMock()
    cursor = MagicMock()
    cursor.fetchall.return_value = rows
    cursor.fetchone.return_value = rows[0] if rows else None
    conn.cursor.return_value.__enter__.return_value = cursor
    return conn


def test_reads_retrieval_and_verification_model_from_system_settings():
    conn = _mock_conn(
        [("RETRIEVAL_MODEL", "lumi-preview"), ("VERIFICATION_MODEL", "laila")]
    )
    retrieval, verification = get_active_model_ids(conn)
    assert retrieval == "lumi-preview"
    assert verification == "laila"


def test_falls_back_to_defaults_when_settings_row_is_missing():
    conn = _mock_conn([])
    retrieval, verification = get_active_model_ids(conn)
    assert retrieval == "lumi-preview"
    assert verification == "laila"

def test_reads_low_vram_mode_setting():
    # get_low_vram_mode_setting's query selects only `value` (single column),
    # unlike get_active_model_ids' `SELECT key, value` — the mock row reflects that.
    conn = _mock_conn([("on",)])
    assert get_low_vram_mode_setting(conn) == "on"


def test_low_vram_mode_defaults_to_auto_when_unset():
    conn = _mock_conn([])
    assert get_low_vram_mode_setting(conn) == "auto"