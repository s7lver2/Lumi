"use client";

import { useEffect, useRef, useState } from "react";
import type { ProductoDescargable } from "../../lib/version";
import { SelectorDescarga } from "../SelectorDescarga";

/** El hero muestra una captura real del Indexer (Territorio, A Coruña) — no
 *  una recreación ilustrada: tres intentos con SVG a mano se sintieron
 *  todos genéricos. Sigue al ratón con un tilt isométrico ligero
 *  (perspectiva + rotación, máx 7°), desactivado con
 *  `prefers-reduced-motion`. */
export function IndexadoHero({ productos }: { productos: ProductoDescargable[] }) {
  const zonaRef = useRef<HTMLDivElement>(null);
  const deviceRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const id = setTimeout(() => setVisible(true), 150);
    return () => clearTimeout(id);
  }, []);

  useEffect(() => {
    const zona = zonaRef.current, device = deviceRef.current;
    if (!zona || !device) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const MAX_DEG = 6;
    function mover(e: MouseEvent) {
      const r = zona!.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width - 0.5;
      const py = (e.clientY - r.top) / r.height - 0.5;
      device!.style.transition = "transform .12s linear";
      device!.style.transform = `rotateX(${-py * MAX_DEG}deg) rotateY(${px * MAX_DEG}deg)`;
    }
    function salir() {
      device!.style.transition = "transform .6s cubic-bezier(.16,1,.3,1)";
      device!.style.transform = "rotateX(0deg) rotateY(0deg)";
    }
    zona.addEventListener("mousemove", mover);
    zona.addEventListener("mouseleave", salir);
    return () => {
      zona.removeEventListener("mousemove", mover);
      zona.removeEventListener("mouseleave", salir);
    };
  }, []);

  return (
    <section id="hero" className="mx-auto max-w-[1180px] px-7 pb-10 pt-32">
      <div className="jg-reveal-up max-w-[640px]">
        <span className="font-mono text-[11px] uppercase tracking-wide text-subtle">indexado</span>
        <h1 className="mt-3 text-[clamp(32px,4.6vw,50px)] font-semibold leading-[1.04] tracking-tight">
          Cómo se construye lo que Lumi reconoce
        </h1>
        <p className="mt-3 max-w-[52ch] leading-relaxed text-muted">
          Nadie aporta el corpus desde un centro. Se dibuja, se indexa, se publica.
        </p>
        <div className="mt-6 flex flex-wrap items-start gap-3">
          <SelectorDescarga productos={productos} />
          <a
            className="jg-micro jg-micro-scale rounded-card border border-border px-4 py-2 text-[13px] font-medium text-fg hover:border-subtle hover:bg-elevated"
            href="#mapa"
          >
            Ver el mapa real ↓
          </a>
        </div>
      </div>

      <div ref={zonaRef} className="jg-reveal-up mt-14" style={{ animationDelay: ".1s", perspective: "1400px" }}>
        <div
          ref={deviceRef}
          className="overflow-hidden rounded-card border border-border bg-panel shadow-[0_40px_90px_-30px_rgba(0,0,0,.6)]"
          style={{ transformStyle: "preserve-3d", willChange: "transform", transition: "transform .5s cubic-bezier(.16,1,.3,1)" }}
        >
          <div className="flex items-center gap-2 border-b border-border bg-surface px-3.5 py-2.5">
            <span className="h-[7px] w-[7px] rounded-full bg-border" />
            <span className="h-[7px] w-[7px] rounded-full bg-border" />
            <span className="h-[7px] w-[7px] rounded-full bg-border" />
            <span className="ml-2 font-mono text-[11.5px] text-subtle">Lumi Indexer — Territorio</span>
          </div>
          <div className="relative overflow-hidden bg-[#0c0e12]" style={{ aspectRatio: "1180/560" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/sobrevuelo/hero-real.png"
              alt=""
              className="h-full w-full object-cover"
              style={{ opacity: visible ? 1 : 0, transition: "opacity .8s cubic-bezier(.16,1,.3,1)" }}
            />
          </div>
        </div>
      </div>
    </section>
  );
}
