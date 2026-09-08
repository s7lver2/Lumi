"use client";
import { useEffect, useRef } from "react";
import { usarEscenaViva } from "../usarEscenaViva";

/** El hero de Pro: cuatro estrellas (la misma estrella de cuatro puntas del
 *  icono real de Lumi, ver `SelectorDescarga.tsx`) vuelan desde el cielo
 *  hasta un punto del mapa y clavan una chincheta cada una — es lo que hace
 *  Pro de verdad: varios candidatos entran a la vez, y solo cuando los
 *  cuatro han "aterrizado" la geometría decide cuál se queda (más grande,
 *  con un halo) mientras los demás se encogen. Dos fases distintas del
 *  mismo reloj, no cuatro animaciones sueltas — el reveal del ganador SIEMPRE
 *  ocurre después de que las cuatro hayan llegado, nunca a la vez.
 *
 *  El mapa de fondo es geografía real (`mapaAsciiMundo`, rasterizado en el
 *  servidor a partir de world-atlas/land-110m.json, el mismo dataset que ya
 *  usa `siluetaContinentes` en el resto del sitio) — no textura decorativa
 *  inventada. */

const ESTRELLA_D = "M512 176c30 188 116 274 300 300-184 26-270 112-300 300-30-188-116-274-300-300 184-26 270-112 300-300z";
// Pin de mapa: bulbo redondeado con agujero + punta, proporción clásica de
// marcador (24x24, punta en 12,23) — geometría genérica, no un icono de
// ninguna librería ni marca de nadie.
const PIN_D = "M12 0.5C7.03 0.5 3 4.53 3 9.5c0 6.5 9 14 9 14s9-7.5 9-14c0-4.97-4.03-9-9-9z";

const VB_W = 1000, VB_H = 620;
function proyectar(lon: number, lat: number) {
  return { x: ((lon + 180) / 360) * VB_W, y: ((90 - lat) / 180) * VB_H };
}

type Ciudad = { lon: number; lat: number };

// Fondo de ciudades reales del que se sortean 4 en cada ciclo — no
// representan nada del registro (Pro no tiene "4 ciudades favoritas"), son
// solo puntos de referencia con dispersión geográfica real. Sortear entre
// más de 4 es lo que hace que cada vuelta del bucle aterrice en sitios
// distintos en vez de repetir siempre el mismo teatro.
const CIUDADES: Ciudad[] = [
  { lon: -3.7, lat: 40.4 }, // Madrid
  { lon: -74.0, lat: 40.7 }, // Nueva York
  { lon: 139.7, lat: 35.6 }, // Tokio
  { lon: -46.6, lat: -23.5 }, // São Paulo
  { lon: 31.2, lat: 30.0 }, // El Cairo
  { lon: 151.2, lat: -33.9 }, // Sídney
  { lon: 18.4, lat: -33.9 }, // Ciudad del Cabo
  { lon: 37.6, lat: 55.75 }, // Moscú
  { lon: 72.9, lat: 19.1 }, // Bombay
  { lon: -79.4, lat: 43.7 }, // Toronto
];

function barajar<T>(arr: T[]): T[] {
  const copia = arr.slice();
  for (let i = copia.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copia[i], copia[j]] = [copia[j], copia[i]];
  }
  return copia;
}

function elegirRonda(n: number) {
  const elegidas = barajar(CIUDADES).slice(0, n);
  const ganador = Math.floor(Math.random() * n);
  // cieloX con separación mínima garantizada (repartidos en n tramos con
  // jitter dentro de cada uno) en vez de aleatorio puro, para que dos
  // estrellas no salgan pegadas por casualidad.
  const cieloX = barajar(
    Array.from({ length: n }, (_, i) => (i + 0.5) / n + (Math.random() - 0.5) * (0.7 / n)),
  );
  return elegidas.map((c, i) => ({ ...c, cieloX: cieloX[i], esGanador: i === ganador }));
}

function easeOutCubic(x: number) { return 1 - Math.pow(1 - x, 3); }
function easeOutBack(x: number) { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); }
function easeInOutQuad(x: number) { return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2; }
function clamp01(x: number) { return Math.max(0, Math.min(1, x)); }

