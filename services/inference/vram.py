# services/inference/vram.py
"""
Pure, testable VRAM auto-detection for low-VRAM mode (spec:
docs/superpowers/specs/2026-07-13-low-vram-mode-design.md). No import on
torch/CUDA here — main.py supplies the real torch.cuda.* values at
startup, tests supply fakes, so this stays importable and testable without
a GPU or even torch installed.
"""

LOW_VRAM_THRESHOLD_BYTES = 8 * 1024 * 1024 * 1024  # 8 GiB


def resolve_low_vram_mode(setting_value: str, cuda_available: bool, total_memory_bytes: int) -> bool:
    """setting_value is the raw INFERENCE_LOW_VRAM_MODE value ("auto"/"on"/
    "off"). Hardware is only consulted when it's "auto"."""
    if setting_value == "on":
        return True
    if setting_value == "off":
        return False
    if not cuda_available:
        return False
    return total_memory_bytes <= LOW_VRAM_THRESHOLD_BYTES


def describe_gpu(cuda_available: bool, device_name: str | None, total_memory_bytes: int) -> str:
    """Human-readable Spanish note for the settings UI — shows what "auto"
    actually decided (spec: "GPU detectada: RTX 3050 (6 GB) → se activa
    automáticamente"), not just the word "auto"."""
    if not cuda_available:
        return "No se detectó GPU — modo bajo VRAM desactivado (no aplica sin GPU)."
    gb = total_memory_bytes / (1024 ** 3)
    return f"GPU detectada: {device_name or 'desconocida'} ({gb:.0f} GB)"