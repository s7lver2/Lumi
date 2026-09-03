"use client";
import { useEffect, useRef, useState } from "react";
import { agentes, type Agente } from "../lib/agentes";
import { usarRevelado } from "./usarRevelado";

/** «Lo que dice la imagen». Los doce agentes reales que leen la imagen
 *  antes de que empiece la verificación geométrica, en un carrusel — no
 *  una rejilla — porque cada uno lleva bastante dato real como para que
 *  una tarjeta pequeña lo aplaste: el motor que lo resuelve, la pregunta
 *  exacta que se le hace, sus etiquetas de salida posibles y el umbral de
 *  confianza que debe superar. Lo diferencial no es la lista, es la regla
 *  que la gobierna: un agente que no vio suficiente lo dice, no
 *  desaparece ni finge una respuesta.*/
export function Agentes() {
  const lista = agentes();
  const { ref, visible } = usarRevelado<HTMLElement>();

  return (
    <section ref={ref} id="agentes" className="mx-auto max-w-[1180px] px-7 py-28">
      <span
        className="font-mono text-[11px] uppercase tracking-wide text-subtle"
        style={visible ? { animation: "jg-reveal-up .7s cubic-bezier(.16,1,.3,1) both" } : { opacity: 0 }}
      >
        meet lumi
      </span>
      <h2
        className="mt-2 text-[clamp(24px,3.4vw,36px)] font-semibold tracking-tight"
        style={visible ? { animation: "jg-reveal-up .7s cubic-bezier(.16,1,.3,1) both .05s" } : { opacity: 0 }}
      >
        Lo que dice la imagen
      </h2>
      <p
        className="mt-3 max-w-[70ch] leading-relaxed text-muted"
        style={visible ? { animation: "jg-reveal-up .7s cubic-bezier(.16,1,.3,1) both .1s" } : { opacity: 0 }}
      >
        Antes de que compita ningún verificador geométrico, doce agentes leen la imagen y
        acotan dónde puede estar tomada — o describen lo que ven sin acotar nada. Un agente
        que no vio lo suficiente para decidir lo dice; no desaparece ni finge una respuesta.
        Es la misma regla que aplica el cliente en el panel de hipótesis.
      </p>

      <div
        className="mt-10"
        style={visible ? { animation: "jg-reveal-up .8s cubic-bezier(.16,1,.3,1) both .16s" } : { opacity: 0 }}
      >
        <Carrusel agentes={lista} />
      </div>
    </section>
  );
}

