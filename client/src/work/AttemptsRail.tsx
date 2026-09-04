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
  open, shiftedBy, analyses, selected, onSelect, onAnalyze, onMenu,
}: {
  open: boolean;
  shiftedBy: number;
  analyses: Analysis[];
  selected: number | null;
  onSelect: (id: number) => void;
  onAnalyze: () => void;
  onMenu: (s: MenuState) => void;
}) {
  const menuDe = (a: Analysis): MenuEntry[] => {
    const hecho = a.state === "hecho";
    return [
      { label: "Repetir con otro modelo…", onClick: onAnalyze },
      hecho
        ? {
            label: "Copiar coordenadas", hint: "⌘C",
            onClick: () => void navigator.clipboard.writeText(
              `${a.result_lat!.toFixed(6)}, ${a.result_lng!.toFixed(6)}`),
          }
        : null,
    ];
  };

  return (
    <RailShell open={open} shiftedBy={shiftedBy}>
      <p className="mb-1 text-center text-[7.5px] uppercase tracking-[.1em] text-subtle">
        Intentos
      </p>
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
