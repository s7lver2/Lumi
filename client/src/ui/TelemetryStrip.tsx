import { useServer } from "../lib/store";
import { Icon, LockIcon } from "./Icon";

function Cell({ label, children, className = "", style }: {
  label: string; children: React.ReactNode; className?: string; style?: React.CSSProperties;
}) {
  return (
    <div className={`flex min-w-0 flex-col justify-center gap-[5px] border-r border-border px-[15px] py-[11px] last:border-r-0 ${className}`} style={style}>
      <div className="whitespace-nowrap font-mono text-[9.5px] uppercase tracking-[.1em] text-subtle">{label}</div>
      {children}
    </div>
  );
}

function Bar({ pct, tone = "draw" }: { pct: number; tone?: "draw" | "warning" }) {
  return (
    <div className="h-[3px] overflow-hidden rounded-sm bg-white/[.07]">
      <div className={`h-full rounded-sm ${tone === "warning" ? "bg-warning" : "bg-draw"} transition-[width] duration-1000 ease-expo`}
        style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
    </div>
  );
}

export function TelemetryStrip({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const { hello, sample, addr } = useServer();
  if (!hello) return null;
  return (
    <div className={`relative z-20 flex w-full items-stretch border-b border-border bg-surface/95 transition-[height] duration-500 ease-expo ${collapsed ? "h-7" : "h-[70px]"}`}>
      <Cell label="Servidor" className="flex-none basis-[210px]">
        <div className="flex items-center gap-[7px] whitespace-nowrap font-mono text-xs text-fg">
          {hello.locked && <LockIcon size={12} className="text-warning" />}
          <span>{addr || "servidor"}</span>
        </div>
        {!collapsed && (
          <div className={`whitespace-nowrap font-mono text-[10px] ${hello.locked ? "text-warning-fg" : "text-draw-fg"}`}>
            ● {hello.locked ? "sellado" : `verificado · ${hello.mode === "native" ? "nativo" : "docker"}`}
          </div>
        )}
      </Cell>

      {hello.gpus.map((g) => {
        const s = sample?.gpus.find((x) => x.index === g.index);
        const pct = s ? (s.vram_used_mb / Math.max(1, s.vram_total_mb)) * 100 : 0;
        return (
          <Cell key={g.index} label={`gpu${g.index} · ${g.name.replace(/NVIDIA |GeForce /g, "")}`}>
            <div className="whitespace-nowrap font-mono text-xs text-fg">
              {s ? `${s.util_pct}%` : "—"}
              <span className="text-muted">{s ? ` · ${(s.vram_used_mb / 1024).toFixed(1)}/${Math.round(s.vram_total_mb / 1024)}` : ""}</span>
            </div>
            {!collapsed && <Bar pct={pct} />}
          </Cell>
        );
      })}

      {hello.gpus.length === 0 && (
        <Cell label="cpu">
          <div className="whitespace-nowrap font-mono text-xs text-fg">
            {sample ? `${sample.cpu_pct.toFixed(0)}%` : "—"}
            <span className="text-muted">
              {sample ? ` · ${(sample.ram_used_mb / 1024).toFixed(1)} GB` : ""}
            </span>
          </div>
          {!collapsed && <Bar pct={sample?.cpu_pct ?? 0} />}
        </Cell>
      )}

      <Cell label="Cola" className="flex-none basis-[132px]">
        <div className="font-mono text-sm text-fg">{sample ? sample.queue_depth : "—"}</div>
        {!collapsed && (
          <div className={`whitespace-nowrap font-mono text-[10px] ${sample?.queue_paused ? "text-warning-fg" : "text-subtle"}`}>
            {sample?.queue_paused ? "en pausa" : "sin provisionar"}
          </div>
        )}
      </Cell>

      {/* Empuja el botón de colapsar al borde derecho: sin esto las celdas de
          ancho fijo se amontonan a la izquierda y dejan la barra a medias. */}
      <div className="flex-1 border-r border-border" />

      <button onClick={onToggle} aria-label={collapsed ? "Expandir" : "Colapsar"}
        className="flex-none px-3 text-subtle transition-colors hover:text-fg">
        <Icon name="chevron" size={11} className={collapsed ? "" : "rotate-180"} />
      </button>
    </div>
  );
}
