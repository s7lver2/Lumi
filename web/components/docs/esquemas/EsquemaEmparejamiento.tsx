"use client";

import { useEffect, useRef, useState } from "react";
import { Esquema } from "../Esquema";
import { useConteo } from "../useConteo";

/** Las correspondencias caen exactamente sobre las esquinas de dos
 *  edificios de trazo (un tejado en punta y dos azoteas planas) — mismo
 *  boceto que el mockup original de este spec, restaurado aquí: unos
 *  puntos flotando en una caja vacía no comunicaban qué se está
 *  comparando. Los edificios se dibujan solos al montar (stroke-dasharray
 *  animado, un edificio detrás de otro) para que se lea como un boceto
 *  que se traza, no como una imagen ya puesta desde el principio. */
const EDIFICIOS_A = [
  "M40 150 L120 66 L200 150", // tejado en punta
  "M60 150 L60 104 L104 104 L104 150", // azotea plana baja
  "M214 150 L214 88 L258 88 L258 150", // azotea plana alta
];
const EDIFICIOS_B = [
  "M352 150 L428 60 L508 150",
  "M370 150 L370 100 L412 100 L412 150",
  "M520 150 L520 84 L564 84 L564 150",
];
const SUELO_A = "M18 150 L276 150";
const SUELO_B = "M324 150 L582 150";

const PARES = [
  { a: { x: 120, y: 66 }, b: { x: 428, y: 60 }, certeza: 0.91 },
  { a: { x: 60, y: 104 }, b: { x: 370, y: 100 }, certeza: 0.74 },
  { a: { x: 104, y: 104 }, b: { x: 412, y: 100 }, certeza: 0.68 },
  { a: { x: 200, y: 150 }, b: { x: 508, y: 150 }, certeza: 0.55 },
  { a: { x: 214, y: 88 }, b: { x: 520, y: 84 }, certeza: 0.5 },
  { a: { x: 40, y: 150 }, b: { x: 352, y: 150 }, certeza: 0.31 },
  { a: { x: 258, y: 88 }, b: { x: 564, y: 84 }, certeza: 0.22 },
];

/** Trazo animado: arranca oculto tras su propio contorno y se dibuja hacia
 *  su longitud real — 300 de sobra para cualquiera de los seis tejados de
 *  arriba, así que el trazo nunca llega a "acabarse" a mitad de línea. */
function TrazoEdificio({ d, retraso }: { d: string; retraso: number }) {
  return (
    <path
      d={d}
      stroke="#3a3d42"
      strokeWidth="1.4"
      fill="none"
      strokeLinejoin="round"
      pathLength={300}
      style={{
        strokeDasharray: 300,
        strokeDashoffset: 300,
        animation: `jg-stroke-draw .6s cubic-bezier(.16,1,.3,1) ${retraso}s both`,
      }}
    />
  );
}

