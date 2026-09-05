"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usarRevelado } from "../usarRevelado";
import { COLOR_TESELA, type EstadoTesela } from "./estadoTeselas";

const W = 400, H = 260, COLS = 9, ROWS = 6, TW = W / COLS, TH = H / ROWS;

type Celda = { x: number; y: number; estado: EstadoTesela; dist: number; col: number; fila: number };

function celdasIniciales(): Celda[] {
  const cx = COLS / 2, cy = ROWS / 2;
  const out: Celda[] = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const dist = Math.hypot(c - cx, r - cy);
      const estado: EstadoTesela = dist < 1.3 ? "reclamada" : dist < 2.2 ? (c % 2 === 0 ? "catalogo" : "local") : "nueva";
      out.push({ x: c * TW, y: r * TH, estado, dist, col: c, fila: r });
    }
  }
  return out;
}

const NOMBRE_ESTADO: Record<EstadoTesela, string> = {
  local: "local — ya la indexaste tú",
  catalogo: "catálogo — ya la publicó otra persona",
  nueva: "nueva — nadie la ha indexado",
  reclamada: "tuya para siempre",
};

const ESTADOS_LEYENDA: { estado: EstadoTesela; nombre: string }[] = [
  { estado: "local", nombre: "local" },
  { estado: "catalogo", nombre: "catálogo" },
  { estado: "nueva", nombre: "nueva" },
];

/** Mini-mapa de territorio: entra con un barrido por distancia al centro
 *  (mismo patrón que `jg-tile-sweep` en el Indexer real) y, ya revelado, no
 *  se queda quieto — un grupo pequeño de teselas "nueva" vecinas se
 *  clasifica a la vez (no una sola, que se leía como un parpadeo perdido en
 *  la rejilla) y vuelve a quedar pendiente, como si el indexado siguiera en
 *  marcha. El núcleo ya reclamado respira despacio: es lo único que no
 *  vuelve a cambiar. Hover muestra qué es cada tesela. Se detiene con
 *  `prefers-reduced-motion`. */
export function Territorio() {
  const { ref, visible } = usarRevelado<HTMLDivElement>();
  const base = useMemo(() => celdasIniciales(), []);
  const [estados, setEstados] = useState<EstadoTesela[]>(() => base.map((c) => c.estado));
  const [hover, setHover] = useState<number | null>(null);
  const nuevasIdx = useMemo(() => base.flatMap((c, i) => (c.estado === "nueva" ? [i] : [])), [base]);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!visible) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (intervalRef.current) return;
    const arranque = base.length * 110 + 300;
    const id = setTimeout(() => {
      intervalRef.current = setInterval(() => {
        if (!nuevasIdx.length) return;
        // Un grupo, no una tesela suelta: la semilla más sus vecinas
        // inmediatas que también sean "nueva" — se lee como una zona que se
        // clasifica de golpe, no como un píxel perdido parpadeando.
        const semilla = base[nuevasIdx[Math.floor(Math.random() * nuevasIdx.length)]];
        const grupo = base.filter(
          (c) => c.estado === "nueva" && Math.abs(c.col - semilla.col) <= 1 && Math.abs(c.fila - semilla.fila) <= 1,
        );
        const indices = grupo.map((c) => base.indexOf(c));
        const destino: EstadoTesela = Math.random() < 0.5 ? "local" : "catalogo";
        indices.forEach((i, k) => {
          setTimeout(() => {
            setEstados((prev) => { const next = [...prev]; next[i] = destino; return next; });
          }, k * 90);
          setTimeout(() => {
            setEstados((prev) => { const next = [...prev]; next[i] = "nueva"; return next; });
          }, 1300 + k * 90);
        });
      }, 1100);
    }, arranque);
    return () => {
      clearTimeout(id);
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  return (
    <section id="territorio" className="mx-auto grid max-w-[1180px] grid-cols-1 items-center gap-14 px-7 py-24 md:grid-cols-2">
      <div>
        <span className="font-mono text-[11px] uppercase tracking-wide text-subtle">territorio</span>
        <h2 className="mt-2 text-[clamp(22px,2.8vw,30px)] font-semibold tracking-tight">Antes de gastar una cuota</h2>
        <p className="mt-3 max-w-[40ch] leading-relaxed text-muted">
          Cada tesela se clasifica antes de pedir nada a ningún proveedor.
        </p>
        <div className="mt-4 flex flex-wrap gap-4">
          {ESTADOS_LEYENDA.map((l) => {
            const c = COLOR_TESELA[l.estado];
            return (
              <div key={l.estado} className="flex items-center gap-1.5 font-mono text-[10.5px] text-subtle">
                <span
                  className="h-[9px] w-[9px] rounded-[2px]"
                  style={{ background: c.fill, border: c.stroke ? `1px dashed ${c.stroke}` : undefined }}
                />
                {l.nombre}
              </div>
            );
          })}
        </div>
      </div>

      <div ref={ref} className="rounded-card border border-border bg-[#0c0e12] p-4.5">
        <svg viewBox={`0 0 ${W} ${H}`} className="block w-full">
          <rect width={W} height={H} fill="#0c0e12" />
          {base.map((cel, i) => {
            const c = COLOR_TESELA[estados[i]];
            const hovered = hover === i;
            return (
              <g key={i}>
                <rect
                  x={cel.x + 1} y={cel.y + 1} width={TW - 2} height={TH - 2} rx={2}
                  fill={c.fill} stroke={c.stroke} strokeDasharray={c.dash} strokeWidth={c.stroke ? 0.8 : undefined}
                  onMouseEnter={() => setHover(i)}
                  onMouseLeave={() => setHover((h) => (h === i ? null : h))}
                  style={{
                    opacity: visible ? 1 : 0,
                    cursor: "pointer",
                    filter: hovered ? "brightness(1.6)" : undefined,
                    transition: `opacity .42s cubic-bezier(.16,1,.3,1) ${(cel.dist * 0.11).toFixed(3)}s, fill 1s ease, filter .15s ease`,
                  }}
                >
                  <title>{NOMBRE_ESTADO[estados[i]]}</title>
                </rect>
                {cel.estado === "reclamada" && (
                  <rect
                    x={cel.x + 1} y={cel.y + 1} width={TW - 2} height={TH - 2} rx={2}
                    fill="none" stroke="#e8e8e6" strokeWidth={1}
                    className="jg-tesela-halo pointer-events-none"
                    style={{ animationDelay: `${(cel.dist * 0.3).toFixed(2)}s`, opacity: visible ? undefined : 0 }}
                  />
                )}
              </g>
            );
          })}
        </svg>
      </div>
    </section>
  );
}
