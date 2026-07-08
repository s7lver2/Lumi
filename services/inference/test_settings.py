# services/inference/test_settings.py
from unittest.mock import MagicMock
from settings import get_active_model_ids


def _mock_conn(rows):
    conn = MagicMock()
    cursor = MagicMock()
    cursor.fetchall.return_value = rows
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