import { useServer } from "../lib/store";

function Celda({ k, v, pct, warm }: { k: string; v: string; pct?: number; warm?: boolean }) {
  return (
    <div className="flex h-full items-center gap-[7px] border-r border-border px-[13px] last:border-none">
      <span className="text-[8.5px] uppercase tracking-[.13em] text-subtle">{k}</span>
      <span className="min-w-[46px] font-mono text-[10.5px] tabular-nums text-fg">{v}</span>
      {pct !== undefined && (
        <span className="h-[3px] w-[52px] overflow-hidden rounded-sm bg-elevated">
          <i className={`block h-full transition-[width] duration-[900ms] ease-expo
            ${warm ? "bg-warning" : "bg-muted"}`}
            style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
        </span>
      )}
    </div>
  );
}

/** El estado de la máquina, siempre a la vista mientras administras. Lee del
 *  mismo `sample` que la píldora de la barra de título: una sola fuente. */
export function Franja() {
  const { hello, sample } = useServer();
  const gpu = hello?.gpus[0];
  const m = gpu ? sample?.gpus.find((x) => x.index === gpu.index) : undefined;
  const vramPct = m && m.vram_total_mb > 0 ? (m.vram_used_mb / m.vram_total_mb) * 100 : 0;

  return (
    <div className="flex h-[30px] shrink-0 items-center border-b border-border
      bg-gradient-to-b from-[#121417] to-[#0f1114] px-1.5">
      {gpu ? (
        <>
          <Celda k="GPU" v={m ? `${m.util_pct} %` : "—"} pct={m?.util_pct ?? 0}
            warm={(m?.util_pct ?? 0) > 85} />
          <Celda k="VRAM" v={m ? `${(m.vram_used_mb / 1024).toFixed(1)} GiB` : "—"} pct={vramPct} />
          <Celda k="Temp" v={m?.temp_c != null ? `${m.temp_c} °C` : "—"} />
        </>
      ) : (
        // Sin GPU el servidor corre en CPU y lo dice, en vez de enseñar tres
        // celdas vacías que parecen una avería.
        <Celda k="CPU" v={sample ? `${sample.cpu_pct.toFixed(0)} %` : "—"}
          pct={sample?.cpu_pct ?? 0} warm={(sample?.cpu_pct ?? 0) > 85} />
      )}
      <Celda k="Cola" v={sample ? String(sample.queue_depth) : "—"} />
      <Celda k="Estado" v={sample?.queue_paused ? "EN PAUSA" : (hello?.state ?? "—")} />
    </div>
  );
}