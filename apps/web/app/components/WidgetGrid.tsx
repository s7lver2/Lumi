// apps/web/app/components/WidgetGrid.tsx
"use client";
import type { Widget } from "./widgets/types";
import { InfoTooltip } from "./InfoTooltip";

export function WidgetGrid({ widgets }: { widgets: Widget[] }) {
  return (
    <div className="flex h-full w-full flex-col overflow-y-auto border-l border-border bg-panel/80 backdrop-blur-md">
      {widgets.map((widget) => (
        <div key={widget.id} className="border-b border-white/[.08]">
          <div className="flex items-center gap-2 px-3.5 py-2.5">
            <span className="text-fg">{widget.icon}</span>
            <span className="flex-1 text-[11.5px] font-medium text-fg">{widget.title}</span>
            {widget.tooltip && <InfoTooltip text={widget.tooltip} />}
          </div>
          <div className="px-3.5 pb-3.5">{widget.render()}</div>
        </div>
      ))}
    </div>
  );
}
