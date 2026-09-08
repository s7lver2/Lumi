"use client";
import { useEffect, useRef } from "react";
import { usarEscenaViva } from "../usarEscenaViva";

/** Fondo del hero de Mini: un índice disperso de puntos (el corpus
 *  georreferenciado) sobre el que el cursor actúa como una consulta real —
 *  los puntos cercanos se iluminan y se conectan con la consulta, que es
 *  literalmente lo que hace `cosplace`, el recuperador de Mini (`registros/
 *  niveles/mini.json`). No es una animación decorativa con una excusa
 *  puesta encima: el propio fondo ES el mecanismo del modelo.
 *
 *  Mismo truco que `AsciiWavesBackground.tsx` del cliente — recalcular un
 *  `<pre>` entero por fotograma es barato (una cadena, no nodos de DOM por
 *  carácter), así que no hace falta canvas ni WebGL para esto tampoco.
 *
 *  Sin cursor real (móvil, o antes de que el usuario mueva el ratón), la
 *  consulta no se queda clavada en el centro: recorre un camino lento y
 *  perezoso (dos senoidales desfasadas) para que la escena se sienta viva
 *  sin depender de interacción. */

const FONT_PX = 11;
const LINE_H = 1.15;
const CHAR_W = FONT_PX * 0.6; // ancho aproximado de un carácter mono a este tamaño
const CHAR_H = FONT_PX * LINE_H;
const DENSIDAD = 260 / (100 * 34); // puntos por celda, calibrada a ojo en el experimento

function hash(i: number) {
  const x = Math.sin(i * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

export function HeroIndice() {
  const seccionRef = useRef<HTMLDivElement>(null);
  const preRef = useRef<HTMLPreElement>(null);
  const { viva, reducido } = usarEscenaViva(seccionRef);
  // Posición del puntero relativa a la sección, en fracción 0-1. `null`
  // mientras no ha habido interacción real — entonces manda el recorrido
  // perezoso en vez de la posición del ratón.
  const punteroRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const el = seccionRef.current;
    if (!el) return;
    function mover(e: PointerEvent) {
      const r = el!.getBoundingClientRect();
      punteroRef.current = {
        x: (e.clientX - r.left) / r.width,
        y: (e.clientY - r.top) / r.height,
      };
    }
    function salir() { punteroRef.current = null; }
    el.addEventListener("pointermove", mover);
    el.addEventListener("pointerleave", salir);
    return () => {
      el.removeEventListener("pointermove", mover);
      el.removeEventListener("pointerleave", salir);
    };
  }, []);

  useEffect(() => {
    const pre = preRef.current;
    const seccion = seccionRef.current;
    if (!pre || !seccion) return;

    let cols = 0, rows = 0;
    let puntos: { x: number; y: number }[] = [];
    function dimensionar() {
      const w = seccion!.clientWidth, h = seccion!.clientHeight;
      cols = Math.ceil(w / CHAR_W) + 4;
      rows = Math.ceil(h / CHAR_H) + 4;
      const n = Math.round(cols * rows * DENSIDAD);
      puntos = Array.from({ length: n }, (_, i) => ({ x: hash(i * 2), y: hash(i * 2 + 1) }));
    }
    dimensionar();
    window.addEventListener("resize", dimensionar);

    let sx = 0.5, sy = 0.5; // posición suavizada de la consulta
    let vivo = true;
    let id: number;

    function consultaObjetivo(t: number): { x: number; y: number } {
      const p = punteroRef.current;
      if (p) return p;
      // Camino perezoso: dos senoidales de periodo distinto, nunca se repite
      // en un ciclo corto y reconocible.
      return {
        x: 0.5 + Math.sin(t * 0.11) * 0.32,
        y: 0.5 + Math.sin(t * 0.07 + 1.3) * 0.28,
      };
    }

    function fotograma(t: number) {
      const objetivo = consultaObjetivo(t);
      sx += (objetivo.x - sx) * 0.08;
      sy += (objetivo.y - sy) * 0.08;

      const grid: string[][] = Array.from({ length: rows }, () => Array(cols).fill(" "));

      for (const p of puntos) {
        const c = Math.floor(p.x * cols), r = Math.floor(p.y * rows);
        const dx = p.x - sx, dy = (p.y - sy) * (rows / cols) * 2.4;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const cerca = Math.max(0, 1 - dist * 3.2);
        const parpadeo = Math.sin(t * 0.6 + p.x * 20) * 0.5 + 0.5;
        const ch = cerca > 0.7 ? "●" : cerca > 0.35 ? "•" : parpadeo > 0.85 ? "·" : ".";
        if (r >= 0 && r < rows && c >= 0 && c < cols) grid[r][c] = ch;
      }

      // Líneas finas de "recuperación": de la consulta a cada punto cercano.
      for (const p of puntos) {
        const dx = p.x - sx, dy = (p.y - sy) * (rows / cols) * 2.4;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist >= 0.11) continue;
        const pasos = 10;
        for (let s = 1; s < pasos; s++) {
          const f = s / pasos;
          const ix = sx + (p.x - sx) * f, iy = sy + (p.y - sy) * f;
          const c = Math.floor(ix * cols), r = Math.floor(iy * rows);
          if (r >= 0 && r < rows && c >= 0 && c < cols && grid[r][c] === " ") grid[r][c] = "·";
        }
      }

      const cc = Math.floor(sx * cols), rr = Math.floor(sy * rows);
      if (rr >= 0 && rr < rows && cc >= 0 && cc < cols) grid[rr][cc] = "◆";

      pre!.textContent = grid.map((fila) => fila.join("")).join("\n");
    }

    function bucle(now: number) {
      if (!vivo) return;
      fotograma(now / 1000);
      id = window.requestAnimationFrame(bucle);
    }

    if (reducido || !viva) {
      fotograma(0);
    } else {
      id = window.requestAnimationFrame(bucle);
    }

    return () => {
      vivo = false;
      window.cancelAnimationFrame(id);
      window.removeEventListener("resize", dimensionar);
    };
  }, [viva, reducido]);

  return (
    <div ref={seccionRef} className="absolute inset-0 overflow-hidden bg-[#08090a]">
      <pre
        ref={preRef}
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 select-none whitespace-pre
          font-mono text-[11px] leading-[1.15] text-[#3d3f43]"
        aria-hidden
      />
      <div className="pointer-events-none absolute inset-0"
        style={{ background: "radial-gradient(ellipse at 50% 40%, transparent 40%, #050607 100%)" }} />
    </div>
  );
}
