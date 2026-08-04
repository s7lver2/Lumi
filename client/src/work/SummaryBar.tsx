import type { Analysis } from "../lib/api";

export function SummaryBar({ analysis, rightInset = 0 }:
  { analysis: Analysis | null; rightInset?: number }) {
  const hecho = analysis?.state === "hecho";
  const pct = Math.round((analysis?.result_confidence ?? 0) * 100);
  const coords = hecho
    ? `${analysis!.result_lat!.toFixed(6)}, ${analysis!.result_lng!.toFixed(6)}`
    : "—";
  return (
    <div style={{ right: rightInset }}
      className="pointer-events-none absolute bottom-0 left-11 z-20 flex items-end justify-between
        bg-gradient-to-t from-[rgba(10,11,13,.94)] to-transparent px-[18px] py-3">
      <div className="flex gap-[30px]">
        {/* Vacío hasta que haya motor: el nombre de lugar sale de una
            geocodificación inversa que no tiene nada que traducir todavía. */}
        <Field k="Identificado" v="—" dim />
        <Field k="Coordenadas" v={coords} mono dim={!hecho} />
        <Field k="Radio de búsqueda"
          v={hecho ? `~${((analysis!.result_radius_m ?? 0) / 1000).toFixed(2)} km` : "—"} dim={!hecho} />
      </div>
      {hecho && (
        <div className="text-right" style={{ animation: "jg-fade-rise 320ms cubic-bezier(.16,1,.3,1) both" }}>
          <div className="text-[30px] leading-none text-fg">{pct}%</div>
          <div className="mt-0.5 text-[8px] uppercase tracking-[.11em] text-subtle">coincidencia</div>
        </div>
      )}
    </div>
  );
}

function Field({ k, v, mono, dim }: { k: string; v: string; mono?: boolean; dim?: boolean }) {
  return (
    <div>
      <div className="text-[8px] uppercase tracking-[.11em] text-subtle">{k}</div>
      <div className={`mt-[3px] text-[11.5px] ${mono ? "font-mono" : ""} ${dim ? "text-subtle" : "text-fg"}`}>{v}</div>
    </div>
  );
}
