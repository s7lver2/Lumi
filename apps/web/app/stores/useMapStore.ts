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
  // Whole-planet view on first load — the app then flies in to the target
  // area once a search resolves (see lib/map-camera.ts); overridden by user pan.
  viewport: { lat: 0, lng: 0, zoom: 1.4 },
  setMode: (mode) => set({ mode }),
  setViewport: (viewport) => set({ viewport }),
}));