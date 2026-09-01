import { Icon } from "../ui/Icon";

/** Aparece cuando ya hay un área clasificada y el operador acaba de cerrar
 *  un trazo nuevo: decide si el trazo nuevo sustituye al área, se suma, o se
 *  resta de ella. Mismo sitio y estilo que el aviso de "elige una
 *  herramienta" — una pista flotante, no un diálogo modal que tape el mapa. */
export function CombineBar({ onElegir, onCancelar }: {
  onElegir: (modo: "sustituir" | "sumar" | "restar") => void;
  onCancelar: () => void;
}) {
  return (
    <div className="absolute bottom-[62px] left-1/2 z-20 -translate-x-1/2 flex items-center gap-1.5
      whitespace-nowrap rounded-card border border-white/[.13] bg-[rgba(16,19,25,.82)]
      px-2 py-1.5 shadow-lg shadow-black/40 backdrop-blur-xl">
      <p className="px-1.5 text-[10.5px] text-subtle">Ya hay un área — ¿qué hacer con la forma nueva?</p>
      <button onClick={() => onElegir("sumar")}
        className="jg-press flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-[11px] text-fg">
        <Icon name="plus" size={11} /> Sumar
      </button>
      <button onClick={() => onElegir("restar")}
        className="jg-press flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-[11px] text-fg">
        <Icon name="restar" size={11} /> Restar
      </button>
      <button onClick={() => onElegir("sustituir")}
        className="jg-press rounded-lg border border-border px-2.5 py-1 text-[11px] text-fg">
        Sustituir
      </button>
      <button onClick={onCancelar} className="jg-press px-2 py-1 text-[11px] text-subtle hover:text-fg">
        Cancelar
      </button>
    </div>
  );
}
