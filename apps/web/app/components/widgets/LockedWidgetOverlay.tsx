// apps/web/app/components/widgets/LockedWidgetOverlay.tsx
"use client";

const LOCK_ICON = (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ animation: "jg-lock-breathe 2.6s ease-in-out infinite" }}>
    <rect x="5" y="11" width="14" height="9" rx="1.5" /><path d="M8 11V7a4 4 0 0 1 8 0v4" />
  </svg>
);

/** Shared lock/blur overlay for a widget whose model isn't installed/active
 * yet — extracted from three identical copies (EstimatedTimeWidget,
 * WeatherEstimateWidget, DetectedObjectsWidget) (spec: docs/superpowers/
 * specs/2026-07-21-results-widgets-popup-and-per-candidate-refine-design.md). */
export function LockedWidgetOverlay({ label, onInstall }: { label: string; onInstall: () => void }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[#0e0f11]/35">
      <div className="flex h-[26px] w-[26px] items-center justify-center rounded-full border border-white/35">
        {LOCK_ICON}
      </div>
      <button
        onClick={onInstall}
        className="rounded-lg bg-accent px-2.5 py-1.5 text-[9.5px] font-medium text-black transition-transform hover:scale-105 active:scale-90"
      >
        Instalar {label}
      </button>
    </div>
  );
}
