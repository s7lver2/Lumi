// apps/web/app/components/AreasPopup.tsx
"use client";
import { useEffect, useState } from "react";
import { FloatingCard } from "./FloatingCard";
import { Badge } from "./Badge";
import { statusTone } from "../lib/area-status";
import { fetchJson } from "../lib/fetch-json";
import type { AreaStatus } from "@netryx/shared-types";

interface AreaItem { id: string; name: string | null; area_km2: string | number; status: AreaStatus; images_embedded: number; created_at: string }

export function AreasPopup({ onClose, onShowArea }: { onClose: () => void; onShowArea: (id: string) => void }) {
  const [areas, setAreas] = useState<AreaItem[]>([]);
  useEffect(() => { fetchJson<{ areas: AreaItem[] }>("/api/areas").then((r) => setAreas(r.data?.areas ?? [])); }, []);
  return (
    <div className="absolute right-4 top-16 z-30 w-80">
      <FloatingCard className="max-h-[70vh] overflow-y-auto p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-medium text-fg">Áreas indexadas</span>
          <button onClick={onClose} className="text-subtle hover:text-fg" aria-label="Cerrar">✕</button>
        </div>
        <div className="space-y-2">
          {areas.map((a) => (
            <button key={a.id} onClick={() => onShowArea(a.id)}
              className="block w-full rounded-card border border-border p-2.5 text-left hover:border-white/20">
              <div className="flex items-center justify-between">
                <span className="text-sm text-fg">{a.name ?? "Área"}</span>
                <Badge tone={statusTone(a.status)}>{a.status}</Badge>
              </div>
              <div className="mt-1 text-xs text-muted">{Number(a.area_km2).toFixed(1)} km² · {a.images_embedded.toLocaleString()} imágenes</div>
            </button>
          ))}
          {areas.length === 0 && <p className="text-xs text-muted">Aún no hay áreas indexadas.</p>}
        </div>
      </FloatingCard>
    </div>
  );
}