import type { Analysis } from "../lib/api";
import type { MenuEntry, MenuState } from "../ui/ContextMenu";
import { menuAt } from "../ui/ContextMenu";
import { Icon } from "../ui/Icon";
import { RailShell } from "./Drawer";

/** El carril angosto de intentos: qué análisis existen para la imagen
 *  seleccionada, sin ninguno de sus datos — eso vive en el cajón de detalle,
 *  de al lado. Antes esta lista vivía DENTRO del cajón de detalle y lo
 *  llenaba entero en cuanto había unos pocos intentos, empujando el
 *  resultado de verdad fuera de la vista. */
export function AttemptsRail({
  open, shiftedBy, analyses, selected, onSelect, onAnalyze, onEliminar, onLimpiar, onMenu,
}: {
  open: boolean;
  shiftedBy: number;
  analyses: Analysis[];
  selected: number | null;
  onSelect: (id: number) => void;
  onAnalyze: () => void;
  onEliminar: (id: number) => void;
  onLimpiar: () => void;
  onMenu: (s: MenuState) => void;
}) {
  const menuDe = (a: Analysis): MenuEntry[] => {
    const hecho = a.state === "hecho";
    // Igual que el DELETE que ya arbitra el backend: lo que está corriendo
    // ahora mismo no se cancela a mitad, todo lo demás (pendiente, hecho,
    // error) sí se puede borrar.
    const corriendo = a.state === "en_curso";
    return [
      { label: "Repetir con otro modelo…", onClick: onAnalyze },
      hecho
        ? {
            label: "Copiar coordenadas", hint: "⌘C",
            onClick: () => void navigator.clipboard.writeText(
              `${a.result_lat!.toFixed(6)}, ${a.result_lng!.toFixed(6)}`),
          }
        : null,
      null,
      { label: "Borrar", danger: true, disabled: corriendo, onClick: () => onEliminar(a.id) },
    ];
  };

  return (
    <RailShell open={open} shiftedBy={shiftedBy}>
      <div className="mb-1 flex items-center justify-between gap-1 px-0.5">
        <p className="text-[7.5px] uppercase tracking-[.1em] text-subtle">Intentos</p>
        {analyses.length > 0 && (
          <button onClick={onLimpiar} title="Borrar todos los intentos de esta imagen"
            className="text-subtle transition-colors duration-200 hover:text-danger-fg">
            <Icon name="trash" size={10} />
          </button>
        )}
      </div>
      {analyses.map((a, i) => {
        const on = a.id === selected;
        const icon = a.state === "hecho" ? "check" : a.state === "error" ? "x" : "spinner";
        return (
          <button key={a.id} onClick={() => onSelect(a.id)}
            onContextMenu={(e) => menuAt(e, `${i + 1} · ${a.model}`, menuDe(a), onMenu)}
            style={{ animation: `jg-fade-rise 220ms ${Math.min(i, 6) * 30}ms cubic-bezier(.16,1,.3,1) both` }}
            className={`flex flex-col items-center gap-1 rounded-lg border p-[6px_2px] text-center
              transition-[border-color,background-color] duration-300 ease-expo ${
                on ? "border-white/[.35] bg-white/[.05]" : "border-border hover:border-white/[.18]"}`}>
            <span className="text-[8px] uppercase tracking-[.06em] text-subtle">{a.model}</span>
            <Icon name={icon} size={12}
              className={a.state === "error" ? "text-danger-fg" : a.state === "hecho" ? "text-fg" : "text-subtle"} />
          </button>
        );
      })}
    </RailShell>
  );
}
