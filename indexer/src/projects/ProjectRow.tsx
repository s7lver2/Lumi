import type { Proyecto } from "../lib/api";

/** Fila de la columna lateral: nombre corto arriba, `full_name` completo en
 *  mono debajo — sin icono en caja de color (DESIGN.md). */
export function ProjectRow({ p, activo, onAbrir }: { p: Proyecto; activo: boolean; onAbrir: () => void }) {
  const nombreCorto = p.repo.split("/").pop() ?? p.repo;
  return (
    <button onClick={onAbrir}
      className={`jg-press flex w-full flex-col rounded-lg px-2.5 py-2 text-left transition-colors ${
        activo ? "bg-white/[.07] text-fg" : "text-subtle hover:bg-white/[.04] hover:text-fg"}`}>
      <span className="truncate text-[11.5px]">{nombreCorto}</span>
      <span className="truncate font-mono text-[9.5px] text-subtle">{p.repo}</span>
    </button>
  );
}
