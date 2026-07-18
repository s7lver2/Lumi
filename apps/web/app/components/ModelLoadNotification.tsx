// apps/web/app/components/ModelLoadNotification.tsx
"use client";
import { useEffect, useState } from "react";

const LABEL: Record<"retrieval" | "verification", string> = {
  retrieval: "Lumi Preview",
  verification: "Laila",
};

/**
 * Replaces ModelLoadingNotice.tsx's inline sweeping-stripe bar with a
 * bottom-right toast (spec §6.3) — same polling contract (only shows when
 * services/inference's real _loading_kind says a model is actually
 * loading, never a timeout guess), different presentation: a small photo
 * thumbnail instead of a text-heavy description. Self-positions via
 * `fixed bottom-4 right-4` so every call site can drop it in directly
 * without a shared wrapper — the app's handful of call sites are mutually
 * exclusive states (searching vs. refining vs. indexing), so independent
 * positioning is sufficient without needing a stacking container.
 */
export function ModelLoadNotification({
  active,
  thumbnailUrl = null,
}: {
  active: boolean;
  thumbnailUrl?: string | null;
}) {
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
    <div
      className="fixed bottom-4 right-4 z-40 flex w-[210px] items-center gap-2.5 rounded-lg border border-white/[.12] bg-panel/[.97] p-2 shadow-lg shadow-black/40"
      style={{ animation: "jg-toast-in .35s cubic-bezier(.2,.85,.35,1) both" }}
    >
      <div
        className="h-9 w-9 shrink-0 rounded-md bg-cover bg-center"
        style={
          thumbnailUrl
            ? { backgroundImage: `url(${thumbnailUrl})` }
            : { background: "linear-gradient(135deg,#2a3038,#14171a)" }
        }
      />
      <div className="min-w-0 flex-1">
        <div className="text-[10px] font-medium text-fg">{LABEL[loading]}</div>
        <div className="mt-1.5 h-[3px] overflow-hidden rounded-full bg-white/[.08]">
          <div
            className="h-full w-2/5 rounded-full bg-fg/60"
            style={{ animation: "lumi-shimmer 1.6s ease-in-out infinite" }}
          />
        </div>
      </div>
    </div>
  );
}
