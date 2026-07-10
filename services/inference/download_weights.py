# services/inference/download_weights.py
"""
Descarga y cachea los pesos de los modelos seleccionados. Se ejecuta con el
python del venv (cwd = services/inference) desde el paso Install del asistente.
Recibe un argumento: "retrieval" | "verification" | "all".

Nota: se invoca como `python download_weights.py retrieval` (argumentos de un
solo token) — NUNCA como `python -c "..."`, porque en Windows con shell:true
cmd.exe parte el script inline por los espacios (SyntaxError).
"""
import sys


def main() -> int:
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