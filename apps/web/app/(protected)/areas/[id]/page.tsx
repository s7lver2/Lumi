// apps/web/app/(protected)/areas/[id]/page.tsx
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { MapCanvas } from "../../../components/MapCanvas";
import { FloatingCard } from "../../../components/FloatingCard";
import { Badge } from "../../../components/Badge";
import { statusTone } from "../../../lib/area-status";

export default function AreaDetailPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const [data, setData] = useState<any>(null);
  const [map, setMap] = useState<any>(null);

  useEffect(() => {
    fetch(`/api/areas/${params.id}`)
      .then((r) => r.json())
      .then(setData);
  }, [params.id]);

  useEffect(() => {
    if (!map || !data) return;
    const draw = () => {
      if (!map.getSource("area-poly")) {
        map.addSource("area-poly", { type: "geojson", data: data.area.geometry });
        map.addLayer({
          id: "area-poly-line",
          type: "line",
          source: "area-poly",
          paint: { "line-color": "#85b7eb", "line-width": 1.5 },
        });
      }
      if (!map.getSource("area-points")) {
        map.addSource("area-points", { type: "geojson", data: data.points });
        map.addLayer({
          id: "area-points-dots",
          type: "circle",
          source: "area-points",
          paint: { "circle-radius": 2.5, "circle-color": "#5dcaa5", "circle-opacity": 0.8 },
        });
      }
    };
    if (map.isStyleLoaded()) draw();
    else map.once("load", draw);
  }, [map, data]);

  async function handleDelete() {
    await fetch(`/api/areas/${params.id}`, { method: "DELETE" });
    router.push("/areas");
  }
  async function handleReindex() {
    await fetch(`/api/areas/${params.id}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "reindex" }),
    });
    router.refresh();
  }

  return (
    <>
      <MapCanvas onReady={(m) => setMap(m)} />
      {data && (
        <div className="absolute right-4 top-4 w-72">
          <FloatingCard className="p-4">
            <div className="flex items-start justify-between">
              <h1 className="text-sm font-medium text-fg">{data.area.name ?? "Área"}</h1>
              <Badge tone={statusTone(data.area.status)}>{data.area.status}</Badge>
            </div>
            <div className="mt-3 space-y-1 text-xs text-muted">
              <div>{Number(data.area.area_km2).toFixed(1)} km²</div>
              <div>{data.area.images_embedded.toLocaleString()} imágenes embebidas</div>
              {data.area.actual_cost_usd != null && <div>Coste real: ${Number(data.area.actual_cost_usd).toFixed(2)}</div>}
            </div>
            <div className="mt-4 flex gap-2">
              <button onClick={handleReindex} className="flex-1 rounded-md bg-elevated py-2 text-xs text-fg hover:bg-white/10">
                Reindexar
              </button>
              <button onClick={handleDelete} className="flex-1 rounded-md border border-danger/40 py-2 text-xs text-danger-fg hover:bg-danger/10">
                Borrar
              </button>
            </div>
          </FloatingCard>
        </div>
      )}
    </>
  );
}