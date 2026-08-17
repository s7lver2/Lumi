import { useRef, useState } from "react";
import type { PuntoCurva } from "../lib/api";

const W = 420, H = 190, PAD_L = 34, PAD_R = 16, PAD_T = 10;

export function CurvaEditable({
  puntos, onChange, ejeXMin, ejeXMax, ejeYMin, ejeYMax, zonaPeligroDesde, formatoPunto,
}: {
  puntos: PuntoCurva[];
  onChange: (p: PuntoCurva[]) => void;
  ejeXMin: number; ejeXMax: number; ejeYMin: number; ejeYMax: number;
  zonaPeligroDesde: number | null;
  formatoPunto: (p: PuntoCurva) => string;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [arrastrando, setArrastrando] = useState<number | null>(null);
  const [seleccionado, setSeleccionado] = useState(0);

  const xADistancia = (temp: number) =>
    PAD_L + ((temp - ejeXMin) / (ejeXMax - ejeXMin)) * (W - PAD_L - PAD_R);
  const yADistancia = (valor: number) =>
    PAD_T + (1 - (valor - ejeYMin) / (ejeYMax - ejeYMin)) * (H - PAD_T - 20);
  const distanciaATemp = (x: number) => Math.round(ejeXMin + ((x - PAD_L) / (W - PAD_L - PAD_R)) * (ejeXMax - ejeXMin));
  const distanciaAValor = (y: number) => Math.round(ejeYMin + (1 - (y - PAD_T) / (H - PAD_T - 20)) * (ejeYMax - ejeYMin));

  const coords = puntos.map((p) => [xADistancia(p.temp_c), yADistancia(p.valor)] as const);
  const linea = "M " + coords.map(([x, y]) => `${x},${y}`).join(" L ");
  const relleno = `${linea} L ${coords[coords.length - 1]?.[0] ?? W - PAD_R},${H - 20} L ${PAD_L},${H - 20} Z`;

  function mover(e: React.PointerEvent) {
    if (arrastrando === null || !svgRef.current) return;
    const r = svgRef.current.getBoundingClientRect();
    const x = Math.max(PAD_L, Math.min(W - PAD_R, (e.clientX - r.left) * (W / r.width)));
    const y = Math.max(PAD_T, Math.min(H - 20, (e.clientY - r.top) * (H / r.height)));
    const nuevo = puntos.slice();
    nuevo[arrastrando] = { temp_c: distanciaATemp(x), valor: distanciaAValor(y) };
    onChange(nuevo);
  }

  const puntoActivo = puntos[seleccionado];
  const xPeligro = zonaPeligroDesde !== null ? xADistancia(zonaPeligroDesde) : null;

  return (
    <div>
      {puntoActivo && (
        <div className="mb-1.5 flex justify-between text-[9px] text-subtle">
          <span>arrastra un punto</span>
          <span className="font-mono">{formatoPunto(puntoActivo)}</span>
        </div>
      )}
      <svg
        ref={svgRef} width="100%" height={H} viewBox={`0 0 ${W} ${H}`}
        style={{ overflow: "visible", touchAction: "none" }}
        onPointerMove={mover}
        onPointerUp={() => setArrastrando(null)}
      >
        <line x1={PAD_L} y1={PAD_T} x2={PAD_L} y2={H - 20} stroke="#1c1e21" />
        <line x1={PAD_L} y1={H - 20} x2={W - PAD_R} y2={H - 20} stroke="#1c1e21" />
        {xPeligro !== null && (
          <>
            <rect x={xPeligro} y={PAD_T} width={W - PAD_R - xPeligro} height={H - 20 - PAD_T} fill="rgba(163,51,51,.06)" />
            <line x1={xPeligro} y1={PAD_T} x2={xPeligro} y2={H - 20} stroke="rgba(232,143,143,.28)" strokeDasharray="3 3" />
          </>
        )}
        <path d={relleno} fill="rgba(255,255,255,.035)" />
        <path d={linea} fill="none" stroke="#c9c9c6" strokeWidth={1.8} />
        {coords.map(([x, y], i) => (
          <circle
            key={i} cx={x} cy={y} r={i === seleccionado ? 6.5 : 5}
            fill={i === seleccionado ? "#e8e8e6" : "#0e0f11"}
            stroke={i === seleccionado ? "#e8e8e6" : "#8a8a86"} strokeWidth={1.8}
            style={{ cursor: "grab" }}
            onPointerDown={(e) => {
              setSeleccionado(i); setArrastrando(i);
              (e.target as Element).setPointerCapture(e.pointerId);
            }}
          />
        ))}
      </svg>
    </div>
  );
}
