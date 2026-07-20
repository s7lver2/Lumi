// apps/web/app/components/ResetConfirmDialog.tsx
"use client";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { fetchJson } from "../lib/fetch-json";
import { popIn, overlay } from "../lib/motion";
import { ModelLoadNotification } from "./ModelLoadNotification";

export function ResetConfirmDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [confirmText, setConfirmText] = useState("");
  const [resetting, setResetting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !resetting) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, resetting]);

  async function reset() {
    setResetting(true);
    setError(null);
    const { ok, data } = await fetchJson<{ error?: string }>("/api/settings/reset", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ confirm: "RESET" }),
    });
    setResetting(false);
    if (!ok) {
      setError((data as { error?: string } | null)?.error ?? "No se pudo restablecer la configuración");
      return;
    }
    onDone();
    onClose();
  }

  return (
    <>
      <motion.div
        variants={overlay}
        initial="hidden"
        animate="show"
        exit="exit"
        onClick={() => !resetting && onClose()}
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      >
        <motion.div
          variants={popIn}
          initial="hidden"
          animate="show"
          exit="exit"
          onClick={(e) => e.stopPropagation()}
          className="w-[340px] rounded-[14px] border border-white/12 bg-elevated p-[18px] shadow-2xl shadow-black/50"
        >
          <div className="mb-1 flex items-center justify-between">
            <span className="text-sm font-medium text-fg">Restablecer configuración</span>
            <button
              onClick={onClose}
              disabled={resetting}
              aria-label="Cerrar"
              className="text-subtle hover:text-fg disabled:opacity-50"
            >
              ✕
            </button>
          </div>
          <p className="mb-3.5 text-xs leading-relaxed text-muted">
            Esto borra todos los datos de la aplicación (áreas, imágenes, modelos instalados, ajustes) y restaura
            los modelos originales. Se guarda una copia de seguridad local antes de borrar, pero esta acción no se
            puede deshacer desde la interfaz.
          </p>
          <label className="mb-1.5 block text-xs text-muted">Escribe RESET para confirmar</label>
          <input
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            disabled={resetting}
            placeholder="RESET"
            className="mb-2 h-[38px] w-full rounded-lg border border-white/25 bg-white/5 px-3 font-mono text-sm text-fg outline-none disabled:opacity-50"
          />
          {error && <p className="mb-2 text-xs text-danger-fg">{error}</p>}
          <div className="flex justify-end gap-2">
            <button
              onClick={onClose}
              disabled={resetting}
              className="rounded-lg border border-white/15 px-3.5 py-2 text-xs text-muted hover:text-fg disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              onClick={reset}
              disabled={confirmText !== "RESET" || resetting}
              className="rounded-lg border border-[rgba(163,51,51,0.5)] bg-[rgba(163,51,51,0.15)] px-4 py-2 text-xs font-medium text-danger-fg hover:bg-[rgba(163,51,51,0.25)] disabled:opacity-50"
            >
              {resetting ? "Restableciendo…" : "Restablecer"}
            </button>
          </div>
        </motion.div>
      </motion.div>
      <ModelLoadNotification active={resetting} fallbackLabel="Restableciendo configuración…" />
    </>
  );
}