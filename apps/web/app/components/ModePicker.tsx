// apps/web/app/components/ModePicker.tsx
"use client";
import { useState } from "react";
import { RETRIEVAL_MODELS } from "@netryx/shared-types";

const GLOBE_ICON = (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
    <circle cx="12" cy="12" r="9" /><path d="M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18M3 12h18" />
  </svg>
);

interface UpcomingMode { title: string; subtitle: string; icon: JSX.Element }

const UPCOMING_MODES: UpcomingMode[] = [
  {
    title: "Identificar vehículo",
    subtitle: "Marca, modelo y año",
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
        <rect x="3" y="7" width="18" height="10" rx="2" /><circle cx="7.5" cy="17" r="1.6" /><circle cx="16.5" cy="17" r="1.6" />
      </svg>
    ),
  },
  {
    title: "Detectar IA generativa",
    subtitle: "Probabilidad de imagen generada",
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
        <path d="M12 3l8 4v5c0 5-3.5 7.5-8 9-4.5-1.5-8-4-8-9V7l8-4z" />
      </svg>
    ),
  },
];

const LOCK_ICON = (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <rect x="5" y="11" width="14" height="9" rx="1.5" /><path d="M8 11V7a4 4 0 0 1 8 0v4" />
  </svg>
);

export function ModePicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const current = RETRIEVAL_MODELS.find((m) => m.id === value) ?? RETRIEVAL_MODELS[0];

  if (!expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        className="mb-3.5 flex w-full items-center gap-2.5 rounded-lg bg-white/[.04] p-2.5 text-left transition-transform hover:scale-[1.01] active:scale-[.98]"
      >
        <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-lg bg-white/[.06] text-fg">{GLOBE_ICON}</span>
        <span className="min-w-0 flex-1">
          <span className="block text-[11.5px] font-medium text-fg">{current.displayName}</span>
          <span className="block text-[9.5px] text-muted">Geolocalización aproximada · cobertura global</span>
        </span>
        <span className="flex items-center gap-0.5 text-[10px] text-muted">
          Cambiar
          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 9l6 6 6-6" /></svg>
        </span>
      </button>
    );
  }

  return (
    <div className="mb-3.5 rounded-lg bg-white/[.02] p-1">
      <button
        onClick={() => { onChange(current.id); setExpanded(false); }}
        className="flex w-full items-center gap-2.5 rounded-lg bg-white/[.06] p-2.5 text-left"
      >
        <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-lg bg-white/[.08] text-fg">{GLOBE_ICON}</span>
        <span className="min-w-0 flex-1">
          <span className="block text-[11.5px] font-medium text-fg">{current.displayName}</span>
          <span className="block text-[9.5px] text-muted">Geolocalización aproximada · cobertura global</span>
        </span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
      </button>
      {UPCOMING_MODES.map((mode) => (
        <div key={mode.title} className="flex items-center gap-2.5 p-2.5 opacity-50">
          <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-lg bg-white/[.04] text-muted">{mode.icon}</span>
          <span className="min-w-0 flex-1">
            <span className="block text-[11.5px] font-medium text-muted">{mode.title}</span>
            <span className="block text-[9.5px] text-subtle">{mode.subtitle}</span>
          </span>
          <span className="text-subtle">{LOCK_ICON}</span>
        </div>
      ))}
    </div>
  );
}