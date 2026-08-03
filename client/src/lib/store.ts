import { create } from "zustand";
import type { Hello, Sample } from "./api";

interface ServerState {
  key: string; hello: Hello | null; token: string | null; sample: Sample | null;
  setKey: (k: string) => void;
  setHello: (h: Hello | null) => void;
  setToken: (t: string | null) => void;
  setSample: (s: Sample | null) => void;
}

export const useServer = create<ServerState>((set) => ({
  key: "", hello: null, token: null, sample: null,
  setKey: (key) => set({ key }),
  setHello: (hello) => set({ hello }),
  setToken: (token) => set({ token }),
  setSample: (sample) => set({ sample }),
}));
