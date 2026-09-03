"use client";
import { useState } from "react";

/** Botón de copiar del bloque de instalación del hero. Componente de
 *  cliente aparte para que app/page.tsx pueda quedar como Server Component
 *  y así componer directamente `<Cobertura/>` (async, lee el catálogo). */
export function BotonCopiarComando({ comando }: { comando: string }) {
  const [copiado, setCopiado] = useState(false);

  async function copiar() {
    try {
      await navigator.clipboard.writeText(comando);
    } catch {
      // clipboard no disponible (contexto no seguro, permisos…): sin fallback,
      // el usuario puede seleccionar el comando a mano.
    }
    setCopiado(true);
    setTimeout(() => setCopiado(false), 1800);
  }

  return (
    <button
      type="button"
      onClick={copiar}
      className="rounded-[6px] border border-border px-2 py-1 font-mono text-[11px] text-muted hover:text-fg"
    >
      {copiado ? "copiado" : "copiar"}
    </button>
  );
}
