import type { PctTipo } from "../lib/api";

/** La rampa de neutros para los tres tipos reales, y `warning` para lo
 *  desconocido — que no es una categoría más, es una advertencia sobre lo que
 *  el índice no sabe de sí mismo. Ni un color fuera de DESIGN.md. */
const COLOR: Record<string, string> = {
  calle: "bg-fg",
  cenital: "bg-muted",
  suelta: "bg-subtle",
};

export function ProvenanceBar({
  tipos,
  desconocidaPct,
}: {
  tipos: PctTipo[];
  desconocidaPct: number;
}) {
  return (
    <>
      <div className="flex h-[5px] overflow-hidden rounded-[3px] bg-elevated">
        {tipos.map((t) => (
          <i key={t.tipo} className={COLOR[t.tipo]} style={{ width: `${t.imagenes_pct}%` }} />
        ))}
        {desconocidaPct > 0 && <i className="bg-warning" style={{ width: `${desconocidaPct}%` }} />}
      </div>
      <div className="mt-[9px] flex flex-wrap gap-3">
        {tipos.map((t) => (
          <div key={t.tipo} className="flex items-center gap-1.5 text-[10.5px] text-muted">
            <s className={`block h-[7px] w-[7px] rounded-sm no-underline ${COLOR[t.tipo]}`} />
            {t.tipo} <b className="font-mono font-normal text-fg">{t.imagenes_pct.toFixed(0)} %</b>
          </div>
        ))}
        {desconocidaPct > 0 && (
          <div className="flex items-center gap-1.5 text-[10.5px] text-warning-fg">
            <s className="block h-[7px] w-[7px] rounded-sm bg-warning no-underline" />
            desconocida <b className="font-mono font-normal">{desconocidaPct.toFixed(0)} %</b>
          </div>
        )}
      </div>
    </>
  );
}
