"use client";
import { useEffect, useState } from "react";

const LABEL: Record<"retrieval" | "verification", string> = {
  retrieval: "Cargando modelo de recuperación (Lumi Preview) — puede tardar unos segundos",
  verification: "Cargando modelo de verificación (Laila) — puede tardar unos segundos",
};

/**
 * Polls GET /api/model-status while `active` and shows the shared "model
 * loading" copy + sweeping-stripe indicator ONLY when the real in-memory
 * state (services/inference's _loading_kind) says a model is actually
 * loading — never a timeout guess, so it's never shown for unrelated
 * slowness like busy GPU compute or a slow network (spec's "Model-loading
 * notice" section). Reused as-is by search, refine, and indexing — one
 * shared component instead of three bespoke ones.
 */
export function ModelLoadingNotice({ active }: { active: boolean }) {
  const [loading, setLoading] = useState<"retrieval" | "verification" | null>(null);

  useEffect(() => {
    if (!active) {
      setLoading(null);
      return;
    }
    let cancelled = false;
    async function poll() {
      try {
        const res = await fetch("/api/model-status");
        const data: { loading: "retrieval" | "verification" | null } = await res.json();
        if (!cancelled) setLoading(data.loading);
      } catch {
        // keep the previous value rather than flicker on a transient network hiccup
      }
    }
    poll();
    const interval = setInterval(poll, 1500);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [active]);

  if (!active || !loading) return null;

  return (
    <div className="mt-2 flex items-center gap-2 text-xs text-draw-fg">
      <div className="relative h-1 w-16 overflow-hidden rounded-full bg-draw/20">
        <div
          className="lumi-anim absolute left-0 top-0 h-full w-2/5 rounded-full bg-draw"
          style={{ animation: "lumi-shimmer 1.6s ease-in-out infinite" }}
        />
      </div>
      <span>{LABEL[loading]}</span>
    </div>
  );
}
