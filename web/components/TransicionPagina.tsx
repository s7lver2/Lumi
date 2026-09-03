"use client";

import { usePathname } from "next/navigation";

/** Envuelve el contenido de cada página. Al cambiar de ruta, React remonta
 *  el hijo (la key es la propia ruta) y el nuevo contenido entra con la
 *  misma curva de entrada que ya usa el resto del sitio, en vez de
 *  aparecer de golpe al navegar entre páginas. */
export function TransicionPagina({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <div key={pathname} className="jg-reveal-up">
      {children}
    </div>
  );
}
