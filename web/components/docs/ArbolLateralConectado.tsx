"use client";

import { usePathname } from "next/navigation";
import { arbolDocs } from "../../lib/arbolDocs";
import { ArbolLateral } from "./ArbolLateral";

/** Envoltorio fino: usePathname() solo puede llamarse desde un client
 *  component, y app/docs/layout.tsx es un server component (así toda la
 *  navegación estática de las cinco ramas se sirve sin JS de por medio
 *  salvo este puente). */
export function ArbolLateralConectado() {
  const pathname = usePathname();
  const partes = pathname.split("/").filter(Boolean); // ["docs", ramaId, ruta] o ["docs"]
  const ramaId = partes[1];
  const ruta = partes[2];
  const rama = arbolDocs.find((r) => r.id === ramaId);
  const pagina = rama?.paginas.find((p) => p.ruta === ruta);
  const titulo = pagina ? `${rama!.titulo} · ${pagina.titulo}` : rama?.titulo ?? "Documentación";

  return <ArbolLateral rutaActual={pathname} tituloActual={titulo} />;
}
