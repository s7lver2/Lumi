// apps/web/app/components/SettingsModal.tsx
"use client";
import { SettingsPanel } from "./SettingsPanel";

export function SettingsModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="flex max-h-[85vh] w-[980px] flex-col overflow-hidden rounded-card border border-white/10 bg-surface"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-white/10 bg-panel px-4 py-2.5">
          <span className="text-[13px] font-medium text-fg">Configuración</span>
          <button onClick={onClose} className="text-subtle hover:text-fg" aria-label="Cerrar">✕</button>
        </div>
        <div className="overflow-y-auto p-6">
          <SettingsPanel />
        </div>
      </div>
    </div>
  );
}