function Carrusel({ agentes: lista }: { agentes: Agente[] }) {
  const pistaRef = useRef<HTMLDivElement>(null);
  const [indice, setIndice] = useState(0);

  function irA(i: number) {
    const pista = pistaRef.current;
    if (!pista) return;
    const objetivo = pista.children[i] as HTMLElement | undefined;
    if (!objetivo) return;
    objetivo.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  }

  // El índice activo también se actualiza cuando el usuario arrastra o
  // hace swipe a mano (no solo con las flechas): mide qué tarjeta queda
  // más centrada en cada evento de scroll, con un pelín de respiro (rAF)
  // para no recalcular en cada píxel.
  useEffect(() => {
    const pista = pistaRef.current;
    if (!pista) return;
    let pendiente = false;
    function medir() {
      pendiente = false;
      const centroLista = pista!.scrollLeft + pista!.clientWidth / 2;
      let mejor = 0, mejorDist = Infinity;
      Array.from(pista!.children).forEach((hijo, i) => {
        const el = hijo as HTMLElement;
        const centro = el.offsetLeft + el.clientWidth / 2;
        const dist = Math.abs(centro - centroLista);
        if (dist < mejorDist) { mejorDist = dist; mejor = i; }
      });
      setIndice(mejor);
    }
    function alScroll() {
      if (pendiente) return;
      pendiente = true;
      requestAnimationFrame(medir);
    }
    pista.addEventListener("scroll", alScroll, { passive: true });
    medir();
    return () => pista.removeEventListener("scroll", alScroll);
  }, []);

  function alTeclado(e: React.KeyboardEvent) {
    if (e.key === "ArrowRight") irA(Math.min(lista.length - 1, indice + 1));
    if (e.key === "ArrowLeft") irA(Math.max(0, indice - 1));
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-4">
        <div className="flex gap-1.5">
          {lista.map((a, i) => (
            <button
              key={a.id}
              type="button"
              aria-label={`Ir a ${a.nombre}`}
              className="jg-micro py-2"
              onClick={() => irA(i)}
            >
              <span
                className={i === indice ? "block h-[3px] w-6 rounded-full bg-fg transition-all duration-300" : "block h-[3px] w-3 rounded-full bg-subtle/50 transition-all duration-300"}
              />
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-[11px] text-subtle tabular-nums">
            {String(indice + 1).padStart(2, "0")} / {String(lista.length).padStart(2, "0")}
          </span>
          <FlechaCarrusel direccion="izquierda" onClick={() => irA(Math.max(0, indice - 1))} deshabilitada={indice === 0} />
          <FlechaCarrusel direccion="derecha" onClick={() => irA(Math.min(lista.length - 1, indice + 1))} deshabilitada={indice === lista.length - 1} />
        </div>
      </div>

      <div
        ref={pistaRef}
        tabIndex={0}
        onKeyDown={alTeclado}
        className="jg-carrusel mt-4 flex snap-x snap-mandatory gap-4 overflow-x-auto pb-2 outline-none"
        style={{ scrollbarWidth: "none" }}
      >
        {lista.map((a) => (
          <TarjetaAgente key={a.id} a={a} />
        ))}
      </div>
    </div>
  );
}

function FlechaCarrusel({
  direccion, onClick, deshabilitada,
}: { direccion: "izquierda" | "derecha"; onClick: () => void; deshabilitada: boolean }) {
  return (
    <button
      type="button"
      aria-label={direccion === "izquierda" ? "Anterior" : "Siguiente"}
      onClick={onClick}
      disabled={deshabilitada}
      className="jg-micro jg-micro-scale flex h-7 w-7 items-center justify-center rounded-[7px] border border-border text-subtle hover:border-subtle hover:text-fg disabled:opacity-30 disabled:hover:border-border disabled:hover:text-subtle"
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
        <path
          d={direccion === "izquierda" ? "M15 5l-7 7 7 7" : "M9 5l7 7-7 7"}
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}

function TarjetaAgente({ a }: { a: Agente }) {
  return (
    <div
      className="jg-micro shrink-0 snap-center rounded-card border border-border bg-panel p-6 hover:border-subtle"
      style={{ width: "min(560px, 84vw)", transition: "border-color .2s cubic-bezier(.22,1,.36,1)" }}
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-[18px] font-semibold text-fg">{a.nombre}</h3>
        <span
          className={`shrink-0 rounded-[5px] px-1.5 py-0.5 font-mono text-[10px] ${
            a.tipo === "filtra" ? "border border-fg/25 text-fg" : "bg-elevated text-subtle"
          }`}
        >
          {a.tipo}
        </span>
      </div>

      <div className="mt-1.5 flex items-center gap-2 font-mono text-[10.5px] text-subtle">
        <span>motor · {a.motor}</span>
        {a.restriccion && (
          <>
            <span className="text-subtle/50">·</span>
            <span>acota por {a.restriccion}</span>
          </>
        )}
      </div>

      <p className="mt-4 border-l border-border pl-3 text-[13.5px] italic leading-relaxed text-muted">
        “{a.pregunta}”
      </p>

      <div className="mt-4 flex flex-wrap gap-1.5">
        {a.etiquetas.map((et) => (
          <span key={et} className="rounded-[5px] border border-border bg-elevated px-1.5 py-0.5 font-mono text-[10px] text-subtle">
            {et}
          </span>
        ))}
      </div>

      <div className="mt-5 border-t border-border pt-3.5">
        <div className="flex items-baseline justify-between font-mono text-[10.5px] text-subtle">
          <span>umbral de confianza</span>
          <span className="text-fg tabular-nums">{a.umbral_confianza.toFixed(2)}</span>
        </div>
        <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-elevated">
          <div className="h-full rounded-full bg-fg" style={{ width: `${a.umbral_confianza * 100}%` }} />
        </div>
      </div>
    </div>
  );
}
