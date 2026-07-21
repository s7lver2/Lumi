// apps/web/app/components/ResultsWidgetsPopup.tsx
"use client";
import { WidgetGrid } from "./WidgetGrid";
import { FloatingCard } from "./FloatingCard";
import type { Widget } from "./widgets/types";

export function ResultsWidgetsPopup({ widgets, onClose }: { widgets: Widget[]; onClose: () => void }) {
  const expandedWidgets = widgets.map((w) => ({ ...w, defaultExpanded: true }));

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/60">
      <FloatingCard className="w-[900px] max-h-[85vh] overflow-y-auto p-5">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-[13.5px] font-medium text-fg">Resultado</span>
          <button onClick={onClose} className="text-subtle hover:text-fg" aria-label="Cerrar">
            ✕
          </button>
        </div>
        <WidgetGrid columns={2} widgets={expandedWidgets} />
      </FloatingCard>
    </div>
  );
}
