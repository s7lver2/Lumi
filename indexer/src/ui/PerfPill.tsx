import { useEffect, useRef, useState } from "react";

import { api, type ProgresoCola, type Rendimiento } from "../lib/api";
import { usePopover } from "./usePopover";

const pop = "absolute right-0 top-[30px] z-[70] w-[230px] rounded-[11px] border border-white/[.12] " +
  "bg-[rgba(20,22,26,.97)] p-2.5 shadow-lg shadow-black/50 backdrop-blur-xl";
const popAnim = { animation: "jg-popup-scale-in 180ms cubic-bezier(.2,.85,.35,1) both" };

/** El equivalente del `ServerPill` del cliente, pero mirando la GPU de esta
 *  misma máquina en vez de la de un servidor: aquí no hay sesión ni roles
 *  —el Indexer es de un solo operador—, así que no hay "admin" que comprobar;
 *  se enseña sin más. Si no hay una GPU NVIDIA no se pinta nada: un hueco
 *  vacío en la barra de título no informa de nada. */
export function PerfPill() {
  const [r, setR] = useState<Rendimiento | null>(null);
  const [cola, setCola] = useState<ProgresoCola[]>([]);
  const [open, setOpen, box] = usePopover();
  const tick = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const leer = () => {
      void api.rendimientoLeer().then(setR);
      void api.colaProgreso().then(setCola).catch(() => {});
    };
    leer();
    tick.current = setInterval(leer, 2500);
    return () => { if (tick.current) clearInterval(tick.current); };
  }, []);

  const gpu = r?.gpus[0];
  if (!gpu) return null;

  return (
    <div ref={box} className="relative">
      <button onClick={() => setOpen(!open)}
        className="flex h-[24px] items-center gap-1.5 rounded-[7px] border border-transparent px-2
          text-[10.5px] text-muted transition-colors duration-300 ease-expo
          hover:border-white/[.09] hover:bg-white/[.05] hover:text-fg">
        <span className="h-[6px] w-[6px] shrink-0 rounded-full bg-draw"
          style={{ animation: "jg-core-pulse 2.6s ease-in-out infinite" }} />
        <span className="font-mono">gpu {gpu.util_pct}%</span>
      </button>

      {open && (
        <div className={pop} style={popAnim}>
          <p className="truncate text-[11.5px] text-fg">{gpu.nombre.replace(/NVIDIA |GeForce /g, "")}</p>
          <div className="mt-2">
            <Row k="uso" v={`${gpu.util_pct}%`} />
            <Meter pct={gpu.util_pct} />
            <Row k="vram" v={`${(gpu.vram_usada_mb / 1024).toFixed(1)} / ${Math.round(gpu.vram_total_mb / 1024)} GB`} />
            <Meter pct={(gpu.vram_usada_mb / Math.max(1, gpu.vram_total_mb)) * 100} />
          </div>
          {cola.length > 0 && (
            <div className="mt-2.5 border-t border-border pt-2">
              {cola.map((c) => (
                <Row
                  key={c.modelo_id}
                  k={c.modelo_id}
                  v={`${c.indice_total > 0 ? `${c.indice_hechas}/${c.indice_total}` : "sin trabajo"}${c.pausada ? " · pausa" : ""}`}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-[3px] text-[10.5px]">
      <span className="truncate text-subtle">{k}</span>
      <span className="shrink-0 font-mono text-fg">{v}</span>
    </div>
  );
}

function Meter({ pct }: { pct: number }) {
  return (
    <div className="h-[3px] overflow-hidden rounded-sm bg-white/[.07]">
      <div className="h-full rounded-sm bg-draw transition-[width] duration-1000 ease-expo"
        style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
    </div>
  );
}