export function EsquemaEmparejamiento({ etiqueta }: { etiqueta: string }) {
  const [umbral, setUmbral] = useState(0.46);
  const sobreviven = PARES.filter((p) => p.certeza >= umbral).length;
  const sobrevivenMostrado = useConteo(sobreviven, 250);

  // Qué pares acaban de cruzar el umbral hacia "activo" — a esos, y solo a
  // esos, se les aplica el salto jg-engancha; los que ya estaban activos no
  // deben re-saltar en cada pixel que arrastra el slider.
  const previos = useRef<boolean[]>(PARES.map((p) => p.certeza >= umbral));
  const [enganchados, setEnganchados] = useState<Set<number>>(new Set());

  useEffect(() => {
    const nuevos = new Set<number>();
    PARES.forEach((p, i) => {
      const activo = p.certeza >= umbral;
      if (activo && !previos.current[i]) nuevos.add(i);
      previos.current[i] = activo;
    });
    if (nuevos.size === 0) return;
    setEnganchados(nuevos);
    const t = setTimeout(() => setEnganchados(new Set()), 350);
    return () => clearTimeout(t);
  }, [umbral]);

  return (
    <Esquema etiqueta={etiqueta}>
      <div className="rounded-[9px] border border-border bg-[#0b0c0e] p-2">
        <svg viewBox="0 0 600 188" width="100%" height="188">
          <g stroke="#26282c" strokeWidth="1" fill="none">
            <rect x="18" y="20" width="258" height="148" rx="6" />
            <rect x="324" y="20" width="258" height="148" rx="6" />
          </g>
          <TrazoEdificio d={SUELO_A} retraso={0} />
          <TrazoEdificio d={SUELO_B} retraso={0} />
          {EDIFICIOS_A.map((d, i) => (
            <TrazoEdificio key={`a${i}`} d={d} retraso={0.1 + i * 0.12} />
          ))}
          {EDIFICIOS_B.map((d, i) => (
            <TrazoEdificio key={`b${i}`} d={d} retraso={0.1 + i * 0.12} />
          ))}
          {PARES.map((p, i) => {
            const activo = p.certeza >= umbral;
            return (
              <line
                key={i}
                x1={p.a.x}
                y1={p.a.y}
                x2={p.b.x}
                y2={p.b.y}
                stroke={activo ? "#e8e8e6" : "#6a6c70"}
                strokeWidth="1"
                opacity={activo ? 0.72 : 0.3}
                strokeDasharray={activo ? undefined : "3 3"}
                className="transition-[opacity,stroke] duration-200 ease-out"
              />
            );
          })}
          {PARES.map((p, i) => {
            const activo = p.certeza >= umbral;
            const salta = enganchados.has(i);
            // El salto escala cada punto sobre SU PROPIO centro
            // (transformBox: fill-box) — sobre el <g> entero habría escalado
            // la distancia entre los dos puntos, que están a 300px uno del
            // otro, y el "salto" se habría visto como un latigazo.
            const claseSalto = salta ? "jg-engancha" : "";
            const estiloSalto: React.CSSProperties = { transformBox: "fill-box", transformOrigin: "center" };
            return (
              <g key={i} fill={activo ? "#e8e8e6" : "#6a6c70"} className="transition-[fill] duration-200 ease-out">
                <circle cx={p.a.x} cy={p.a.y} r={activo ? 3 : 2.2} className={`transition-[r] duration-200 ease-out ${claseSalto}`} style={estiloSalto} />
                <circle cx={p.b.x} cy={p.b.y} r={activo ? 3 : 2.2} className={`transition-[r] duration-200 ease-out ${claseSalto}`} style={estiloSalto} />
              </g>
            );
          })}
          <text x="18" y="13" fill="#6a6c70" fontSize="9" fontFamily="ui-monospace,Menlo,monospace">
            tu foto
          </text>
          <text x="324" y="13" fill="#6a6c70" fontSize="9" fontFamily="ui-monospace,Menlo,monospace">
            candidato
          </text>
        </svg>
      </div>
      <div className="mt-[14px] flex items-center gap-[14px]">
        <span className="whitespace-nowrap text-[10.5px] text-subtle">Umbral de certeza</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={umbral}
          onChange={(e) => setUmbral(Number(e.target.value))}
          className="h-[2px] flex-1 accent-fg"
        />
        <span className="whitespace-nowrap font-mono text-[11.5px] text-fg">
          {umbral.toFixed(2)} · {sobrevivenMostrado.toFixed(0)} de {PARES.length}
        </span>
      </div>
      <div className="mt-3 flex gap-[18px]">
        <div className="flex items-center gap-[7px] text-[10.5px] text-subtle">
          <span className="block h-[2px] w-[14px] rounded-[2px] bg-fg" />
          correspondencia por encima del umbral
        </div>
        <div className="flex items-center gap-[7px] text-[10.5px] text-subtle">
          <span className="block h-[2px] w-[14px] rounded-[2px] bg-subtle opacity-50" />
          descartada
        </div>
      </div>
    </Esquema>
  );
}
