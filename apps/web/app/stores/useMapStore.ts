// apps/web/app/stores/useMapStore.ts
import { create } from "zustand";

export interface Viewport {
  lat: number;
  lng: number;
  zoom: number;
}

interface MapState {
  mode: "search" | "draw";
  viewport: Viewport;
  setMode: (mode: MapState["mode"]) => void;
  setViewport: (viewport: Viewport) => void;
}

export const useMapStore = create<MapState>((set) => ({
  mode: "search",
  viewport: { lat: 42.6, lng: -5.57, zoom: 12 }, // León (spec test area); overridden by user pan
  setMode: (mode) => set({ mode }),
  setViewport: (viewport) => set({ viewport }),
}));