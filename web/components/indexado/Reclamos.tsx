"use client";

import { useEffect, useRef, useState } from "react";
import { usarRevelado } from "../usarRevelado";

const W = 400, H = 220;
const COLS = 5, ROWS = 4, TS = 34, GAP = 4;
const ORIGIN_X = 110, ORIGIN_Y = 50;
const OBJETIVO = { col: 3, fila: 1 };
const CURSOR_INICIO = { x: 34, y: 22 };

// El orden en el que el cursor "arrastra" la selección — un recorrido en
// dos filas, no aleatorio, para que se lea como un área que se dibuja de
// verdad. El objetivo va el último: el cursor ya está encima cuando le toca
// bloquearse, sin un salto extra solo para eso.
const RECORRIDO = [
  { col: 0, fila: 0 }, { col: 1, fila: 0 }, { col: 2, fila: 0 },
  { col: 0, fila: 1 }, { col: 1, fila: 1 },
  OBJETIVO,
];

function key(col: number, fila: number) {
  return `${col}-${fila}`;
}
function centroDe(col: number, fila: number) {
  return { x: ORIGIN_X + col * (TS + GAP) + TS / 2, y: ORIGIN_Y + fila * (TS + GAP) + TS / 2 };
}

const CELDAS = Array.from({ length: ROWS }, (_, fila) =>
  Array.from({ length: COLS }, (_, col) => ({ col, fila, x: ORIGIN_X + col * (TS + GAP), y: ORIGIN_Y + fila * (TS + GAP) })),
).flat();

const OBJETIVO_CENTRO = centroDe(OBJETIVO.col, OBJETIVO.fila);
const AVATAR_POS = { x: OBJETIVO_CENTRO.x + TS / 2 - 4, y: OBJETIVO_CENTRO.y - TS / 2 - 4 };

const GLASS = "rounded-lg border border-white/[.13] bg-[rgba(16,19,25,.92)] shadow-lg shadow-black/40 backdrop-blur-xl";

function CursorIcono() {
  return (
    <path
      d="M0 0 L0 15.5 L3.6 12.2 L6.2 18.3 L8.7 17.2 L6.1 11 L10.4 11 Z"
      fill="#e8e8e6" stroke="#0c0e12" strokeWidth={1} strokeLinejoin="round"
    />
  );
}
function CandadoIcono() {
  return (
    <g className="jg-lock-breathe" style={{ transformOrigin: `${OBJETIVO_CENTRO.x}px ${OBJETIVO_CENTRO.y - 10}px` }}>
      <rect x={OBJETIVO_CENTRO.x - 7} y={OBJETIVO_CENTRO.y - 6} width={14} height={9} rx={1.5} fill="#0c0e12" stroke="#e88f8f" strokeWidth={1.6} />
      <path d={`M${OBJETIVO_CENTRO.x - 4} ${OBJETIVO_CENTRO.y - 6}V${OBJETIVO_CENTRO.y - 10}a4 4 0 0 1 8 0v4`} fill="none" stroke="#e88f8f" strokeWidth={1.6} />
    </g>
  );
}

// Tiempos del ciclo, en ms desde que arranca — un único sitio para leer la
// coreografía entera en vez de perseguir setTimeouts sueltos.
const T = {
  inicioBarrido: 300,
  pasoBarrido: 380,
  pausaTrasBarrido: 350,
  viajeAAvatar: 500,
  esperaEnAvatar: 250,
  infoAbierta: 1900,
  cerrando: 450,
  pausaAntesDeRepetir: 700,
};

/** El cursor arrastra una selección sobre la rejilla: las teselas se
 *  iluminan una a una (mismo azul que `.dibujo-relleno` en el Indexer real
 *  — es literalmente "esto se está seleccionando ahora"), salvo la última,
 *  que ya es de otra persona y en vez de iluminarse se pone a parpadear en
 *  rojo. El cursor hace clic ahí: aparece un candado y el avatar de quien
 *  la tiene en la esquina. Un segundo clic sobre el avatar abre su ficha.
 *  Se cierra, todo vuelve a cero, y arranca otra vez — un bucle, no una
 *  escena de una sola vez. Con `prefers-reduced-motion` se queda en el
 *  fotograma final (bloqueada, ficha abierta) sin repetir nada. */
