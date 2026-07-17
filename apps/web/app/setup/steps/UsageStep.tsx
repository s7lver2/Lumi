// apps/web/app/setup/steps/UsageStep.tsx
"use client";
import { useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { fadeRise } from "../../lib/motion";
import { USE_CASES, type UseCaseId } from "../model-recommendations";

export function UsageStep({
  selected,
  onSelectedChange,
  onComplete,
}: {
  selected: UseCaseId[];
  onSelectedChange: (ids: UseCaseId[]) => void;
  onComplete: () => void;
}) {
  // Selecting nothing is a valid choice (ModelsStep falls back to
  // recommending every bundle) — so this step is "done" as soon as it's
  // shown, unlike CredentialsStep which gates on a successful key test.
  const completed = useRef(false);
  useEffect(() => {
    if (!completed.current) { completed.current = true; onComplete(); }
  }, [onComplete]);

  function toggle(id: UseCaseId) {
    onSelectedChange(selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id]);
  }

  return (
    <motion.div variants={fadeRise} initial="hidden" animate="show">
      <div className="mb-0.5 text-[15px] font-medium text-fg">¿Para qué vas a usar Lumi?</div>
      <p className="mb-4 text-xs text-muted">Selecciona una o más — te recomendaremos modelos según esto.</p>
      <div className="grid grid-cols-2 gap-2.5">
        {USE_CASES.map((uc) => {
          const isSelected = selected.includes(uc.id);
          return (
            <button
              key={uc.id}
              type="button"
              onClick={() => toggle(uc.id)}
              className={`relative rounded-card border p-3 text-left ${isSelected ? "border-accent bg-white/[.06]" : "border-white/10 bg-white/[.03] hover:bg-white/[.05]"}`}
            >
              {isSelected && (
                <span className="absolute right-2 top-2 flex h-4 w-4 items-center justify-center rounded-full bg-accent text-[10px] font-semibold text-black">✓</span>
              )}
              <div className="mb-1.5 text-xl">{uc.icon}</div>
              <div className="text-[12.5px] font-medium text-fg">{uc.label}</div>
              <div className="mt-0.5 text-[10.5px] text-subtle">{uc.blurb}</div>
            </button>
          );
        })}
      </div>
    </motion.div>
  );
}
