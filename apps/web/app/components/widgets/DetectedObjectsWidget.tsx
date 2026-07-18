// apps/web/app/components/widgets/DetectedObjectsWidget.tsx
"use client";
import { InfoTooltip } from "../InfoTooltip";

// TODO: sin modelo real todavía; conectar cuando exista un modelo de
// reconocimiento de objetos entrenado sobre escenas urbanas.

const OBJECTS_ICON = (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
    <path d="M20.6 9.5L14 3H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h9l6.6-6.5a2 2 0 0 0 0-2.83l-1.4-1.4a2 2 0 0 0-2.6-.13z" /><circle cx="8" cy="15" r="1.2" />
  </svg>
);
const LOCK_ICON = (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ animation: "jg-lock-breathe 2.6s ease-in-out infinite" }}>
    <rect x="5" y="11" width="14" height="9" rx="1.5" /><path d="M8 11V7a4 4 0 0 1 8 0v4" />
  </svg>
);

export function DetectedObjectsWidget({ onInstall }: { onInstall: () => void }) {
  return (
    <div className="relative overflow-hidden rounded-lg">
      <div className="blur-[4px] opacity-50">
        <div className="mb-2.5 flex items-center gap-1.5">
          {OBJECTS_ICON}
          <span className="flex-1 text-[10.5px] font-medium text-fg">Objetos detectados</span>
          <InfoTooltip text="Detectado por un modelo de reconocimiento de objetos entrenado sobre escenas urbanas" />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {["farola", "acera", "buzón", "+4 más"].map((tag) => (
            <span key={tag} className="rounded-full border border-white/[.15] px-1.5 py-0.5 text-[9px] text-fg">{tag}</span>
          ))}
        </div>
      </div>
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[#0e0f11]/35">
        <div className="flex h-[26px] w-[26px] items-center justify-center rounded-full border border-white/35">{LOCK_ICON}</div>
        <button
          onClick={onInstall}
          className="rounded-lg bg-accent px-2.5 py-1.5 text-[9.5px] font-medium text-black transition-transform hover:scale-105 active:scale-90"
        >
          Instalar Objetos detectados
        </button>
      </div>
    </div>
  );
}