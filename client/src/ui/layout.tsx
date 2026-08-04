import type { ReactNode } from "react";

/** Ancho del carril y alto de la barra superior, en CSS px lógicos. */
export const RAIL_W = 44;
export const TOPBAR_H = 38;

/** Centra a sus hijos en el lienzo de trabajo — a la derecha del carril,
 *  debajo de la barra superior — con flexbox, no con `left/top: 50%` +
 *  `translate` + aritmética a mano. Un popup que se centraba así quedaba
 *  corrido hacia esa esquina, y arreglarlo con `calc(50% + Npx)` seguía
 *  dependiendo de que la aritmética cuadrara bajo el `transform: scale()`
 *  global de `--ui-scale` en cada tamaño de ventana — justo la clase de
 *  cosa que un cálculo a mano puede desalinear y flexbox no, porque el
 *  centrado lo hace el navegador contra la caja real del contenedor, no
 *  contra un porcentaje que alguien tuvo que acertar.
 *
 *  `chrome=false` para cuando no hay carril ni barra encima (el selector de
 *  proyectos). Sin backdrop propio, pasa los clics a lo que hay detrás —
 *  igual que hacía el `left/top` que sustituye — salvo que se pida lo
 *  contrario con `blocking`. */
export function Center({ chrome = true, blocking = false, className = "", onClick, children }: {
  chrome?: boolean;
  blocking?: boolean;
  className?: string;
  onClick?: () => void;
  children: ReactNode;
}) {
  return (
    <div onClick={onClick}
      className={`absolute inset-0 flex items-center justify-center ${blocking ? "" : "pointer-events-none"} ${className}`}
      style={chrome ? { paddingLeft: RAIL_W, paddingTop: TOPBAR_H } : undefined}>
      {blocking ? children : <div className="pointer-events-auto">{children}</div>}
    </div>
  );
}
