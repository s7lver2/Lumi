"use client";

import { useProfundidad } from "./ContextoProfundidad";

/** Un único control arriba a la derecha que abre o cierra todos los
 *  <Detalle> de la página a la vez (spec §3 B). Cada page.mdx lo coloca
 *  junto a la cabecera. */
export function ControlProfundidad() {
  const { valor, disparar } = useProfundidad();
  return (
    <button
      type="button"
      onClick={() => disparar(!valor)}
      className="jg-micro shrink-0 whitespace-nowrap rounded-[8px] border border-border px-[10px] py-[5px] text-[11px] text-subtle hover:border-[#33363b] hover:text-muted"
    >
      {valor ? "Cerrar todo" : "Leer en profundidad"}
    </button>
  );
}
