// apps/web/app/components/ConfidenceCircleLayer.tsx
"use client";

import { useEffect } from "react";
import * as turf from "@turf/turf";
import { useSearchStore } from "../stores/useSearchStore";

export function ConfidenceCircleLayer({ map }: { map: any }) {
  const regions = useSearchStore((s) => s.regions);
  const selectedRegionId = useSearchStore((s) => s.selectedRegionId);
  const selectRegion = useSearchStore((s) => s.selectRegion);

  useEffect(() => {
    if (!map) return;

    const circles: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: regions.map((r, i) =>
        turf.circle([r.centroid.lng, r.centroid.lat], r.radiusM / 1000, {
          units: "kilometers",
          properties: { id: r.id, rank: i + 1, selected: r.id === selectedRegionId },
        })
      ),
    };
    const centroids: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: regions.map((r, i) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [r.centroid.lng, r.centroid.lat] },
        properties: { id: r.id, rank: i + 1, selected: r.id === selectedRegionId },
      })),
    };

    const apply = () => {
      for (const [id, data, add] of [
        ["lumi-conf-circles", circles, addCircles],
        ["lumi-conf-centroids", centroids, addCentroids],
      ] as const) {
        const src = map.getSource(id);
        if (src) src.setData(data);
        else add();
      }
    };

    function addCircles() {
      map.addSource("lumi-conf-circles", { type: "geojson", data: circles });
      map.addLayer({
        id: "lumi-conf-circles-fill",
        type: "fill",
        source: "lumi-conf-circles",
        paint: {
          "fill-color": "#5dcaa5",
          "fill-opacity": ["case", ["get", "selected"], 0.16, 0.07],
        },
      });
      map.addLayer({
        id: "lumi-conf-circles-line",
        type: "line",
        source: "lumi-conf-circles",
        paint: {
          "line-color": "#5dcaa5",
          "line-width": ["case", ["get", "selected"], 2, 1],
          "line-opacity": 0.7,
        },
      });
    }
    function addCentroids() {
      map.addSource("lumi-conf-centroids", { type: "geojson", data: centroids });
      map.addLayer({
        id: "lumi-conf-centroids-circle",
        type: "circle",
        source: "lumi-conf-centroids",
        paint: {
          "circle-radius": 13,
          "circle-color": "#15171a",
          "circle-stroke-color": ["case", ["get", "selected"], "#5dcaa5", "#4a4c50"],
          "circle-stroke-width": 2,
        },
      });
      map.addLayer({
        id: "lumi-conf-centroids-label",
        type: "symbol",
        source: "lumi-conf-centroids",
        layout: { "text-field": ["to-string", ["get", "rank"]], "text-size": 12 },
        paint: { "text-color": "#e8e8e6" },
      });
      map.on("click", "lumi-conf-centroids-circle", (e: any) => {
        const id = e.features?.[0]?.properties?.id;
        if (id) selectRegion(id);
      });
      map.on("mouseenter", "lumi-conf-centroids-circle", () => (map.getCanvas().style.cursor = "pointer"));
      map.on("mouseleave", "lumi-conf-centroids-circle", () => (map.getCanvas().style.cursor = ""));
    }

    if (map.isStyleLoaded()) apply();
    else map.once("load", apply);
  }, [map, regions, selectedRegionId, selectRegion]);

  return null;
}