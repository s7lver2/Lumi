// apps/web/app/setup/steps/ModelsStep.tsx
"use client";
import { useState } from "react";
import { motion } from "framer-motion";
import { fadeRise } from "../../lib/motion";
import { InstallItem } from "./InstallItem";
import { recommendedBundles, USE_CASES, type UseCaseId } from "../model-recommendations";
import { MODEL_BUNDLES } from "@netryx/shared-types";

function labelsFor(useCases: UseCaseId[]): string {
  const labels = useCases.map((id): string | undefined => USE_CASES.find((uc) => uc.id === id)?.label).filter((l): l is string => Boolean(l));
  return labels.length > 0 ? `Recomendado para: ${labels.join(", ")}` : "Recomendado";
}

export function ModelsStep({ useCases, onComplete }: { useCases: UseCaseId[]; onComplete: () => void }) {
  const recommended = recommendedBundles(useCases);
  const bundles = recommended.length > 0 ? recommended : MODEL_BUNDLES;
  const recommendationBlurb = labelsFor(useCases);

  // Today there's exactly one bundle ("lumi-preview"), so the checklist is
  // always this fixed set of steps. If a second bundle is ever added, its
  // own weight-download step ids would need to be threaded in here —
  // out of scope for now (see model-recommendations.ts comment).
  const items = [
    { id: "weights-retrieval", label: "Modelo de recuperación", engine: "Lumi Preview" },
    { id: "weights-verification", label: "Modelo de verificación", engine: "Laila" },
    { id: "verify-services", label: "Arrancar y verificar servicios", engine: "uvicorn + worker" },
  ];
  const [activeIdx, setActiveIdx] = useState(0);
  const [doneCount, setDoneCount] = useState(0);

  function onDone(ok: boolean) {
    if (!ok) return;
    setDoneCount((d) => d + 1);
    setActiveIdx((x) => {
      const next = x + 1;
      if (next >= items.length) onComplete();
      return next;
    });
  }

  return (
    <motion.div variants={fadeRise} initial="hidden" animate="show">
      <div className="mb-0.5 text-[15px] font-medium text-fg">Modelos recomendados</div>
      <p className="mb-4 text-xs text-muted">{recommendationBlurb}</p>

      <div className="mb-3 flex flex-col gap-2">
        {bundles.map((b) => (
          <div key={b.id} className="rounded-card border border-white/10 bg-white/[.03] p-3">
            <div className="text-[12.5px] font-medium text-fg">{b.displayName} <span className="font-normal text-subtle">· v{b.version}</span></div>
          </div>
        ))}
      </div>

      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-medium text-fg">Instalando…</span>
        <span className="text-xs text-muted">{doneCount} / {items.length} completado</span>
      </div>
      <div className="flex flex-col gap-2">
        {items.map((it, i) => (
          <InstallItem key={it.id} stepId={it.id} label={it.label} engine={it.engine} active={i === activeIdx} onDone={onDone} />
        ))}
      </div>
    </motion.div>
  );
}
