// apps/web/app/components/MapDropTarget.tsx
"use client";
import { useState } from "react";

export function MapDropTarget({ onFiles }: { onFiles: (files: File[]) => void }) {
  const [over, setOver] = useState(false);
  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault(); setOver(false);
        const files = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith("image/"));
        if (files.length) onFiles(files);
      }}
      className={`absolute inset-0 z-10 ${over ? "bg-accent/10 ring-2 ring-inset ring-accent-fg/40" : "pointer-events-none"}`}
    >
      {over && (
        <div className="pointer-events-none flex h-full items-center justify-center">
          <span className="rounded-card bg-panel/80 px-4 py-2 text-sm text-fg backdrop-blur-md">Suelta la imagen para buscar</span>
        </div>
      )}
    </div>
  );
}