import { FloatingCard } from "../ui/FloatingCard";
import { Icon } from "../ui/Icon";

const GB = 1024 * 1024 * 1024;
const size = (b: number) =>
  b < GB ? `${Math.round(b / 1024 / 1024)} MB` : `${(b / GB).toFixed(1)} GB`;

/** Un caso vacío no es un mapa mudo: es una invitación a soltar fotos. Es la
 *  pieza de la v1 (`MapDropTarget`) que faltaba entera, y sin ella la única
 *  forma de empezar era el «+» de la tira de miniaturas, que no dice nada. */
export function DropTarget({
  dragging, busy, freeBytes, onPick,
}: { dragging: boolean; busy: boolean; freeBytes: number | null; onPick: () => void }) {
  return (
    <div className="absolute left-1/2 top-1/2 z-20 w-[330px] -translate-x-1/2 -translate-y-1/2"
      style={{ animation: "jg-popup-scale-in 240ms cubic-bezier(.2,.85,.35,1) both" }}>
      <FloatingCard className={`overflow-hidden transition-colors duration-300 ease-expo ${
        dragging ? "border-white/40" : ""
      }`}>
        <div className="p-[26px_24px] text-center">
          <div className={`mx-auto mb-3.5 grid h-[42px] w-[42px] place-items-center rounded-[11px]
            border transition-colors duration-300 ease-expo ${
              dragging ? "border-white/45 text-fg" : "border-white/20 text-muted"
            }`}>
            <Icon name="image" size={18} />
          </div>
          <p className="text-[13px] font-medium text-fg">
            {dragging ? "Suelta aquí" : "Suelta fotos para empezar el caso"}
          </p>
          <p className="mt-1.5 text-[11px] leading-relaxed text-muted">
            Arrástralas desde tu equipo a cualquier punto de la ventana.<br />
            El archivo original no se toca nunca.
          </p>
          <button onClick={onPick} disabled={busy}
            className="jg-press mt-4 rounded-lg bg-accent px-4 py-2 text-[11.5px] font-medium text-black disabled:opacity-50">
            {busy ? "Subiendo…" : "Seleccionar archivos…"}
          </button>
          <p className="mt-3 font-mono text-[9.5px] text-subtle">
            JPG · PNG · WEBP
            {freeBytes !== null && ` · quedan ${size(Math.max(0, freeBytes))} de tu cuota`}
          </p>
        </div>
      </FloatingCard>
    </div>
  );
}

/** Marco punteado sobre toda el área de trabajo mientras hay algo encima del
 *  ratón. Sin esto, arrastrar sobre un caso que ya tiene imágenes no daba
 *  ninguna señal de que soltar fuera a servir de algo. */
export function DropFrame() {
  return (
    <div className="pointer-events-none absolute bottom-0 left-11 right-0 top-[38px] z-[35] m-3.5
      rounded-[14px] border border-dashed border-white/25 bg-white/[.02]"
      style={{ animation: "jg-backdrop-in 140ms ease both" }} />
  );
}
