// apps/web/app/components/IndexingDrawTool.tsx
"use client";

import { useEffect, useRef } from "react";
import MapboxDraw from "@mapbox/mapbox-gl-draw";
import { useIndexingStore } from "../stores/useIndexingStore";
import { polygonAreaKm2 } from "../lib/geo";

// El CSS se importa estáticamente aquí. Al estar en un archivo "use client" que 
// se monta dentro de un árbol dinámico (ssr: false), no causará problemas en el servidor.
import "@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css";

export function IndexingDrawTool({ map }: { map: any }) {
  const setDrawnPolygon = useIndexingStore((s) => s.setDrawnPolygon);
  const clearPolygon = useIndexingStore((s) => s.clearPolygon);
  const drawRef = useRef<any>(null);

  useEffect(() => {
    if (!map) return;

    // Inicializamos la instancia de control de dibujo
    const draw = new MapboxDraw({
      displayControlsDefault: false,
      controls: { polygon: true, trash: true },
    });
    
    drawRef.current = draw;
    map.addControl(draw);

    const sync = () => {
      const fc = draw.getAll();
      const feature = fc.features[0];
      if (!feature) {
        clearPolygon();
        return;
      }
      const ring = (feature.geometry as GeoJSON.Polygon).coordinates[0] as [number, number][];
      setDrawnPolygon(ring, polygonAreaKm2(ring));
    };

    map.on("draw.create", sync);
    map.on("draw.update", sync);
    map.on("draw.delete", clearPolygon);

    // Limpieza estricta del ciclo de vida del mapa
    return () => {
      if (map) {
        map.off("draw.create", sync);
        map.off("draw.update", sync);
        map.off("draw.delete", clearPolygon);

        if (drawRef.current) {
          try {
            map.removeControl(drawRef.current);
          } catch {
            // map.remove() (MapCanvas's own unmount cleanup) already tears
            // down every attached control internally — if that ran first,
            // this control's onRemove already fired and its internal state
            // is gone. Nothing left to clean up in that case.
          }
          drawRef.current = null;
        }
      }
    };
  }, [map, setDrawnPolygon, clearPolygon]);

  return null;
}