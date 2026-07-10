"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import MapboxDraw from "@mapbox/mapbox-gl-draw";
import DrawRectangle from "mapbox-gl-draw-rectangle-mode";
import { DragCircleMode } from "mapbox-gl-draw-circle";
import { snapPoint } from "../lib/snap";
import { useIndexingStore } from "../stores/useIndexingStore";
import { polygonAreaKm2 } from "../lib/geo";

import "@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css";

interface IndexingDrawToolProps {
  map: any;
  onModeChange?: (mode: string) => void;
}

// The bottom DrawToolbar speaks in semantic names; MapboxDraw uses its own.
const TO_DRAW: Record<string, string> = { polygon: "draw_polygon", rectangle: "draw_rectangle", circle: "draw_circle" };
const TO_SEMANTIC: Record<string, string> = { draw_polygon: "polygon", draw_rectangle: "rectangle", draw_circle: "circle" };

export function IndexingDrawTool({ map, onModeChange }: IndexingDrawToolProps) {
  const setDrawnPolygon = useIndexingStore((s) => s.setDrawnPolygon);
  const clearPolygon = useIndexingStore((s) => s.clearPolygon);

  const [snapEnabled, setSnapEnabled] = useState(false);
  const [streetFeatures, setStreetFeatures] = useState<any[]>([]);
  const drawRef = useRef<any>(null);

  const sync = useCallback(() => {
    if (!drawRef.current) return;
    const fc = drawRef.current.getAll();
    const feature = fc.features[0];
    if (!feature) {
      clearPolygon();
      return;
    }
    const ring = (feature.geometry as GeoJSON.Polygon).coordinates[0] as [number, number][];
    setDrawnPolygon(ring, polygonAreaKm2(ring));
  }, [setDrawnPolygon, clearPolygon]);

  // 1. Init MapboxDraw with NO native controls (the bottom toolbar drives it)
  //    and with rectangle + circle modes registered so changeMode() is valid.
  useEffect(() => {
    if (!map) return;

    const draw = new MapboxDraw({
      displayControlsDefault: false,
      modes: { ...MapboxDraw.modes, draw_rectangle: DrawRectangle, draw_circle: DragCircleMode },
    });

    drawRef.current = draw;
    map.addControl(draw);

    map.on("draw.create", sync);
    map.on("draw.update", sync);
    map.on("draw.delete", clearPolygon);

    const handleMode = (e: any) => {
      if (onModeChange) onModeChange(TO_SEMANTIC[e.mode] ?? e.mode);
    };
    map.on("draw.modechange", handleMode);

    return () => {
      if (map) {
        map.off("draw.create", sync);
        map.off("draw.update", sync);
        map.off("draw.delete", clearPolygon);
        map.off("draw.modechange", handleMode);
        if (drawRef.current) {
          try {
            map.removeControl(drawRef.current);
          } catch {
            // El mapa ya se destruyó por completo; ignorar.
          }
          drawRef.current = null;
        }
      }
    };
  }, [map, sync, clearPolygon, onModeChange]);

  // 2. Snapping en tiempo real durante draw.update
  useEffect(() => {
    if (!map || !snapEnabled || streetFeatures.length === 0) return;

    const onDrawUpdate = (e: any) => {
      let modified = false;
      const updatedFeatures = e.features.map((feature: any) => {
        if (feature.geometry.type === "Polygon") {
          const snappedRing = feature.geometry.coordinates[0].map((vertex: [number, number]) => {
            const snapped = snapPoint(vertex, streetFeatures, 25);
            if (snapped) {
              modified = true;
              return snapped;
            }
            return vertex;
          });
          feature.geometry.coordinates = [snappedRing];
        }
        return feature;
      });
      if (modified && drawRef.current) {
        updatedFeatures.forEach((f: any) => drawRef.current.add(f));
        sync();
      }
    };

    map.on("draw.update", onDrawUpdate);
    return () => {
      map.off("draw.update", onDrawUpdate);
    };
  }, [map, snapEnabled, streetFeatures, sync]);

  // 3. Puentes de eventos globales para la DrawToolbar
  useEffect(() => {
    const changeModeListener = (e: Event) => {
      const mode = (e as CustomEvent).detail?.mode;
      if (!drawRef.current || !mode) return;
      try {
        drawRef.current.changeMode(TO_DRAW[mode] ?? mode);
      } catch {
        // Modo no soportado por el build de MapboxDraw; ignorar en vez de romper.
      }
    };

    const clearListener = () => {
      if (drawRef.current) drawRef.current.deleteAll();
      clearPolygon();
    };

    const toggleSnapListener = (e: Event) => {
      const enabled = (e as CustomEvent).detail?.enabled;
      setSnapEnabled(enabled);
      if (enabled && map) {
        const bounds = map.getBounds();
        const bbox = `${bounds.getWest()},${bounds.getSouth()},${bounds.getEast()},${bounds.getNorth()}`;
        fetch(`/api/streets?bbox=${bbox}`)
          .then((r) => r.json())
          .then((data) => {
            if (data.lines?.features) setStreetFeatures(data.lines.features);
          })
          .catch(() => setStreetFeatures([]));
      }
    };

    window.addEventListener("draw-change-mode", changeModeListener);
    window.addEventListener("draw-clear", clearListener);
    window.addEventListener("draw-toggle-snap", toggleSnapListener);
    return () => {
      window.removeEventListener("draw-change-mode", changeModeListener);
      window.removeEventListener("draw-clear", clearListener);
      window.removeEventListener("draw-toggle-snap", toggleSnapListener);
    };
  }, [map, clearPolygon]);

  // 4. Escape sale a selección simple
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && drawRef.current) {
        drawRef.current.changeMode("simple_select");
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return null;
}