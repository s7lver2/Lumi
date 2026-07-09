// apps/web/app/components/AreaCard.tsx
import Link from "next/link";
import { Badge } from "./Badge";
import { statusTone } from "../lib/area-status";
import type { AreaStatus } from "@netryx/shared-types";

export interface AreaListItem {
  id: string;
  name: string | null;
  area_km2: string | number;
  status: AreaStatus;
  images_embedded: number;
  created_at: string;
}

export function AreaCard({ area }: { area: AreaListItem }) {
  return (
    <Link
      href={`/areas/${area.id}`}
      className="block rounded-card border border-border bg-panel/70 p-4 backdrop-blur-sm hover:border-white/20"
    >
      <div className="flex items-start justify-between">
        <span className="text-sm font-medium text-fg">{area.name ?? "Área sin nombre"}</span>
        <Badge tone={statusTone(area.status)}>{area.status}</Badge>
      </div>
      <div className="mt-3 flex gap-4 text-xs">
        <div>
          <div className="text-subtle">km²</div>
          <div className="mt-0.5 text-fg">{Number(area.area_km2).toFixed(1)}</div>
        </div>
        <div>
          <div className="text-subtle">imágenes</div>
          <div className="mt-0.5 text-fg">{area.images_embedded.toLocaleString()}</div>
        </div>
        <div>
          <div className="text-subtle">fecha</div>
          <div className="mt-0.5 text-fg">
            {new Date(area.created_at).toLocaleDateString("es-ES", { day: "numeric", month: "short" })}
          </div>
        </div>
      </div>
    </Link>
  );
}