export function HeroCarrera({ mapa }: { mapa: string }) {
  const seccionRef = useRef<HTMLDivElement>(null);
  const preRef = useRef<HTMLPreElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const { viva, reducido } = usarEscenaViva(seccionRef);

  const filasMapa = mapa.split("\n");
  const colsMapa = Math.max(...filasMapa.map((f) => f.length));

  // Tamaño de fuente que hace que el bloque de caracteres llene la mayor
  // parte de la sección sin desbordarla — el mismo cálculo que ya usa
  // `HeroIndice.tsx` para su rejilla, adaptado a un bloque de texto fijo
  // (aquí no cambia de contenido con el tamaño, solo de escala).
  useEffect(() => {
    const seccion = seccionRef.current, pre = preRef.current;
    if (!seccion || !pre) return;
    function ajustar() {
      const w = seccion!.clientWidth, h = seccion!.clientHeight;
      const porAncho = w / (colsMapa * 0.6);
      const porAlto = h / filasMapa.length;
      // "Cover", no "contain": el bloque de caracteres tiene que llenar el
      // hero entero sin dejar franjas vacías a los lados, aunque eso
      // signifique que sobre por arriba/abajo — el contenedor ya recorta
      // con `overflow-hidden` y el degradado disimula el corte, igual que
      // haría una imagen de fondo con `background-size: cover`.
      const fontPx = Math.max(3, Math.max(porAncho, porAlto));
      pre!.style.fontSize = `${fontPx}px`;
    }
    ajustar();
    window.addEventListener("resize", ajustar);
    return () => window.removeEventListener("resize", ajustar);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const svgActual = svgRef.current;
    if (!svgActual) return;
    // Recapturado en un `const` no-nulo aparte: TypeScript no arrastra el
    // estrechamiento de `if (!svgActual) return` dentro de las funciones
    // anidadas de más abajo (limitación conocida del análisis de flujo con
    // declaraciones `function`), así que `svg` de aquí en adelante ya tiene
    // el tipo correcto sin `!` repetidos por todos lados.
    const svg: SVGSVGElement = svgActual;
    const NS = "http://www.w3.org/2000/svg";
    function el<K extends string>(tag: K, attrs: Record<string, string | number>) {
      const e = document.createElementNS(NS, tag);
      for (const k in attrs) e.setAttribute(k, String(attrs[k]));
      return e;
    }

    const CIELO_Y = VB_H * 0.08;
    const N = 4;

    // Los nodos SVG se crean UNA vez y se reutilizan ronda tras ronda —
    // solo cambian `origen`/`destino`/`esGanador` en cada ciclo nuevo, no
    // hace falta destruir y recrear el DOM para "otras ubicaciones".
    function crearPieza() {
      const grupoEstrella = el("g", { opacity: 0 });
      grupoEstrella.appendChild(el("path", { d: ESTRELLA_D, fill: "#e8e8e6" }));
      svg.appendChild(grupoEstrella);

      const sombra = el("ellipse", { cx: 0, cy: 0, rx: 4, ry: 1.6, fill: "rgba(0,0,0,.35)", opacity: 0 });
      svg.appendChild(sombra);

      const grupoPin = el("g", { opacity: 0 });
      const cuerpoPin = el("path", { d: PIN_D, fill: "rgba(232,232,230,.6)", stroke: "rgba(0,0,0,.4)", "stroke-width": 0.5 });
      grupoPin.appendChild(cuerpoPin);
      grupoPin.appendChild(el("circle", { cx: 12, cy: 9.5, r: 3.4, fill: "#0a0b0d" }));
      svg.appendChild(grupoPin);

      const halo = el("circle", { cx: 0, cy: 0, r: 6, fill: "none", stroke: "rgba(232,232,230,.5)", "stroke-width": 1, opacity: 0 });
      svg.appendChild(halo);

      return {
        origen: { x: 0, y: 0 }, destino: { x: 0, y: 0 }, esGanador: false,
        grupoEstrella, grupoPin, cuerpoPin, sombra, halo,
      };
    }
    const piezas = Array.from({ length: N }, crearPieza);

    function sortearRonda() {
      const ronda = elegirRonda(N);
      ronda.forEach((c, i) => {
        const p = piezas[i];
        p.destino = proyectar(c.lon, c.lat);
        p.origen = { x: VB_W * c.cieloX, y: CIELO_Y };
        p.esGanador = c.esGanador;
        p.cuerpoPin.setAttribute("fill", c.esGanador ? "#ffffff" : "rgba(232,232,230,.6)");
      });
    }
    sortearRonda();
    const RETRASO_ENTRE = 0.5;
    const VUELO = 0.85;
    const ULTIMA_LLEGADA = (N - 1) * RETRASO_ENTRE + VUELO;
    const PAUSA_IGUALADOS = 0.6;
    const REVEAL = 0.6;
    const PAUSA_GANADOR = 1.8;
    const DESVANECE = 0.5;
    const T_REVEAL = ULTIMA_LLEGADA + PAUSA_IGUALADOS;
    const T_GANADOR_LISTO = T_REVEAL + REVEAL;
    const T_DESVANECE = T_GANADOR_LISTO + PAUSA_GANADOR;
    const CICLO = T_DESVANECE + DESVANECE + 0.4;

    let id: number;
    let vivo = true;

    function fotograma(t: number) {
      const globalOpacidad = t > T_DESVANECE ? 1 - easeInOutQuad(clamp01((t - T_DESVANECE) / DESVANECE)) : 1;

      piezas.forEach((p, i) => {
        const tSalida = i * RETRASO_ENTRE;
        const tLlegada = tSalida + VUELO;
        const fVuelo = clamp01((t - tSalida) / VUELO);
        const progreso = easeOutCubic(fVuelo);
        const x = p.origen.x + (p.destino.x - p.origen.x) * progreso;
        const y = p.origen.y + (p.destino.y - p.origen.y) * progreso;
        const escalaVuelo = t < tSalida ? 0 : 0.55 + 0.45 * Math.sin(Math.min(1, fVuelo) * Math.PI);
        const enVuelo = t >= tSalida && t < tLlegada + 0.12;

        p.grupoEstrella.setAttribute("opacity", String(enVuelo ? globalOpacidad : 0));
        p.grupoEstrella.setAttribute("transform", `translate(${x - 11 * escalaVuelo},${y - 11 * escalaVuelo}) scale(${0.022 * escalaVuelo})`);

        const fPin = clamp01((t - tLlegada) / 0.3);
        const antesDeReveal = t < T_REVEAL;
        let escalaPin = fPin <= 0 ? 0 : antesDeReveal ? easeOutBack(fPin) : 1;
        // La aparición del pin en sí (opacidad) va con su propia curva de
        // salida en vez de seguir a pelo la misma `fPin` lineal que ya
        // gobierna el rebote de la escala -- se nota menos "a la vez todo".
        let opacidadPin = easeOutCubic(fPin);

        if (!antesDeReveal) {
          const fReveal = clamp01((t - T_REVEAL) / REVEAL);
          const revelado = easeInOutQuad(fReveal);
          if (p.esGanador) {
            escalaPin = 1 + easeOutBack(fReveal) * 0.9;
          } else {
            escalaPin = 1 - revelado * 0.35;
            opacidadPin = 1 - revelado * 0.55;
          }
        }
        opacidadPin *= globalOpacidad;

        p.grupoPin.setAttribute("opacity", String(opacidadPin));
        const s = escalaPin * 1.15;
        p.grupoPin.setAttribute("transform", `translate(${p.destino.x - 12 * s},${p.destino.y - 23 * s}) scale(${s})`);

        p.sombra.setAttribute("opacity", String(opacidadPin * 0.7));
        p.sombra.setAttribute("rx", String(4 * escalaPin));

        if (p.esGanador) {
          const pulso = 6 + (Math.sin(t * 3) * 0.5 + 0.5) * 6;
          p.halo.setAttribute("opacity", String(t > T_GANADOR_LISTO ? (0.35 + Math.sin(t * 3) * 0.15) * globalOpacidad : 0));
          p.halo.setAttribute("r", String(pulso));
        }
      });
    }

    if (reducido || !viva) {
      // Un fotograma fijo en el estado final (ganador ya asentado) — nada de
      // bucle que respetar `prefers-reduced-motion` no pararía por su cuenta
      // (el bloque CSS global no toca un `requestAnimationFrame`).
      fotograma(T_GANADOR_LISTO + PAUSA_GANADOR * 0.5);
      return;
    }

    let inicio: number | null = null;
    let cicloActual = 0;
    function paso(ts: number) {
      if (!vivo) return;
      if (inicio === null) inicio = ts;
      const transcurrido = (ts - inicio) / 1000;
      const ciclo = Math.floor(transcurrido / CICLO);
      if (ciclo !== cicloActual) {
        // Nueva vuelta: otras 4 ciudades y otro ganador, sorteados justo
        // cuando todo ya está invisible (fin del desvanecido de la vuelta
        // anterior) -- por eso no se nota el cambio de destino.
        cicloActual = ciclo;
        sortearRonda();
      }
      fotograma(transcurrido - ciclo * CICLO);
      id = window.requestAnimationFrame(paso);
    }
    id = window.requestAnimationFrame(paso);

    return () => {
      vivo = false;
      window.cancelAnimationFrame(id);
      while (svg.firstChild) svg.removeChild(svg.firstChild);
    };
  }, [viva, reducido]);

  return (
    <div ref={seccionRef} className="absolute inset-0 overflow-hidden bg-[#0a0b0d]">
      <div className="absolute inset-0 flex items-center justify-center">
        <pre
          ref={preRef}
          className="m-0 select-none whitespace-pre font-mono leading-none"
          style={{ color: "rgba(232,232,230,.2)" }}
          aria-hidden
        >
          {mapa}
        </pre>
      </div>
      <svg
        ref={svgRef}
        className="pointer-events-none absolute inset-0 h-full w-full"
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        preserveAspectRatio="xMidYMid slice"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "linear-gradient(180deg, #0e0f11 0%, transparent 26%, transparent 74%, #0e0f11 100%), radial-gradient(ellipse at 50% 50%, transparent 44%, #0e0f11 97%)",
        }}
      />
    </div>
  );
}
