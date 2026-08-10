import { useEffect, useState } from "react";

import { api, type TrabajoDe } from "../lib/api";

/** Etiqueta legible de una `TrabajoDe`, espejo de `TrabajoDe::etiqueta` en Rust
 *  (esa función es privada al crate, así que no hay forma de compartirla). */
function etiquetaDe(t: TrabajoDe): string {
  if (t === "Aqui") return "indexado aquí";
  if ("Local" in t) return `de «${t.Local}»`;
  return t.Catalogo;
}

/** Cuántas filas se listan de una vez. Un índice de miles de teselas no
 *  necesita mostrarlas todas para que "Liberar" sea usable — es una lista de
 *  gestión, no un mapa que tenga que representar el territorio entero. */
const TOPE_FILAS = 300;

/** "Liberar" por tesela (spec de versiones, sección 3): borra sus imágenes y
 *  vectores para este índice y deja la maquinaria de descarga que ya existe
 *  tratarla como si nunca se hubiera bajado. Solo tiene sentido con el índice
 *  abierto — el padre de esta pantalla ya lo garantiza. */
export function TeselasPanel({ indiceId }: { indiceId: number }) {
  const [teselas, setTeselas] = useState<[string, TrabajoDe][] | null>(null);
  const [liberando, setLiberando] = useState<string | null>(null);

  const refrescar = () => void api.indiceTeselas(indiceId).then(setTeselas);
  useEffect(refrescar, [indiceId]);

  async function liberar(quadkey: string) {
    setLiberando(quadkey);
    try {
      await api.teselaLiberar(indiceId, quadkey);
      refrescar();
    } finally {
      setLiberando(null);
    }
  }

  if (!teselas || teselas.length === 0) return null;
  const visibles = teselas.slice(0, TOPE_FILAS);

  return (
    <div>
      <p className="mb-2 text-[10.5px] uppercase tracking-[.08em] text-subtle">Teselas</p>
      <div className="flex max-h-[260px] flex-col gap-1 overflow-y-auto rounded-lg border border-border p-1.5">
        {visibles.map(([quadkey, trabajo]) => (
          <div key={quadkey} className="flex items-center justify-between gap-2 rounded-md px-2 py-1 text-[11px]">
            <span className="truncate font-mono text-fg">{quadkey}</span>
            <span className="flex shrink-0 items-center gap-2">
              <span className="text-subtle">{etiquetaDe(trabajo)}</span>
              <button
                onClick={() => void liberar(quadkey)}
                disabled={liberando === quadkey}
                className="jg-press rounded-full border border-border px-1.5 py-px text-[9px] text-subtle hover:border-danger hover:text-danger-fg disabled:opacity-40"
              >
                {liberando === quadkey ? "Liberando…" : "Liberar"}
              </button>
            </span>
          </div>
        ))}
      </div>
      {teselas.length > TOPE_FILAS && (
        <p className="mt-1.5 font-mono text-[9.5px] text-subtle">
          y {(teselas.length - TOPE_FILAS).toLocaleString("es-ES")} más
        </p>
      )}
    </div>
  );
}
