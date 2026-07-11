// apps/web/app/components/MapCanvas.client.tsx
"use client";

import { useEffect, useRef } from "react";
import { useMapStore } from "../stores/useMapStore";
import { addBuildingsLayer } from "../lib/map-buildings";
import { fetchJson } from "../lib/fetch-json";
import "mapbox-gl/dist/mapbox-gl.css";
import "maplibre-gl/dist/maplibre-gl.css";

type Provider = "mapbox" | "maplibre";

interface MapConfig {
  provider: Provider;
  styleUrl: string;
  mapboxToken: string | null;
}

// If /api/map-config ever fails or returns nothing, fall back to the free,
// keyless MapLibre setup so the map still renders instead of the whole page
// crashing on a bad JSON.parse.
const FALLBACK_CONFIG: MapConfig = {
  provider: "maplibre",
  styleUrl: "https://tiles.openfreemap.org/styles/liberty",
  mapboxToken: null,
};

export default function MapCanvasClient({
    onReady,
}: {
    onReady?: (map: any, provider: Provider) => void;
}) {
    const container = useRef<HTMLDivElement>(null);
    const mapRef = useRef<any>(null);
    const viewport = useMapStore.getState().viewport;
    const setViewport = useMapStore((s) => s.setViewport);

    useEffect(() => {
        let cancelled = false;
        let map: any;

        async function init() {
            const { ok, data } = await fetchJson<MapConfig>("/api/map-config");
            if (cancelled || !container.current) return;
            const cfg: MapConfig = ok && data ? data : FALLBACK_CONFIG;

            let map: any;
            if (cfg.provider === "mapbox") {
                const mapboxgl = (await import("mapbox-gl")).default;
                mapboxgl.accessToken = cfg.mapboxToken;
                map = new mapboxgl.Map({
                    container: container.current,
                    style: cfg.styleUrl,
                    center: [viewport.lng, viewport.lat],
                    zoom: viewport.zoom,
                    pitch: 45, // tilt so 3D buildings are visible
                    attributionControl: true,
                });
            } else {
                const maplibregl = (await import("maplibre-gl")).default;
                map = new maplibregl.Map({
                    container: container.current,
                    style: cfg.styleUrl,
                    center: [viewport.lng, viewport.lat],
                    zoom: viewport.zoom,
                    pitch: 45,
                });
            }
            mapRef.current = map;

            map.on("error", (e: any) => {
                console.error("[MapCanvas] map error:", e?.error || e);
            });
            map.on("load", () => {
                console.log("[MapCanvas] canvas size after load:", map.getCanvas().width, map.getCanvas().height);
                addBuildingsLayer(map, cfg.provider);
                onReady?.(map, cfg.provider);
            });
            map.on("moveend", () => {
                const c = map.getCenter();
                setViewport({ lat: c.lat, lng: c.lng, zoom: map.getZoom() });
            });
        }

        init().catch((err) => console.error("[MapCanvas] init failed:", err));
        return () => {
            cancelled = true;
            mapRef.current?.remove();
        };
        // onReady is intentionally not a dep — the map is created once.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return (
        <div className="absolute inset-0">
            {/*
              Este div interior es el que se pasa a mapbox-gl/maplibre-gl como `container`.
              Ambas librerías le añaden su propia clase (`mapboxgl-map` / `maplibregl-map`),
              que trae `position: relative` en su CSS. Si ese mismo div también llevara
              `absolute inset-0`, esa regla ganaría sobre nuestro posicionamiento (según
              orden de carga de los stylesheets) y el mapa colapsaría a su tamaño de
              fallback interno. Por eso el posicionamiento vive en el div exterior y este
              solo se limita a ocupar el 100% del padre.
            */}
            <div ref={container} className="w-full h-full" />
        </div>
    );
}