import { EnlacePrevio } from "./EnlacePrevio";

/** Enlace a una página de la rama "modelos" (la identidad propia de Lumi:
 *  Lumi Preview, los niveles, generaciones futuras) — mismo patrón que
 *  `Tec.tsx` para "tecnologias", pero apuntando a otra rama. `id` es el
 *  slug de la ruta; indice-docs.mjs falla el build si no existe ahí. */
export function Modelo({ id, children }: { id: string; children: React.ReactNode }) {
  return <EnlacePrevio ruta={`/docs/modelos/${id}`}>{children}</EnlacePrevio>;
}
