import { create } from "zustand";
import type { Case, Project } from "./api";

/** Proyecto y caso abiertos. Vive aparte de `useServer` a propósito: aquello
 *  es la conexión con el servidor y sobrevive al cierre de sesión; esto es
 *  dónde estás trabajando y muere con ella. */
interface Workspace {
  project: Project | null;
  case_: Case | null;
  setProject: (p: Project | null) => void;
  setCase: (c: Case | null) => void;
  clear: () => void;
}

export const useWorkspace = create<Workspace>((set) => ({
  project: null,
  case_: null,
  // Cambiar de proyecto cierra el caso: un caso pertenece a un proyecto y
  // dejarlo abierto al saltar sería enseñar datos del proyecto anterior.
  setProject: (project) => set({ project, case_: null }),
  setCase: (case_) => set({ case_ }),
  clear: () => set({ project: null, case_: null }),
}));
