// apps/web/app/components/AreasNotification.tsx
"use client";
import { Badge } from "./Badge";

export function AreasNotification({ count, indexing, onOpen }: { count: number; indexing: number; onOpen: () => void }) {
  return (
    <button onClick={onOpen}
      className="flex items-center gap-2 rounded-card border border-white/10 bg-panel/80 px-3 py-2 text-xs text-fg backdrop-blur-md shadow-lg shadow-black/40 hover:bg-white/10">
      <span>{count} áreas</span>
      {indexing > 0 && <Badge tone="draw">{indexing} indexando</Badge>}
      <span className="text-subtle">▸</span>
    </button>
  );
}