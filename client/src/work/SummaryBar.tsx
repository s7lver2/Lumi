import type { Analysis } from "../lib/api";

export function SummaryBar({ analysis }: { analysis: Analysis | null }) {
  const hecho = analysis?.state === "hecho";
  const pct = Math.round((analysis?.result_confidence ?? 0) * 100);
  const coords = hecho
    ? `${analysis!.result_lat!.toFixed(6)}, ${analysis!.result_lng!.toFixed(6)}`
    : "—";
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex items-end justify-between bg-gradient-to-t from-[rgba(10,11,13,.92)] to-transparent px-4 py-2.5 pl-[50px]">
      <div className="flex items-end">
        {/* Vacío hasta que haya motor: el nombre de lugar sale de una
            geocodificación inversa que no tiene nada que traducir todavía. */}
        <Field k="Identificado" v="—" dim />
        <Field k="Coordenadas" v={coords} mono dim={!hecho} />
        <Field k="Radio de búsqueda"
          v={hecho ? `~${((analysis!.result_radius_m ?? 0) / 1000).toFixed(2)} km` : "—"} dim={!hecho} />
      </div>
      {hecho && (
        <div className="text-right">
          <div className="text-[26px] leading-none text-fg">{pct}%</div>
          <div className="text-[8px] uppercase tracking-[.11em] text-subtle">coincidencia</div>
        </div>
      )}
    </div>
  );
}

function Field({ k, v, mono, dim }: { k: string; v: string; mono?: boolean; dim?: boolean }) {
  return (
    <div className="mr-6">
      <div className="text-[8px] uppercase tracking-[.11em] text-subtle">{k}</div>
      <div className={`text-[11.5px] ${mono ? "font-mono" : ""} ${dim ? "text-subtle" : "text-fg"}`}>{v}</div>
    </div>
  );
}