export function Reclamos() {
  const { ref, visible } = usarRevelado<HTMLDivElement>();
  const [cursorPos, setCursorPos] = useState(CURSOR_INICIO);
  const [cursorVisible, setCursorVisible] = useState(false);
  const [cursorClic, setCursorClic] = useState(false);
  const [iluminadas, setIluminadas] = useState<Set<string>>(new Set());
  const [bloqueada, setBloqueada] = useState(false);
  const [candado, setCandado] = useState(false);
  const [avatar, setAvatar] = useState(false);
  const [info, setInfo] = useState(false);
  const timeouts = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    if (!visible) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setBloqueada(true); setCandado(true); setAvatar(true); setInfo(true);
      return;
    }

    function reset() {
      setIluminadas(new Set());
      setBloqueada(false);
      setCandado(false);
      setAvatar(false);
      setInfo(false);
      setCursorVisible(false);
      setCursorPos(CURSOR_INICIO);
    }

    function ciclo() {
      reset();
      let t = T.inicioBarrido;
      setCursorVisible(true);

      RECORRIDO.forEach((celda, i) => {
        const esObjetivo = celda === OBJETIVO;
        timeouts.current.push(setTimeout(() => {
          setCursorPos(centroDe(celda.col, celda.fila));
          if (esObjetivo) setBloqueada(true);
          else setIluminadas((prev) => new Set(prev).add(key(celda.col, celda.fila)));
        }, t));
        t += T.pasoBarrido;
      });
      t += T.pausaTrasBarrido;

      // Clic sobre la tesela bloqueada
      timeouts.current.push(setTimeout(() => {
        setCursorClic(true);
        setCandado(true);
        setAvatar(true);
        timeouts.current.push(setTimeout(() => setCursorClic(false), 180));
      }, t));
      t += T.viajeAAvatar;

      timeouts.current.push(setTimeout(() => setCursorPos(AVATAR_POS), t));
      t += T.esperaEnAvatar;

      // Clic sobre el avatar
      timeouts.current.push(setTimeout(() => {
        setCursorClic(true);
        setInfo(true);
        timeouts.current.push(setTimeout(() => setCursorClic(false), 180));
      }, t));
      t += T.infoAbierta;

      timeouts.current.push(setTimeout(() => setInfo(false), t));
      t += T.cerrando + T.pausaAntesDeRepetir;

      timeouts.current.push(setTimeout(ciclo, t));
    }

    ciclo();
    return () => {
      timeouts.current.forEach(clearTimeout);
      timeouts.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  return (
    <section id="reclamos" className="mx-auto grid max-w-[1180px] grid-cols-1 items-center gap-14 px-7 py-24 md:grid-cols-2">
      <div ref={ref} className="relative rounded-card border border-border bg-[#0c0e12] p-6.5">
        <svg viewBox={`0 0 ${W} ${H}`} className="block w-full overflow-visible">
          <text x={ORIGIN_X} y={ORIGIN_Y - 14} fill="#6a6c70" fontSize={9} fontFamily="ui-monospace,SFMono-Regular,Menlo,monospace">
            dibujando un área nueva para analizar
          </text>

          {CELDAS.map((cel) => {
            const esObjetivo = cel.col === OBJETIVO.col && cel.fila === OBJETIVO.fila;
            const iluminada = iluminadas.has(key(cel.col, cel.fila));
            const fill = esObjetivo && bloqueada ? "rgba(170,51,51,.3)" : iluminada ? "rgba(55,138,221,.18)" : "rgba(255,255,255,.02)";
            const stroke = esObjetivo && bloqueada ? "#e88f8f" : iluminada ? "#85b7eb" : "rgba(232,232,230,.14)";
            return (
              <rect
                key={key(cel.col, cel.fila)}
                x={cel.x} y={cel.y} width={TS} height={TS} rx={3}
                fill={fill} stroke={stroke}
                strokeDasharray={!iluminada && !(esObjetivo && bloqueada) ? "2 2" : undefined}
                strokeWidth={esObjetivo && bloqueada ? 1.1 : iluminada ? 0.9 : 0.7}
                className={esObjetivo && bloqueada ? "jg-tesela-bloqueo" : undefined}
                style={{
                  opacity: visible ? 1 : 0,
                  transition: "opacity .3s ease, fill .25s ease, stroke .25s ease",
                }}
              >
                <title>{esObjetivo && bloqueada ? "de otra persona" : iluminada ? "seleccionada" : "sin seleccionar"}</title>
              </rect>
            );
          })}

          {candado && <CandadoIcono />}

          <g
            style={{
              transform: `translate(${AVATAR_POS.x}px, ${AVATAR_POS.y}px) scale(${avatar ? 1 : 0.6})`,
              opacity: avatar ? 1 : 0,
              transition: "transform .3s cubic-bezier(.16,1,.3,1), opacity .25s ease",
            }}
          >
            <circle r={11} fill="#202226" stroke="#e8e8e6" strokeWidth={0.75} />
            <text textAnchor="middle" dominantBaseline="central" fill="#e8e8e6" fontSize={10} fontWeight={600} fontFamily="Inter,system-ui,sans-serif">
              M
            </text>
          </g>

          {cursorClic && (
            <circle
              cx={cursorPos.x} cy={cursorPos.y} r={16} fill="none"
              stroke={bloqueada && cursorPos === AVATAR_POS ? "#e8e8e6" : "#e88f8f"} strokeWidth={1.2}
              className="jg-anillo-clic"
            />
          )}

          <g
            style={{
              transform: `translate(${cursorPos.x}px, ${cursorPos.y}px) scale(${cursorClic ? 0.82 : 1})`,
              transformOrigin: "0px 0px",
              opacity: cursorVisible ? 1 : 0,
              transition: "transform .35s cubic-bezier(.16,1,.3,1), opacity .3s ease",
            }}
          >
            <CursorIcono />
          </g>
        </svg>

        <div
          className={`absolute w-[150px] p-2.5 ${GLASS}`}
          style={{
            left: `${(AVATAR_POS.x / W) * 100}%`,
            top: `${(AVATAR_POS.y / H) * 100}%`,
            transform: `translate(14px, -50%) scale(${info ? 1 : 0.9})`,
            opacity: info ? 1 : 0,
            pointerEvents: "none",
            transition: "transform .25s cubic-bezier(.16,1,.3,1), opacity .2s ease",
          }}
        >
          <p className="text-[11.5px] font-medium text-fg">mgarcia</p>
          <p className="mt-1 font-mono text-[9.5px] text-subtle">12 teselas publicadas</p>
          <p className="font-mono text-[9.5px] text-subtle">autor desde 2026</p>
        </div>
      </div>

      <div>
        <span className="font-mono text-[11px] uppercase tracking-wide text-subtle">territorio propio</span>
        <h2 className="mt-2 text-[clamp(22px,2.8vw,30px)] font-semibold tracking-tight">Un trozo del planeta, con tu nombre</h2>
        <p className="mt-3 max-w-[46ch] leading-relaxed text-muted">
          Si dibujas sobre una tesela que ya reclamó otra persona, el mapa te lo dice antes de
          gastar nada — de quién es, no solo que está ocupada.
        </p>
        <div className="mt-4 flex items-baseline gap-2 font-mono text-[12px]">
          <span className="relative text-subtle">
            1.2 GB
            <span
              className="absolute left-0 top-1/2 h-px w-full bg-subtle"
              style={{ transform: bloqueada ? "scaleX(1)" : "scaleX(0)", transformOrigin: "left", transition: "transform .5s cubic-bezier(.16,1,.3,1)" }}
            />
          </span>
          <span className="text-subtle">→</span>
          <span className="font-semibold text-fg" style={{ opacity: bloqueada ? 1 : 0, transition: "opacity .3s ease .2s" }}>
            0 B para quien la reclama
          </span>
        </div>
      </div>
    </section>
  );
}
