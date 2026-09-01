import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export interface MenuItem {
  label: string;
  /** Atajo, solo para leerlo: quien lo teclea no pasa por aquí. */
  hint?: string;
  danger?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}
/** `null` es un separador. */
export type MenuEntry = MenuItem | null;

export interface MenuState { x: number; y: number; title: string; items: MenuEntry[] }

/** Menú del botón derecho. Uno solo, montado donde se le diga, con lo que se
 *  le pase: lo que se puede hacer con un proyecto, con un caso y con un
 *  resultado no se parece, y tres menús distintos son tres listas distintas,
 *  no tres componentes.
 *
 *  Lo destructivo va al final, detrás de un separador y con su color solo al
 *  pasar por encima. */
export function ContextMenu({ state, onClose }:
  { state: MenuState | null; onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  // Antes de pintarlo hay que saber cuánto mide: pegado al borde derecho o
  // inferior se abriría medio fuera y la mitad de las opciones no se vería.
  useLayoutEffect(() => {
    if (!state || !box.current) { setPos(null); return; }
    const r = box.current.getBoundingClientRect();
    setPos({
      left: Math.max(6, Math.min(state.x, window.innerWidth - r.width - 6)),
      top: Math.max(6, Math.min(state.y, window.innerHeight - r.height - 6)),
    });
  }, [state]);

  useEffect(() => {
    if (!state) return;
    const cerrar = () => onClose();
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    // `mousedown` en captura: cerrar antes de que el clic haga cualquier otra
    // cosa por debajo.
    document.addEventListener("mousedown", cerrar, true);
    document.addEventListener("keydown", esc);
    window.addEventListener("blur", cerrar);
    return () => {
      document.removeEventListener("mousedown", cerrar, true);
      document.removeEventListener("keydown", esc);
      window.removeEventListener("blur", cerrar);
    };
  }, [state, onClose]);

  if (!state) return null;

  // Portal a `document.body`: montado donde se le llama, este `fixed` se
  // posicionaba relativo al ancestro con `backdrop-blur`/`filter` más
  // cercano (el propio panel translúcido de la pantalla de entrada, por
  // ejemplo) en vez del viewport — eso es lo que abría el menú en la
  // esquina en vez de donde se hizo clic. Fuera del árbol, `fixed` vuelve
  // a ser relativo al viewport de verdad.
  return createPortal(
    <div ref={box} onContextMenu={(e) => e.preventDefault()}
      style={{
        left: pos?.left ?? state.x, top: pos?.top ?? state.y,
        visibility: pos ? "visible" : "hidden",
        animation: "jg-popup-scale-in 160ms cubic-bezier(.2,.85,.35,1) both",
      }}
      className="fixed z-[95] min-w-[186px] rounded-[11px] border border-white/[.12]
        bg-[rgba(20,22,26,.97)] p-[5px] shadow-lg shadow-black/60 backdrop-blur-xl">
      <p className="truncate px-2 pb-1.5 pt-1 text-[9px] uppercase tracking-[.11em] text-subtle">
        {state.title}
      </p>
      {state.items.map((it, i) =>
        it === null ? (
          <div key={i} className="mx-1.5 my-1 h-px bg-border" />
        ) : (
          <button key={i} disabled={it.disabled}
            onClick={() => { onClose(); it.onClick?.(); }}
            className={`flex w-full items-center gap-2 rounded-[7px] px-2 py-1.5 text-left text-[11.5px]
              transition-colors duration-200 disabled:opacity-35
              ${it.danger
                ? "text-muted hover:bg-danger/20 hover:text-danger-fg disabled:hover:bg-transparent"
                : "text-muted hover:bg-white/[.06] hover:text-fg disabled:hover:bg-transparent"}`}>
            <span className="flex-1 truncate">{it.label}</span>
            {it.hint && <span className="font-mono text-[10px] text-[#4a4d52]">{it.hint}</span>}
          </button>
        ),
      )}
    </div>,
    document.body,
  );
}

/** Abre el menú donde esté el cursor. Se usa como `onContextMenu`. */
export function menuAt(
  e: React.MouseEvent, title: string, items: MenuEntry[],
  set: (s: MenuState) => void,
) {
  e.preventDefault();
  e.stopPropagation();
  set({ x: e.clientX, y: e.clientY, title, items });
}
