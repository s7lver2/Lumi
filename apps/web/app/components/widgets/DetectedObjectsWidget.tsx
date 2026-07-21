// apps/web/app/components/widgets/DetectedObjectsWidget.tsx
"use client";
import { LockedWidgetOverlay } from "./LockedWidgetOverlay";

export const OBJECTS_ICON = (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
    <path d="M20.6 9.5L14 3H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h9l6.6-6.5a2 2 0 0 0 0-2.83l-1.4-1.4a2 2 0 0 0-2.6-.13z" /><circle cx="8" cy="15" r="1.2" />
  </svg>
);

export function DetectedObjectsWidget({ onInstall }: { onInstall: () => void }) {
  return (
    <div className="relative rounded-lg">
      <div className="blur-[4px] opacity-50">
        <div className="flex flex-wrap gap-1.5">
          {["farola", "acera", "buzón", "+4 más"].map((tag) => (
            <span key={tag} className="rounded-full border border-white/[.15] px-1.5 py-0.5 text-[9px] text-fg">{tag}</span>
          ))}
        </div>
      </div>
      <LockedWidgetOverlay label="Objetos detectados" onInstall={onInstall} />
    </div>
  );
}
