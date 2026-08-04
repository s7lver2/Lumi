import type { Analysis, Image } from "../lib/api";
import { lumiUrl } from "../lib/bridge";
import { Icon } from "../ui/Icon";

/** En la v1 la barra lateral solo existía cuando había resultados que enseñar,
 *  y por eso el mapa se sentía grande. Aquí estaba siempre, ocupando 196 px
 *  para decir «sin análisis». El llamante decide si montarla; esto solo dibuja.
 *
 *  Los tres widgets sin modelo se quedan: una función que no está disponible se
 *  muestra deshabilitada con su motivo, nunca se oculta. */
export function ResultsSidebar({
  image, analyses, selected, onSelect, onAnalyze, busy,
}: {
  image: Image | null;
  analyses: Analysis[];
  selected: number | null;
  onSelect: (id: number) => void;
  onAnalyze: () => void;
  busy: boolean;
}) {
  const exif = image?.exif_lat != null && image.exif_lng != null;
  return (
    <aside className="absolute bottom-0 right-0 top-[38px] z-20 flex w-[250px] flex-col gap-[7px]
      overflow-y-auto border-l border-white/[.06] bg-[rgba(16,18,21,.92)] p-[11px_10px] backdrop-blur-xl"
      style={{ animation: "jg-slide-right 300ms cubic-bezier(.16,1,.3,1) both" }}>
      <p className="text-[8px] uppercase tracking-[.11em] text-subtle">Resultados</p>

      {image && (
        <div className="flex items-center gap-2 rounded-lg bg-white/[.03] p-[7px]">
          <img src={lumiUrl(`/v1/images/${image.id}/thumb`)} alt=""
            className="h-[30px] w-[38px] shrink-0 rounded bg-elevated object-cover" />
          <span className="truncate font-mono text-[10px] text-muted">{image.filename}</span>
        </div>
      )}

      {analyses.map((a, i) => {
        const hecho = a.state === "hecho";
        const on = a.id === selected;
        const pct = Math.round((a.result_confidence ?? 0) * 100);
        return (
          <button key={a.id} onClick={() => onSelect(a.id)}
            style={{ animation: `jg-fade-rise 220ms ${Math.min(i, 6) * 30}ms cubic-bezier(.16,1,.3,1) both` }}
            className={`rounded-[9px] border p-[8px_9px] text-left transition-colors duration-300 ease-expo ${
              on ? "border-white/[.16] bg-white/[.035]" : "border-white/[.07] hover:border-white/15"
            }`}>
            <div className="flex items-center gap-[7px]">
              <span className={`grid h-[15px] w-[15px] shrink-0 place-items-center rounded-full text-[8.5px] ${
                i === 0 && hecho ? "bg-fg text-black"
                  : hecho ? "border border-white/[.22] text-muted"
                  : "border border-dashed border-[#3a3e44] text-subtle"
              }`}>{i + 1}</span>
              <span className={`flex-1 truncate text-[11.5px] ${hecho ? "text-fg" : "text-muted"}`}>{a.model}</span>
              {hecho
                ? <span className="shrink-0 text-[12px] text-fg">{pct} %</span>
                : <span className="shrink-0 rounded border border-border px-1 text-[8.5px] text-subtle">{a.state}</span>}
            </div>
            <p className={`mt-[5px] pl-[22px] font-mono text-[10px] ${hecho ? "text-muted" : "text-subtle"}`}>
              {hecho
                ? `${a.result_lat!.toFixed(6)}, ${a.result_lng!.toFixed(6)}`
                : a.state === "error"
                  ? a.error ?? "el análisis falló y no dejó motivo"
                  : "esperando al motor de inferencia"}
            </p>
          </button>
        );
      })}

      {/* El EXIF declarado tiene tarjeta propia y borde ámbar: no es una
          candidata, es lo que la cámara dice. */}
      {exif && (
        <div className="rounded-[9px] border border-warning/30 p-[8px_9px]">
          <div className="flex items-center gap-[7px]">
            <span className="grid h-[15px] w-[15px] shrink-0 place-items-center rounded-full
              border border-warning-fg text-[8.5px] text-warning-fg">E</span>
            <span className="text-[11.5px] text-warning-fg">EXIF declarado</span>
          </div>
          <p className="mt-[5px] pl-[22px] font-mono text-[10px] text-muted">
            {image!.exif_lat!.toFixed(6)}, {image!.exif_lng!.toFixed(6)}
          </p>
        </div>
      )}

      <p className="mt-1 text-[8px] uppercase tracking-[.11em] text-subtle">Sin modelo instalado</p>
      <div className="flex flex-col gap-[5px] opacity-[.55]">
        {([["clock", "Hora estimada"], ["cloud", "Clima"], ["boxes", "Objetos detectados"]] as const)
          .map(([icon, label]) => (
            <div key={icon} title="modelo no instalado"
              className="flex items-center gap-[7px] rounded-[9px] border border-white/[.07] p-[7px_9px]">
              <Icon name={icon} size={12} className="text-subtle" />
              <span className="flex-1 text-[11px] text-muted">{label}</span>
              <Icon name="lock" size={11} className="text-subtle" />
            </div>
          ))}
      </div>

      <div className="flex-1" />
      <button onClick={onAnalyze} disabled={busy}
        className="jg-press w-full rounded-lg bg-accent px-3 py-2 text-[11.5px] font-medium text-black disabled:opacity-40">
        {busy ? "Un momento…" : "Analizar otra vez"}
      </button>
    </aside>
  );
}
