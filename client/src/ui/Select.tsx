import { useEffect, useState } from "react";
import { Icon } from "./Icon";

/** Reemplaza el `<select>` nativo — su lista desplegada no se puede vestir
 *  con nada (cada navegador la pinta con su propio chrome del sistema, sin
 *  forma de tocarle el color, el borde o la tipografía), así que en un panel
 *  oscuro se ve siempre fuera de sitio. Este es el mismo patrón de lista
 *  flotante que ya usa el resto del panel (`AdminEventToast`, los popovers
 *  de emoji), solo que aquí hace de `<select>`. */
export function Select<T extends string>({ value, onChange, options, className = "" }: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  className?: string;
}) {
  const [abierto, setAbierto] = useState(false);
  const actual = options.find((o) => o.value === value);

  useEffect(() => {
    if (!abierto) return;
    // Cerrar con Escape, igual que un `<select>` nativo — sin esto, la única
    // forma de cerrar sin elegir nada era el backdrop.
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setAbierto(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [abierto]);

  return (
    <div className={`relative ${className}`}>
      <button type="button" onClick={() => setAbierto((v) => !v)}
        className={`jg-press flex w-full items-center justify-between gap-2 rounded-[7px] border px-2.5 py-1.5
          text-[10.5px] transition-colors duration-300 ease-expo
          ${abierto ? "border-white/30 bg-elevated text-fg" : "border-border bg-panel text-fg hover:border-white/20"}`}>
        <span className="truncate">{actual?.label ?? value}</span>
        <Icon name="chevron" size={9}
          className={`shrink-0 text-subtle transition-transform duration-300 ease-expo ${abierto ? "rotate-180" : ""}`} />
      </button>
      {abierto && (
        <>
          {/* Captura el clic fuera para cerrar — el propio backdrop es
              invisible, solo existe para esta detección. */}
          <div className="fixed inset-0 z-40" onClick={() => setAbierto(false)} />
          <div className="absolute left-0 top-[calc(100%+5px)] z-50 max-h-64 min-w-full overflow-y-auto
            rounded-[9px] border border-border bg-elevated py-1 shadow-lg shadow-black/50"
            style={{ animation: "jg-fade-rise .16s cubic-bezier(.16,1,.3,1) both" }}>
            {options.map((o) => (
              <button key={o.value} type="button" onClick={() => { onChange(o.value); setAbierto(false); }}
                className={`flex w-full items-center justify-between gap-3 whitespace-nowrap px-3 py-[7px]
                  text-left text-[10.5px] transition-colors duration-150
                  ${o.value === value ? "bg-white/[.07] text-fg" : "text-muted hover:bg-white/[.05] hover:text-fg"}`}>
                {o.label}
                {o.value === value && <Icon name="check" size={10} className="shrink-0" />}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
