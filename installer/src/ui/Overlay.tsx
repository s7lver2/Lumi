import type { ReactNode } from "react";

/** El velo de "Composición de estado" en DESIGN.md: rgba(5,7,10,.55) con su
 *  propio desenfoque, no el bg-black/40 genérico. `absolute`, nunca `fixed`
 *  — con el `transform: scale(--ui-scale)` de `#root`, un hijo `fixed` no
 *  mide contra la ventana real, y ya nos costó una tarde entender eso una
 *  vez con `h-screen`. Un solo componente para los seis diálogos flotantes
 *  del Indexer: la consistencia queda garantizada por construcción, no por
 *  copiar la clase correcta cada vez. */
export function Overlay({ children }: { children: ReactNode }) {
  return (
    <div className="absolute inset-0 z-40 grid place-items-center bg-[rgba(5,7,10,.55)] backdrop-blur-[3px]">
      {children}
    </div>
  );
}
