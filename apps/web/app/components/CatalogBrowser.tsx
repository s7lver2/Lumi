// apps/web/app/components/CatalogBrowser.tsx
"use client";
import { useState } from "react";
import { DatasetsSection } from "./DatasetsSection";
import { ModelosSection } from "./ModelosSection";

export function CatalogBrowser({ onClose }: { onClose: () => void }) {
  const [section, setSection] = useState<"datasets" | "models">("datasets");
  const [query, setQuery] = useState("");

  function changeSection(next: "datasets" | "models") {
    setSection(next);
    setQuery("");
  }

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/60">
      <div className="flex h-[80vh] w-[900px] flex-col overflow-hidden rounded-card border border-white/10 bg-surface">
        <div className="flex items-center gap-3 border-b border-white/10 bg-panel px-4 py-2.5">
          <div className="flex gap-1">
            {(["datasets", "models"] as const).map((id) => (
              <button
                key={id}
                onClick={() => changeSection(id)}
                className={`rounded-md px-3 py-1.5 text-[12.5px] ${
                  section === id ? "bg-white/[.08] text-fg" : "text-muted hover:text-fg"
                }`}
              >
                {id === "datasets" ? "Datasets" : "Modelos"}
              </button>
            ))}
          </div>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={section === "datasets" ? "Buscar dataset…" : "Buscar versión…"}
            className="flex-1 rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-fg outline-none focus:border-white/25"
          />
          <button onClick={onClose} className="text-subtle hover:text-fg">✕</button>
        </div>
        <div className="min-h-0 flex-1">
          {section === "datasets" ? <DatasetsSection query={query} /> : <ModelosSection query={query} />}
        </div>
      </div>
    </div>
  );
}
