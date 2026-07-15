# services/inference/test_vram.py
from vram import resolve_low_vram_mode, describe_gpu, LOW_VRAM_THRESHOLD_BYTES

GIB = 1024 ** 3


def test_explicit_on_ignores_hardware():
    assert resolve_low_vram_mode("on", cuda_available=True, total_memory_bytes=24 * GIB) is True
    assert resolve_low_vram_mode("on", cuda_available=False, total_memory_bytes=0) is True


def test_explicit_off_ignores_hardware():
    assert resolve_low_vram_mode("off", cuda_available=True, total_memory_bytes=4 * GIB) is False


def test_auto_with_no_cuda_resolves_off():
    assert resolve_low_vram_mode("auto", cuda_available=False, total_memory_bytes=0) is False


def test_auto_at_or_under_8gib_resolves_on():
    assert resolve_low_vram_mode("auto", cuda_available=True, total_memory_bytes=6 * GIB) is True
    assert resolve_low_vram_mode("auto", cuda_available=True, total_memory_bytes=LOW_VRAM_THRESHOLD_BYTES) is True


def test_auto_over_8gib_resolves_off():
    assert resolve_low_vram_mode("auto", cuda_available=True, total_memory_bytes=24 * GIB) is False


def test_describe_gpu_with_no_cuda():
    assert "No se detectó GPU" in describe_gpu(cuda_available=False, device_name=None, total_memory_bytes=0)


def test_describe_gpu_with_cuda():
    desc = describe_gpu(cuda_available=True, device_name="RTX 3050", total_memory_bytes=6 * GIB)
    assert "RTX 3050" in desc
    assert "6 GB" in desc