// apps/web/app/components/JobProgressBar.tsx
"use client";

import { useState } from "react";
import { useIndexingStore } from "../stores/useIndexingStore";
import { useAreaProgress } from "../lib/useAreaProgress";
import { ProgressMeter } from "./ProgressMeter";
import { Badge } from "./Badge";
import { fetchJson } from "../lib/fetch-json";
import { ModelLoadingNotice } from "./ModelLoadingNotice";

const TONE = {
  failed: "danger",
  indexed: "accent",
  cancelled: "muted",
} as const;

// El estado real llega en inglés desde la BD (AreaStatus); aquí se traduce
// tanto el encabezado como el badge para que no diga "Indexando" para
// siempre incluso cuando el trabajo ya terminó (lo que parecía "atascado").
const HEADER_LABEL: Record<string, string> = {
  pending: "Indexando",
  indexing: "Indexando",
  indexed: "Indexado",
  failed: "Error al indexar",
  cancelled: "Cancelado",
};
const BADGE_LABEL: Record<string, string> = {
  pending: "pendiente",
  indexing: "en curso",
  indexed: "completado",
  failed: "fallido",
  cancelled: "cancelado",
};

export function JobProgressBar() {
  const activeJobId = useIndexingStore((s) => s.activeJobId);
  const p = useIndexingStore((s) => s.jobProgress);
  const updateProgress = useIndexingStore((s) => s.updateProgress);
  useAreaProgress(activeJobId);
  const [cancelling, setCancelling] = useState(false);

  if (!activeJobId) return null;
  const status = p?.status ?? "pending";
  const isTerminal = status === "indexed" || status === "failed" || status === "cancelled";

  async function cancel() {
    if (!activeJobId) return;
    setCancelling(true);
    const { ok } = await fetchJson(`/api/areas/${activeJobId}/cancel`, { method: "POST" });
    setCancelling(false);
    // Optimistic — the SSE poll (useAreaProgress) will confirm within ~1s
    // regardless, this just avoids the button staying clickable meanwhile.
    if (ok) {
      updateProgress({
        status: "cancelled",
        pointsEstimated: p?.pointsEstimated ?? 0,
        pointsCaptured: p?.pointsCaptured ?? 0,
        pointsFailed: p?.pointsFailed ?? 0,
        imagesEmbedded: p?.imagesEmbedded ?? 0,
      });
    }
  }

  const imagesMax = (p?.pointsEstimated ?? 0) * 4;
  const imagesEmbedded = p?.imagesEmbedded ?? 0;
  // Cuando el trabajo ya terminó ("indexed") pero se embebieron menos
  // imágenes que el máximo teórico (puntos × 4 headings), no es un fallo ni
  // se quedó a medias: algunas pano/heading ya estaban indexadas de un área
  // solapada anterior y se omiten a propósito (spec §4 step 4, dedupe global).
  const dedupedSomeImages = status === "indexed" && imagesEmbedded < imagesMax;

  const awaitingFirstProgress = status === "pending" && (p?.pointsCaptured ?? 0) === 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-fg">{HEADER_LABEL[status] ?? status}</span>
        <div className="flex items-center gap-2">
          <Badge tone={TONE[status as keyof typeof TONE] ?? "draw"}>{BADGE_LABEL[status] ?? status}</Badge>
          {!isTerminal && (
            <button
              onClick={cancel}
              disabled={cancelling}
              className="rounded-md border border-white/10 px-2 py-1 text-[11px] text-fg hover:bg-white/10 disabled:opacity-50"
            >
              {cancelling ? "Cancelando…" : "Cancelar"}
            </button>
          )}
        </div>
      </div>
      <ModelLoadingNotice active={awaitingFirstProgress} />
      <ProgressMeter
        label="Puntos de captura"
        value={p?.pointsCaptured ?? 0}
        max={p?.pointsEstimated ?? 0}
      />
      <ProgressMeter
        label="Imágenes embebidas"
        value={imagesEmbedded}
        max={imagesMax}
      />
      {dedupedSomeImages && (
        <p className="text-xs text-subtle">
          {imagesMax - imagesEmbedded} ya estaban indexadas de un área solapada anterior — no se repiten.
        </p>
      )}
      {(p?.pointsFailed ?? 0) > 0 && (
        <p className="text-xs text-warning-fg">{p?.pointsFailed} puntos sin cobertura</p>
      )}
    </div>
  );
}