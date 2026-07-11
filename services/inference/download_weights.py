# services/inference/download_weights.py
"""
Descarga y cachea los pesos de los modelos seleccionados. Se ejecuta con el
python del venv (cwd = services/inference) desde el paso Install del asistente.
Recibe un argumento: "retrieval" | "verification" | "all".

Nota: se invoca como `python download_weights.py retrieval` (argumentos de un
solo token) — NUNCA como `python -c "..."`, porque en Windows con shell:true
cmd.exe parte el script inline por los espacios (SyntaxError).
"""
import os
import sys


def _apply_custom_cache_dir() -> None:
    """
    Reubica los pesos de los modelos (varios GB) fuera del ~/.cache por
    defecto del usuario. Por defecto: <clon del repo>/data/models-cache, para
    que un clon recién hecho funcione sin configurar nada y los pesos queden
    dentro del propio checkout en vez de esparcidos por el perfil del
    usuario. MODELS_CACHE_DIR (opcional) sobrescribe esto con otra ruta. Si
    quien lanza este proceso ya fijó TORCH_HOME/HF_HOME (p. ej. el paso WSL2
    del asistente, vía symlink — ver wslCacheExport en
    apps/web/app/api/setup/run/[step]/route.ts), se respeta tal cual.

    Debe fijarse ANTES de importar torch/romatch/huggingface_hub en este
    proceso: huggingface_hub calcula su ruta de caché una vez, al
    importarse, no en cada llamada.
    """
    if os.environ.get("TORCH_HOME") and os.environ.get("HF_HOME"):
        return
    base = os.environ.get("MODELS_CACHE_DIR")
    if not base:
        # dirname x3: download_weights.py -> services/inference -> services -> repo root.
        repo_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        base = os.path.join(repo_root, "data", "models-cache")
    os.environ.setdefault("TORCH_HOME", os.path.join(base, "torch"))
    os.environ.setdefault("HF_HOME", os.path.join(base, "huggingface"))


def main() -> int:
    _apply_custom_cache_dir()
    kind = sys.argv[1] if len(sys.argv) > 1 else "all"

    if kind in ("retrieval", "all"):
        import torch
        print("Descargando modelo de recuperación (Lumi Preview / MegaLoc)…", flush=True)
        torch.hub.load("gmberton/MegaLoc", "get_trained_model")

    if kind in ("verification", "all"):
        import romatch
        print("Descargando modelo de verificación (Laila / RoMa)…", flush=True)
        romatch.roma_outdoor(device="cpu")

    print("Pesos listos.", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())