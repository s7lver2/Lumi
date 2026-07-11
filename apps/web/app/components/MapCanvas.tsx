// apps/web/app/components/MapCanvas.tsx
"use client";

import dynamic from "next/dynamic";

// ssr:false is mandatory — mapbox-gl/maplibre-gl touch `window` on import (spec §5.2).
const MapCanvasClient = dynamic(() => import("./MapCanvas.client"), {
  ssr: false,
  loading: () => <div className="absolute inset-0 bg-surface" />,
});

export function MapCanvas({ onReady }: { onReady?: (map: any, provider: "mapbox" | "maplibre") => void }) {
  return <MapCanvasClient onReady={onReady} />;
}