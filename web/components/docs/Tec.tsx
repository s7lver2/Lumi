import { EnlacePrevio } from "./EnlacePrevio";

/** Enlace a una página de tecnología. `id` es el slug de la ruta dentro de
 *  la rama "tecnologias" (spec §2, tabla de componentes). indice-docs.mjs
 *  falla el build si `id` no existe ahí. */
export function Tec({ id, children }: { id: string; children: React.ReactNode }) {
  return <EnlacePrevio ruta={`/docs/tecnologias/${id}`}>{children}</EnlacePrevio>;
}
