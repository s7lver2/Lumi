/** Fondo alternativo de las pantallas de entrada (#120): olas hechas de
 *  caracteres ASCII, misma paleta y misma composición (radial-gradient que
 *  se come los bordes) que `WavesBackground`. La fase de las dos senoidales
 *  avanza con el tiempo, así que el patrón fluye igual que una ola real en
 *  vez de quedarse fijo — recalcular el `<pre>` entero por fotograma es
 *  barato (una sola cadena de texto, no nodos de DOM por carácter), así que
 *  no hace falta CSS ni WebGL para esto. Respeta «reducir movimiento» igual
 *  que `WavesBackground`: con la preferencia activa se queda en el primer
 *  fotograma en vez de animarse.
 *
 *  `EntryScreen` elige entre este y `WavesBackground` según el ajuste de
 *  Personalización (por defecto, al azar una vez por apertura de la
 *  app). */

import { useEffect, useState } from "react";
import { leerReducirMovimiento } from "../lib/apariencia";

const COLS = 100;
const ROWS = 34;

// De más vacío a más denso: el mismo peso visual que una ola real, sin
// recurrir a ningún carácter fuera de lo que cualquier fuente monoespaciada
// trae de serie.
const RAMPA = [" ", " ", ".", "·", "-", "~", "=", "≈"];

function filaDeOla(fila: number, t: number): string {
  let salida = "";
  for (let c = 0; c < COLS; c++) {
    // Dos senoidales de frecuencia distinta, la segunda desfasada por fila;
    // `t` desplaza la fase de ambas para que la ola fluya con el tiempo.
    const v =
      Math.sin(c / 9 + fila * 0.5 + t) * 0.65 +
      Math.sin(c / 4.2 - fila * 0.28 - t * 0.6) * 0.35;
    // Más silencio cerca de arriba/abajo, para que el propio texto ya se
    // "adelgace" en los bordes antes incluso del degradado que lo cubre.
    const borde = 1 - Math.abs(fila / ROWS - 0.5) * 1.7;
    const peso = Math.max(0, (v * 0.5 + 0.5) * Math.max(0, borde));
    const i = Math.min(RAMPA.length - 1, Math.floor(peso * RAMPA.length));
    salida += RAMPA[i];
  }
  return salida;
}

function textoDeOla(t: number): string {
  return Array.from({ length: ROWS }, (_, r) => filaDeOla(r, t)).join("\n");
}

export function AsciiWavesBackground() {
  const [texto, setTexto] = useState(() => textoDeOla(0));

  useEffect(() => {
    if (leerReducirMovimiento()) return;
    let vivo = true;
    let t = 0;
    let id: number;
    const paso = () => {
      if (!vivo) return;
      t += 0.035;
      setTexto(textoDeOla(t));
      id = window.setTimeout(paso, 90);
    };
    id = window.setTimeout(paso, 90);
    return () => { vivo = false; window.clearTimeout(id); };
  }, []);

  return (
    <div className="fixed inset-0 -z-10 overflow-hidden bg-[#08090a]">
      <pre
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 select-none whitespace-pre
          font-mono text-[11px] leading-[1.15] text-[#4a4c50]"
        aria-hidden
      >
        {texto}
      </pre>
      <div className="absolute inset-0"
        style={{ background: "radial-gradient(ellipse at 50% 40%, transparent 40%, #050607 100%)" }} />
    </div>
  );
}
