// apps/web/app/components/WidgetGrid.tsx
"use client";
import { useState } from "react";
import type { Widget } from "./widgets/types";

export function WidgetGrid({ widgets }: { widgets: Widget[] }) {
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(widgets.filter((w) => w.defaultExpanded).map((w) => w.id))
  );

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  const anyExpanded = expanded.size > 0;

  return (
    <div
      className={`flex h-full flex-col border-l border-border bg-panel/80 backdrop-blur-md transition-[width] duration-300 ${
        anyExpanded ? "w-full" : "w-[230px]"
      }`}
    >
      <div
        className={anyExpanded ? "grid flex-1 auto-rows-min gap-2.5 overflow-y-auto p-3" : "flex-1"}
        style={anyExpanded ? { gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))" } : undefined}
      >
        {widgets.map((widget) => {
          const isExpanded = expanded.has(widget.id);
          return (
            <div key={widget.id} style={isExpanded ? { gridColumn: `span ${widget.colSpan}` } : undefined}>
              <button
                onClick={() => toggle(widget.id)}
                className="flex w-full items-center gap-2 border-b border-white/[.08] px-3.5 py-2.5 text-left"
              >
                <span className="text-fg">{widget.icon}</span>
                <span className="flex-1 text-[11.5px] font-medium text-fg">{widget.title}</span>
                <svg
                  width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                  className={`text-subtle transition-transform ${isExpanded ? "rotate-180" : ""}`}
                >
                  <path d="M6 9l6 6 6-6" />
                </svg>
              </button>
              {isExpanded && <div className="p-3.5 pt-2">{widget.render()}</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}