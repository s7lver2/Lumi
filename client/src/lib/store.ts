import { create } from "zustand";
import type { Hello, Sample } from "./api";

interface ServerState {
  key: string; hello: Hello | null; token: string | null; sample: Sample | null;
  bootstrapToken: string;
  /** Dirección para mostrar en la franja. Propia y no derivada de `key`:
   *  tras reconectar sin la clave original (ya gastada) no hay `key` que
   *  parsear, pero sí sabemos la dirección por la sesión persistida. */
  addr: string;
  setKey: (k: string) => void;
  setHello: (h: Hello | null) => void;
  setToken: (t: string | null) => void;
  setSample: (s: Sample | null) => void;
  setBootstrapToken: (t: string) => void;
  setAddr: (a: string) => void;
}

export const useServer = create<ServerState>((set) => ({
  key: "", hello: null, token: null, sample: null, bootstrapToken: "", addr: "",
  setKey: (key) => set({ key }),
  setHello: (hello) => set({ hello }),
  setToken: (token) => set({ token }),
  setSample: (sample) => set({ sample }),
  setBootstrapToken: (bootstrapToken) => set({ bootstrapToken }),
  setAddr: (addr) => set({ addr }),
}));
