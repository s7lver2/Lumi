// apps/web/app/components/ConfidenceCircleLayer.tsx
"use client";

import { useEffect } from "react";
import * as turf from "@turf/turf";
import { useSearchStore } from "../stores/useSearchStore";
import { flyToRegion } from "../lib/map-camera";

// Once a region has been refined (its top candidate has a verificationScore),
// RoMa-based verification has already geometrically pinned the location down — showing
// the same fixed 150m clustering-bucket circle at that point would be the
// same false-precision problem already fixed once for the "Radio" label
// (see TopResultCard.tsx/BottomSummaryBar.tsx). Collapse to a small, fixed
// radius "pin" instead, centered on the verified candidate's own lat/lng
// (not the region's original, fuzzier centroid).
const REFINED_RADIUS_KM = 0.003; // ~3m — reads as a precise point, not a search area

export function ConfidenceCircleLayer({ map }: { map: any }) {
  const regions = useSearchStore((s) => s.regions);
  const candidatesByRegion = useSearchStore((s) => s.candidatesByRegion);
  const selectedRegionId = useSearchStore((s) => s.selectedRegionId);
  const selectRegion = useSearchStore((s) => s.selectRegion);

  useEffect(() => {
    if (!map) return;

    const regionGeometry = regions.map((r) => {
      const top = candidatesByRegion[r.id]?.[0];
      const refined = top?.verificationScore != null;
      const center: [number, number] = refined ? [top!.lng, top!.lat] : [r.centroid.lng, r.centroid.lat];
      const radiusKm = refined ? REFINED_RADIUS_KM : r.radiusM / 1000;
      return { region: r, center, radiusKm, refined };
    });

    const circles: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: regionGeometry.map(({ region: r, center, radiusKm, refined }, i) =>
        turf.circle(center, radiusKm, {
          units: "kilometers",
          properties: { id: r.id, rank: i + 1, selected: r.id === selectedRegionId, refined },
        })
      ),
    };
    const centroids: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: regionGeometry.map(({ region: r, center, refined }, i) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: center },
        properties: { id: r.id, rank: i + 1, selected: r.id === selectedRegionId, refined },
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
          "fill-color": "#e8e8e6",
          "fill-opacity": ["case", ["get", "selected"], 0.16, 0.07],
        },
      });
      map.addLayer({
        id: "lumi-conf-circles-line",
        type: "line",
        source: "lumi-conf-circles",
        paint: {
          "line-color": "#e8e8e6",
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
          "circle-stroke-color": ["case", ["get", "selected"], "#e8e8e6", "#4a4c50"],
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
        if (!id) return;
        selectRegion(id);
        const region = regions.find((r) => r.id === id);
        if (region) flyToRegion(map, region);
      });
      map.on("mouseenter", "lumi-conf-centroids-circle", () => (map.getCanvas().style.cursor = "pointer"));
      map.on("mouseleave", "lumi-conf-centroids-circle", () => (map.getCanvas().style.cursor = ""));
    }

    if (map.isStyleLoaded()) apply();
    else map.once("load", apply);
  }, [map, regions, candidatesByRegion, selectedRegionId, selectRegion]);

  return null;
}