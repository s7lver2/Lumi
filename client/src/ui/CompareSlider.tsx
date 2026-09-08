import { useRef, useState } from "react";

/** Comparador de dos fotos con una barra arrastrable en medio, tipo
 *  "antes/después": la foto de encima se recorta con `clip-path` al
 *  porcentaje de la posición, y un tirador vertical marca el corte. Sin
 *  librería — puntero nativo (`pointerdown`/`move`/`up`), mismo criterio que
 *  el resto del cliente para interacciones que no justifican una dependencia. */
export function CompareSlider({ izquierda, derecha, etiquetaIzquierda, etiquetaDerecha }: {
  izquierda: string; derecha: string;
  etiquetaIzquierda: string; etiquetaDerecha: string;
}) {
  const [pos, setPos] = useState(50);
  const marco = useRef<HTMLDivElement>(null);
  const arrastrando = useRef(false);

  function moverA(clientX: number) {
    const r = marco.current?.getBoundingClientRect();
    if (!r) return;
    const pct = ((clientX - r.left) / r.width) * 100;
    setPos(Math.min(100, Math.max(0, pct)));
  }

  return (
    <div ref={marco}
      className="relative aspect-[4/3] w-full select-none overflow-hidden rounded-[10px] border border-border bg-elevated"
      onPointerDown={(e) => {
        arrastrando.current = true;
        (e.target as Element).setPointerCapture(e.pointerId);
        moverA(e.clientX);
      }}
      onPointerMove={(e) => { if (arrastrando.current) moverA(e.clientX); }}
      onPointerUp={() => { arrastrando.current = false; }}>
      <img src={derecha} alt="" className="absolute inset-0 h-full w-full object-cover" draggable={false} />
      <img src={izquierda} alt="" draggable={false}
        className="absolute inset-0 h-full w-full object-cover"
        style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }} />
      <div className="absolute inset-y-0 w-px bg-fg/70" style={{ left: `${pos}%` }}>
        <div className="absolute left-1/2 top-1/2 grid h-6 w-6 -translate-x-1/2 -translate-y-1/2
          place-items-center rounded-full border border-fg/70 bg-[rgba(13,15,17,.92)]">
          <span className="text-[9px] text-fg">⇔</span>
        </div>
      </div>
      <span className="absolute left-2 top-2 rounded bg-[rgba(13,15,17,.75)] px-1.5 py-0.5 font-mono text-[9px] text-subtle">
        {etiquetaIzquierda}
      </span>
      <span className="absolute right-2 top-2 rounded bg-[rgba(13,15,17,.75)] px-1.5 py-0.5 font-mono text-[9px] text-subtle">
        {etiquetaDerecha}
      </span>
    </div>
  );
}
