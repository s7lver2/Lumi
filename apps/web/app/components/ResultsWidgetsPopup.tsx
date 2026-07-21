// apps/web/app/components/ResultsWidgetsPopup.tsx
"use client";
import { FloatingCard } from "./FloatingCard";
import { InfoTooltip } from "./InfoTooltip";
import type { Widget } from "./widgets/types";

function WidgetCard({ widget }: { widget: Widget }) {
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-lg border border-white/[.08]">
      <div className="flex items-center gap-2 border-b border-white/[.08] px-3 py-2">
        <span className="text-fg">{widget.icon}</span>
        <span className="flex-1 text-[11.5px] font-medium text-fg">{widget.title}</span>
        {widget.tooltip && <InfoTooltip text={widget.tooltip} />}
      </div>
      <div className="flex-1 overflow-y-auto p-3">{widget.render()}</div>
    </div>
  );
}

export function ResultsWidgetsPopup({ widgets, onClose }: { widgets: Widget[]; onClose: () => void }) {
  const hero = widgets.find((w) => w.id === "search-results");
  const secondary = widgets.filter((w) => w.id !== "search-results");

  return (
    <div
      className="fixed inset-0 z-30 flex items-center justify-center bg-black/60"
      style={{ animation: "jg-backdrop-in 150ms ease-out both" }}
      onClick={onClose}
    >
      <FloatingCard
        className="flex w-[900px] max-h-[85vh] flex-col p-5"
        onClick={(e) => e.stopPropagation()}
        style={{ animation: "jg-popup-scale-in 180ms cubic-bezier(.2,.85,.35,1) both" }}
      >
        <div className="mb-3 flex items-center justify-between">
          <span className="text-[13.5px] font-medium text-fg">Resultado</span>
          <button onClick={onClose} className="text-subtle hover:text-fg" aria-label="Cerrar">
            ✕
          </button>
        </div>
        <div
          className="grid flex-1 gap-3 overflow-hidden"
          style={{ gridTemplateColumns: "2fr 1fr 1fr", gridTemplateRows: "1fr 1fr" }}
        >
          {hero && (
            <div style={{ gridColumn: "1", gridRow: "1 / 3" }} className="overflow-y-auto">
              <WidgetCard widget={hero} />
            </div>
          )}
          {secondary.map((widget) => (
            <div key={widget.id}>
              <WidgetCard widget={widget} />
            </div>
          ))}
        </div>
      </FloatingCard>
    </div>
  );
}
