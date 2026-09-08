"use client";
import { useEffect, useId, useRef, useState } from "react";
import { usarRevelado } from "./usarRevelado";
import { MiniMapaMundo } from "./MiniMapaMundo";

/** Reemplaza al carrusel de texto de `Agentes.tsx`: en vez de listar los doce
 *  agentes con su motor y su umbral, enseña el panel de hipótesis real del
 *  cliente (`client/src/work/ResultsDrawer.tsx`) aplicado a un atributo
 *  visual — varias especies/idiomas/modelos candidatos con su peso, no una
 *  única respuesta cerrada.
 *
 *  El usuario no sube nada: cada agente trae varias fotos de ejemplo entre
 *  las que elegir (un selector real, no una sola forzada) y eso dispara la
 *  "mini analiza" — spinner, luego resultado — como si estuviera pasando de
 *  verdad. Cada FOTO es su propio caso completo (hipótesis, rasgos, mapa, la
 *  pieza única del lateral): dos fotos del mismo agente pueden dar
 *  resultados totalmente distintos, como pasaría de verdad.
 *
 *  `rasgos` está en % del encuadre y se ha recalibrado a ojo contra cada
 *  foto real (no es un dato derivado de la imagen, es ilustrativo). */
type Hipotesis = { nombre: string; detalle?: string; peso: number };
type Rasgo = { x: number; y: number; w: number; h: number; etiqueta: string };
/** Un vector, en píxeles REALES de la foto (no en %): de la base de un
 *  objeto a la punta de su sombra. En % una flecha rotada saldría con el
 *  ángulo torcido en cuanto la foto no es cuadrada (los ejes X e Y escalan
 *  distinto); en píxeles reales, con el `viewBox` del SVG puesto exactamente
 *  a esas mismas dimensiones, el ángulo sale correcto sin más cuentas. */
type Flecha = { x1: number; y1: number; x2: number; y2: number; etiqueta: string; sol?: boolean };
type Muestra = {
  imagen: string;
  /** Ancho/alto real de la foto — el recuadro de la imagen usa este
   *  `aspect-ratio` exacto para que `object-cover` no recorte nada: si
   *  recortara, los `rasgos` (en % del encuadre ORIGINAL) dejarían de caer
   *  donde tienen que caer. */
  aspecto: number;
  /** Ancho real en píxeles del archivo — junto con `aspecto` da el alto, y
   *  entre los dos definen el `viewBox` de las `flechas`. Todas las fotos
   *  de esta sección se han exportado a 1600 de ancho. */
  anchoPx: number;
  archivo: string;
  alt: string;
  hipotesis: Hipotesis[];
  rasgos: Rasgo[];
  flechas?: Flecha[];
  puntos?: { lon: number; lat: number }[];
  /** Hora estimada (0-24, decimal) del momento de la foto — sustituye al
   *  mapa en el lateral para el caso "hora y estación": ahí lo relevante no
   *  es DÓNDE se tomó, es A QUÉ HORA — `LineaHoraDia` lo representa igual
   *  que una barra de confianza, no como una ilustración. */
  hora?: number;
  /** Piezas únicas del lateral que dependen de la FOTO, no solo del agente
   *  (el texto que de verdad se lee en cada cartel, la placa de cada coche). */
  textoDetectado?: string;
  placa?: { pais: string; texto: string };
};
type Caso = {
  id: string;
  etiqueta: string;
  motor: string;
  proximamente: boolean;
  muestras: Muestra[];
};

const CASOS: Caso[] = [
  {
    id: "especie",
    etiqueta: "especie",
    motor: "vlm",
    proximamente: true,
    muestras: [
      {
        imagen: "/agentes/especie-zorro.webp",
        aspecto: 1600 / 1066,
        anchoPx: 1600,
        archivo: "IMG_2481.jpg",
        alt: "Zorro rojo mirando de frente",
        hipotesis: [
          { nombre: "Vulpes vulpes", detalle: "zorro rojo", peso: 82 },
          { nombre: "Vulpes lagopus", detalle: "zorro ártico", peso: 9 },
          { nombre: "Canis latrans", detalle: "coyote", peso: 5 },
          { nombre: "Nyctereutes procyonoides", detalle: "perro mapache", peso: 4 },
        ],
        rasgos: [
          { x: 53, y: 14, w: 25, h: 19, etiqueta: "orejas" },
          { x: 37, y: 25, w: 42, h: 50, etiqueta: "pelaje" },
          { x: 5, y: 47, w: 46, h: 44, etiqueta: "cola" },
        ],
        // Ilustrativo: el zorro rojo es el cánido más extendido del planeta,
        // presente en casi todo el hemisferio norte — de ahí los tres continentes.
        puntos: [
          { lon: 10, lat: 50 }, { lon: 25, lat: 55 }, { lon: -3, lat: 43 },
          { lon: 90, lat: 55 }, { lon: 60, lat: 50 }, { lon: 135, lat: 45 },
          { lon: -100, lat: 50 }, { lon: -110, lat: 45 }, { lon: -75, lat: 45 },
        ],
      },
    ],
  },
  {
    id: "idioma",
    etiqueta: "idioma del cartel",
    motor: "ocr",
    proximamente: false,
    muestras: [
      {
        imagen: "/agentes/idioma-shinjuku.webp",
        aspecto: 1600 / 1067,
        anchoPx: 1600,
        archivo: "IMG_6021.jpg",
        alt: "Cruce de Kabukicho, Shinjuku, con rótulos en japonés",
        hipotesis: [
          { nombre: "katakana", detalle: "japonés", peso: 88 },
          { nombre: "kanji", detalle: "japonés, compuestos", peso: 7 },
          { nombre: "hangul", detalle: "coreano", peso: 3 },
          { nombre: "chino simplificado", detalle: "China continental", peso: 2 },
        ],
        rasgos: [
          { x: 63, y: 28, w: 37, h: 30, etiqueta: "texto" },
          { x: 0, y: 53, w: 17, h: 16, etiqueta: "tipografía" },
        ],
        puntos: [{ lon: 139.7, lat: 35.7 }, { lon: 135.5, lat: 34.7 }],
        textoDetectado: "ドン・キホーテ",
      },
      {
        imagen: "/agentes/idioma-calle.webp",
        aspecto: 1600 / 899,
        anchoPx: 1600,
        archivo: "IMG_5537.jpg",
        alt: "Calle de Benarés con un cartel en devanagari",
        hipotesis: [
          { nombre: "devanagari", detalle: "India, Nepal", peso: 91 },
          { nombre: "tailandés", detalle: "Tailandia", peso: 4 },
          { nombre: "árabe", detalle: "20 países", peso: 3 },
          { nombre: "cirílico", detalle: "Rusia y vecinos", peso: 2 },
        ],
        rasgos: [
          { x: 20, y: 0, w: 53, h: 19, etiqueta: "texto" },
          { x: 82, y: 47, w: 18, h: 40, etiqueta: "tipografía" },
        ],
        puntos: [{ lon: 78, lat: 21 }, { lon: 84, lat: 28 }],
        textoDetectado: "काशी की",
      },
    ],
  },
  {
    id: "hora",
    etiqueta: "hora y estación",
    motor: "vlm",
    proximamente: true,
    muestras: [
      {
        imagen: "/agentes/idioma-shinjuku.webp",
        aspecto: 1600 / 1067,
        anchoPx: 1600,
        archivo: "IMG_6021.jpg",
        alt: "Cruce de Kabukicho, Shinjuku, en pleno día",
        hipotesis: [
          { nombre: "mediodía · verano", detalle: "sol alto, sombras cortas", peso: 74 },
          { nombre: "media tarde · primavera", detalle: "luz lateral suave", peso: 14 },
          { nombre: "mañana · otoño", detalle: "cielo despejado, sombra larga", peso: 7 },
          { nombre: "atardecer · invierno", detalle: "luz rasante y fría", peso: 5 },
        ],
        rasgos: [
          { x: 2, y: 0, w: 50, h: 13, etiqueta: "cielo" },
          { x: 2, y: 70, w: 38, h: 16, etiqueta: "vestimenta" },
        ],
        // Un objeto y su sombra, en píxeles reales de la foto (1600×1067):
        // de la base del peatón (690,845) a la punta de su sombra en el
        // cruce (500,995) — y, desde el mismo punto, hacia dónde tendría que
        // estar el sol para proyectarla así (760,660). Es la MISMA medición
        // vista desde los dos lados, por eso comparten origen.
        flechas: [
          { x1: 690, y1: 845, x2: 500, y2: 995, etiqueta: "vector de sombra" },
          { x1: 690, y1: 845, x2: 760, y2: 660, etiqueta: "sol estimado", sol: true },
        ],
        // 12:40 — poco después del mediodía solar, coherente con "sol alto,
        // sombras cortas" y con las flechas de arriba (misma estimación).
        hora: 12.67,
      },
    ],
  },
  {
    id: "matricula",
    etiqueta: "matrícula",
    motor: "vlm",
    proximamente: true,
    muestras: [
      {
        imagen: "/agentes/matricula-coche.webp",
        aspecto: 1600 / 1067,
        anchoPx: 1600,
        archivo: "IMG_0942.jpg",
        alt: "Opel Corsa-e naranja en una plaza urbana",
        hipotesis: [
          { nombre: "banda azul UE · Alemania", detalle: "Opel Corsa-e", peso: 89 },
          { nombre: "banda azul UE · Países Bajos", detalle: "Opel Corsa", peso: 6 },
          { nombre: "banda azul UE · Bélgica", detalle: "Opel Corsa", peso: 5 },
        ],
        rasgos: [
          { x: 18, y: 42, w: 68, h: 48, etiqueta: "carrocería" },
          { x: 72, y: 67, w: 11, h: 6, etiqueta: "matrícula" },
        ],
        puntos: [{ lon: 8, lat: 50 }],
        placa: { pais: "D", texto: "GG CE 620E" },
      },
    ],
  },
];

/** Cabeza de zorro simétrica y solo con líneas rectas — a propósito, en vez
 *  de las curvas libres de antes (que salían como una mancha irreconocible):
 *  con el bounding box centrado por construcción (18-82 en X, 8-92 en Y,
 *  sobre un viewBox 0-100) no hace falta ningún ajuste manual para que
 *  quede centrada, y `strokeLinejoin="round"` le quita filo a los vértices. */
const SILUETA_ZORRO =
  "M50,92 L30,68 L22,40 L34,18 L18,8 L42,32 L50,26 L58,32 " +
  "L82,8 L66,18 L78,40 L70,68 Z";

function SiluetaConfianza({ porcentaje }: { porcentaje: number }) {
  const id = useId();
  const clipY = 100 - porcentaje;
  return (
    <div className="grid h-16 w-16 shrink-0 place-items-center rounded-full border border-border bg-white/[.04]">
      <svg viewBox="0 0 100 100" className="h-10 w-10" role="img" aria-hidden>
        <defs>
          <clipPath id={id}>
            <rect x={0} y={clipY} width={100} height={porcentaje}>
              <animate attributeName="y" from="100" to={clipY} dur=".7s" fill="freeze" />
              <animate attributeName="height" from="0" to={porcentaje} dur=".7s" fill="freeze" />
            </rect>
          </clipPath>
        </defs>
        <path d={SILUETA_ZORRO} fill="none" stroke="rgba(232,232,230,.35)" strokeWidth={4} strokeLinejoin="round" strokeLinecap="round" />
        <path d={SILUETA_ZORRO} fill="#f2f3f5" strokeLinejoin="round" clipPath={`url(#${id})`} />
      </svg>
    </div>
  );
}

/** Las flechas del cálculo de sombra, superpuestas a la foto. `viewBox`
 *  puesto a las dimensiones REALES del archivo (no 0-100): con el
 *  contenedor ya forzado al `aspect-ratio` de esa misma foto, el escalado
 *  sale uniforme en los dos ejes y el ángulo de cada flecha no se tuerce. */
function FlechasSombra({ flechas, ancho, alto }: { flechas: Flecha[]; ancho: number; alto: number }) {
  const id = useId();
  return (
    <svg viewBox={`0 0 ${ancho} ${alto}`} className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden>
      <defs>
        <marker id={id} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 Z" fill="currentColor" />
        </marker>
      </defs>
      {flechas.map((f, i) => (
        // Azul "draw" (el mismo acento de los marcadores del mapa/GPS en el
        // cliente) para el vector de sombra en vez de blanco: contra una
        // foto tan cálida (naranjas y rojos por todas partes), el blanco se
        // hundía en el ruido — un tono frío es lo único que de verdad
        // destaca aquí. El halo, además, ahora es opaco del todo y más
        // ancho, no semitransparente.
        <g key={f.etiqueta} className={f.sol ? "text-[#f2c265]" : "text-[#85b7eb]"}
          style={{ animation: `jg-rasgo-in .5s cubic-bezier(.16,1,.3,1) both ${0.35 + i * 0.16}s` }}>
          <line x1={f.x1} y1={f.y1} x2={f.x2} y2={f.y2} stroke="black" strokeWidth={ancho * 0.0026 + ancho * 0.0038}
            strokeDasharray={f.sol ? `${ancho * 0.012} ${ancho * 0.009}` : undefined} />
          <line x1={f.x1} y1={f.y1} x2={f.x2} y2={f.y2} stroke="currentColor" strokeWidth={ancho * 0.0026}
            strokeDasharray={f.sol ? `${ancho * 0.012} ${ancho * 0.009}` : undefined} markerEnd={`url(#${id})`} />
          <text x={f.x2} y={f.y2 + (f.y2 > f.y1 ? 22 : -12)} textAnchor="middle" fill="currentColor"
            stroke="black" strokeWidth={ancho * 0.003} paintOrder="stroke"
            fontSize={ancho * 0.012} fontWeight={600} fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace">
            {f.etiqueta}
          </text>
        </g>
      ))}
    </svg>
  );
}

/** El sol con rayos de colores (calcado del Lumi legacy) resultó demasiado
 *  ilustrativo para esta interfaz — Lumi no dibuja iconos de colores, dibuja
 *  datos: barras de confianza, rasgos con recuadro punteado, cifras en
 *  mono. Esto es lo mismo aplicado a "hora": una línea de 24h con un
 *  marcador en la hora estimada, mismo trato que las barras de hipótesis
 *  de al lado (pista `rgba(...,.08)`, relleno `rgba(...,.22)`, sin color). */
function LineaHoraDia({ hora }: { hora: number }) {
  const PAD = 6, ANCHO = 200 - PAD * 2;
  const x = PAD + (hora / 24) * ANCHO;
  const etiqueta = `${String(Math.floor(hora)).padStart(2, "0")}:${String(Math.round((hora % 1) * 60)).padStart(2, "0")}`;
  return (
    // Mismo trato que `MiniMapaMundo`: un `<svg>` a pelo con su propio
    // `<rect>` de fondo, sin `<div>` ni borde ni padding propios — el marco
    // ya lo pone el contenedor que lo envuelve en el panel.
    <svg viewBox="0 0 200 66" className="w-full" role="img" aria-hidden>
      <rect width={200} height={66} fill="#101216" />
      <rect x={PAD} y={34} width={ANCHO} height={3} rx={1.5} fill="rgba(232,232,230,.08)" />
      {/* Franja de luz de día (06-20h) sobre la pista — la misma idea que el
          relleno de una barra de confianza, no una ilustración del cielo. */}
      <rect x={PAD + (6 / 24) * ANCHO} y={34} width={(14 / 24) * ANCHO} height={3} rx={1.5} fill="rgba(232,232,230,.22)" />
      {[0, 6, 12, 18, 24].map((h) => (
        <text key={h} x={PAD + (h / 24) * ANCHO} y={54} textAnchor="middle" fontSize="7" fill="rgba(232,232,230,.4)"
          fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace">
          {String(h).padStart(2, "0")}
        </text>
      ))}
      {/* El marcador entra deslizándose desde el borde izquierdo (00:00)
          hasta su hora real, en vez de aparecer ya puesto — mismo curso de
          animación SMIL que ya usa `SiluetaConfianza` (`<animate fill="freeze">`),
          con la curva de easing del resto del sitio (`.16,1,.3,1`). */}
      <line x1={PAD} x2={PAD} y1={20} y2={34} stroke="#e8e8e6" strokeWidth={1.3}>
        <animate attributeName="x1" from={PAD} to={x} dur=".8s" calcMode="spline" keySplines=".16 1 .3 1" keyTimes="0;1" fill="freeze" />
        <animate attributeName="x2" from={PAD} to={x} dur=".8s" calcMode="spline" keySplines=".16 1 .3 1" keyTimes="0;1" fill="freeze" />
      </line>
      <circle cx={PAD} cy={18} r={3} fill="#e8e8e6">
        <animate attributeName="cx" from={PAD} to={x} dur=".8s" calcMode="spline" keySplines=".16 1 .3 1" keyTimes="0;1" fill="freeze" />
      </circle>
      <text x={PAD} y={10} textAnchor="middle" fontSize="8" fontWeight={600} fill="#e8e8e6"
        fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace">
        <animate attributeName="x" from={PAD} to={x} dur=".8s" calcMode="spline" keySplines=".16 1 .3 1" keyTimes="0;1" fill="freeze" />
        {etiqueta}
      </text>
    </svg>
  );
}

/** Placa real (banda EU + código + matrícula) — los datos concretos vienen
 *  de `Muestra.placa`, no están fijos aquí. */
function PlacaVehiculo({ pais, texto }: { pais: string; texto: string }) {
  return (
    <div className="inline-flex items-stretch overflow-hidden rounded-[5px] border border-black/40 shadow-[0_1px_0_rgba(255,255,255,.15)_inset]">
      <div className="flex w-6 flex-col items-center justify-center gap-[3px] bg-[#0f3f9e] pb-1.5 pt-1">
        <span className="font-mono text-[7px] leading-none text-[#ffd230]">★ ★</span>
        <span className="font-mono text-[7px] leading-none text-[#ffd230]">★ ★</span>
        <span className="font-mono text-[8px] font-bold leading-none text-white">{pais}</span>
      </div>
      <div className="flex-1 bg-gradient-to-b from-white to-[#e6e6e4] px-3 py-1.5 text-center font-mono text-[18px] font-bold tracking-[.16em] text-[#151515]">
        {texto}
      </div>
    </div>
  );
}

function TextoDetectado({ muestra }: { muestra: string }) {
  return (
    <div className="relative overflow-hidden rounded-[6px] border border-border bg-black/25 px-3 py-2.5">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-6 bg-gradient-to-b from-white/[.12] to-transparent jg-ocr-barrido" />
      <div className="font-mono text-[9px] uppercase tracking-wide text-subtle">texto detectado</div>
      <div className="mt-1 text-[16px] text-fg">{muestra}</div>
    </div>
  );
}

/** El chasis de ventana de `TitleBar.tsx`/`WindowFrame.tsx` del cliente real
 *  (misma estrella, mismo tipo de migas, mismos tres botones a la derecha),
 *  en miniatura y sin funcionar de verdad — es lo que vende "esto es la
 *  interfaz de Lumi", no una tarjeta de marketing con su propia cabecera. */
function MarcoVentanaLumi({ miga }: { miga: string }) {
  return (
    <div className="flex h-9 shrink-0 items-center gap-2.5 border-b border-border bg-[rgba(13,15,17,.92)] pl-3">
      <span className="grid h-[16px] w-[16px] shrink-0 place-items-center text-fg">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" stroke="none">
          <path d="M12 2c.7 4.4 2.7 6.4 7 7-4.3.7-6.3 2.7-7 7-.7-4.4-2.7-6.4-7-7 4.3-.7 6.3-2.7 7-7z" />
        </svg>
      </span>
      <span className="font-mono text-[10px] text-subtle">Lumi</span>
      <span className="text-[11px] text-[#3a3e44]">/</span>
      <span className="text-[11px] text-fg">{miga}</span>
      <span className="flex-1" />
      <div className="flex h-full shrink-0">
        <span className="grid h-full w-8 place-items-center text-subtle">
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth={1.1}><path d="M1 5h8" /></svg>
        </span>
        <span className="grid h-full w-8 place-items-center text-subtle">
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth={1.1}><rect x="1" y="1" width="8" height="8" rx="1" /></svg>
        </span>
        <span className="grid h-full w-8 place-items-center text-subtle">
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth={1.1}><path d="M1 1l8 8M9 1L1 9" /></svg>
        </span>
      </div>
    </div>
  );
}

/** El zoom de esta sección toma el control del scroll: un envoltorio más
 *  alto que la pantalla + `sticky` fija el panel mientras se consume ese
 *  espacio de más, y la escala sigue el progreso — al agotarse ese espacio
 *  el panel se suelta y el scroll normal continúa hacia el vídeo. */
function useProgresoDeAnclaje() {
  const trackRef = useRef<HTMLDivElement>(null);
  const [progreso, setProgreso] = useState(0);

  useEffect(() => {
    const reducido = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reducido) { setProgreso(1); return; }

    function medir() {
      const el = trackRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const total = rect.height - window.innerHeight;
      if (total <= 0) { setProgreso(1); return; }
      setProgreso(Math.min(1, Math.max(0, -rect.top / total)));
    }
    medir();
    window.addEventListener("scroll", medir, { passive: true });
    window.addEventListener("resize", medir);
    return () => {
      window.removeEventListener("scroll", medir);
      window.removeEventListener("resize", medir);
    };
  }, []);

  return { trackRef, progreso };
}

type Estado = "eligiendo" | "analizando" | "listo";

export function AgentesVisual() {
  const { ref, visible } = usarRevelado<HTMLElement>();
  const { trackRef, progreso } = useProgresoDeAnclaje();
  const [pestana, setPestana] = useState(0); // qué agente se está mirando
  const [muestraIdx, setMuestraIdx] = useState(0); // qué foto de ese agente
  const [estado, setEstado] = useState<Estado>("eligiendo"); // cada agente arranca pidiendo elegir foto
  const [resultadoId, setResultadoId] = useState(0);
  const analisisRef = useRef<number | null>(null);

  const caso = CASOS[pestana];
  const muestra = caso.muestras[muestraIdx];
  const maxPeso = Math.max(...muestra.hipotesis.map((h) => h.peso));

  useEffect(() => () => { if (analisisRef.current) window.clearTimeout(analisisRef.current); }, []);

  function cambiarPestana(i: number) {
    if (i === pestana) return;
    if (analisisRef.current) { window.clearTimeout(analisisRef.current); analisisRef.current = null; }
    setPestana(i);
    setMuestraIdx(0);
    setEstado("eligiendo");
  }

  function elegirImagen(i: number) {
    if (estado !== "eligiendo") return;
    setMuestraIdx(i);
    setEstado("analizando");
    analisisRef.current = window.setTimeout(() => {
      setEstado("listo");
      setResultadoId((n) => n + 1);
      analisisRef.current = null;
    }, 1300);
  }

  return (
    <section ref={ref} id="agentes" className="mx-auto max-w-[1640px] px-7 pb-16 pt-28">
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
        Elige una imagen: cada agente lee UN atributo y compite entre varias hipótesis, nunca una
        sola respuesta cerrada — el mismo panel que ves en el cliente, aplicado aquí a un atributo
        visual en vez de a la ubicación final.
      </p>

      {/* Envoltorio de anclaje: más alto que la pantalla a propósito, es el
          presupuesto de scroll que el `sticky` de dentro consume antes de
          soltar la sección. */}
      <div ref={trackRef} className="relative mt-10 h-[190vh]">
        <div className="sticky top-0 flex min-h-screen flex-col justify-center py-10">
          <div
            className="flex flex-wrap gap-2"
            style={visible ? { animation: "jg-reveal-up .7s cubic-bezier(.16,1,.3,1) both .14s" } : { opacity: 0 }}
          >
            {CASOS.map((c, i) => (
              <button
                key={c.id}
                type="button"
                onClick={() => cambiarPestana(i)}
                className={`jg-micro rounded-lg border px-3 py-1.5 text-[12px] transition-colors ${
                  i === pestana ? "border-fg text-fg" : "border-border text-subtle hover:text-fg"
                }`}
              >
                {c.etiqueta}
              </button>
            ))}
          </div>

          <div
            className="mt-4 overflow-hidden rounded-card border border-border bg-panel"
            style={{ transform: `scale(${0.9 + progreso * 0.1})`, transformOrigin: "center", willChange: "transform" }}
          >
            <MarcoVentanaLumi miga={estado === "eligiendo" ? "analizador / elige una imagen" : `analizador / ${caso.etiqueta}`} />

            {estado === "eligiendo" ? (
              <div key={caso.id} className="jg-fade-rise flex min-h-[60vh] flex-col items-center justify-center gap-5 p-10 text-center">
                <span className="font-mono text-[10px] uppercase tracking-wide text-subtle">selector de imágenes · {caso.etiqueta}</span>
                <div className="flex flex-wrap items-start justify-center gap-4">
                  {caso.muestras.map((m, i) => (
                    <button
                      key={m.archivo}
                      type="button"
                      onClick={() => elegirImagen(i)}
                      className="group overflow-hidden rounded-card border border-border transition-colors duration-200 hover:border-fg"
                    >
                      {/* Sin alto fijo: solo el ancho + `aspectRatio` deciden
                          el alto, así la miniatura muestra la foto entera,
                          centrada, en vez de un recorte forzado. */}
                      <img src={m.imagen} alt={m.alt} className="block w-64 object-cover transition-transform duration-300 group-hover:scale-[1.03]" style={{ aspectRatio: m.aspecto }} />
                    </button>
                  ))}
                </div>
                <p className="max-w-[38ch] text-[11.5px] text-subtle">
                  {caso.muestras.length > 1
                    ? "Elige una de las fotos de ejemplo para analizarla."
                    : "Por ahora hay una sola imagen de ejemplo para este agente — pulsa sobre ella para analizarla."}
                </p>
              </div>
            ) : (
            <div key={`${caso.id}-${muestraIdx}-${resultadoId}`} className="jg-fade-rise grid grid-cols-1 lg:items-center lg:grid-cols-[1.4fr_1fr]">
              {/* `lg:items-center`: sin esto, un grid normal ESTIRA esta
                  columna a la altura de la del lateral (que suele ser más
                  alta, con mapa e hipótesis) — y al estirarse por encima de
                  su propio `aspectRatio`, `object-cover` recorta la foto
                  por arriba/abajo para rellenar ese hueco de más. `start`
                  quitaba el recorte pero dejaba la foto pegada arriba con un
                  hueco muerto debajo — `center` la deja igual de intacta
                  pero centrada en ese hueco. */}
              <div className="relative w-full overflow-hidden rounded-[10px] bg-elevated" style={{ aspectRatio: muestra.aspecto }}>
                <img src={muestra.imagen} alt={muestra.alt} className="absolute inset-0 h-full w-full object-cover" />

                {estado === "listo" && muestra.rasgos.map((r, i) => (
                  <div
                    key={r.etiqueta}
                    className="jg-rasgo-in pointer-events-none absolute rounded-[3px] border border-dashed border-white/60"
                    style={{
                      left: `${r.x}%`, top: `${r.y}%`, width: `${r.w}%`, height: `${r.h}%`,
                      animationDelay: `${0.35 + i * 0.16}s`,
                    }}
                  >
                    <span className="absolute -top-5 left-0 rounded-[3px] bg-black/70 px-1 py-0.5 font-mono text-[8.5px] uppercase tracking-wide text-white/90">
                      {r.etiqueta}
                    </span>
                  </div>
                ))}

                {estado === "listo" && muestra.flechas && (
                  <FlechasSombra flechas={muestra.flechas} ancho={muestra.anchoPx} alto={Math.round(muestra.anchoPx / muestra.aspecto)} />
                )}

                {estado === "analizando" && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-2.5 bg-black/55">
                    <span className="h-5 w-5 animate-spin rounded-full border-2 border-white/25 border-t-white" />
                    <span className="font-mono text-[10px] uppercase tracking-wide text-white/85">analizando imagen…</span>
                  </div>
                )}
              </div>

              <div className="flex flex-col gap-4 overflow-y-auto p-7">
                {/* Mismo bloque de cabecera que `ResultsDrawer.tsx` en el
                    cliente (miniatura + nombre de fichero + modelo). */}
                <div
                  className="flex items-center gap-2.5 rounded-[9px] bg-white/[.03] p-[8px]"
                  style={{ animation: "jg-reveal-up .55s cubic-bezier(.16,1,.3,1) both .1s" }}
                >
                  <img src={muestra.imagen} alt="" className="h-9 w-11 shrink-0 rounded object-cover" />
                  <div className="min-w-0">
                    <div className="truncate font-mono text-[10.5px] text-fg">{muestra.archivo}</div>
                    <div className="mt-0.5 font-mono text-[9px] text-subtle">motor · {caso.motor}</div>
                  </div>
                </div>

                {estado === "analizando" ? (
                  <div className="flex flex-col gap-2.5">
                    {[0, 1, 2].map((i) => (
                      <div key={i} className="h-3 w-full animate-pulse rounded bg-white/[.06]" style={{ animationDelay: `${i * 0.12}s` }} />
                    ))}
                  </div>
                ) : (
                  <div style={{ animation: "jg-reveal-up .55s cubic-bezier(.16,1,.3,1) both .16s" }}>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[10px] uppercase tracking-wide text-subtle">{caso.etiqueta}</span>
                      {caso.proximamente && (
                        <span className="rounded-[5px] border border-dashed border-subtle/50 px-1.5 py-0.5 font-mono text-[9px] text-subtle">
                          v2.1 · próximamente
                        </span>
                      )}
                    </div>

                    {/* La pieza única de cada agente, con los datos de la
                        foto elegida — no un valor fijo por caso. */}
                    {muestra.placa && (
                      <div className="mt-3">
                        <PlacaVehiculo pais={muestra.placa.pais} texto={muestra.placa.texto} />
                      </div>
                    )}
                    {muestra.textoDetectado && (
                      <div className="mt-3">
                        <TextoDetectado muestra={muestra.textoDetectado} />
                      </div>
                    )}
                    {caso.id === "hora" && (
                      <div className="mt-3 flex items-center gap-3 rounded-[6px] border border-border bg-black/15 px-3 py-2">
                        <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth={1.6}
                          strokeLinecap="round" className="shrink-0 text-fg">
                          <circle cx="12" cy="12" r="4" />
                          <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.6 4.6l2.1 2.1M17.3 17.3l2.1 2.1M4.6 19.4l2.1-2.1M17.3 6.7l2.1-2.1" />
                        </svg>
                        <div className="min-w-0">
                          <div className="font-mono text-[9px] uppercase tracking-wide text-subtle">estimación</div>
                          <div className="text-[13px] text-fg">{muestra.hipotesis[0].nombre}</div>
                        </div>
                      </div>
                    )}
                    {caso.id === "especie" && (
                      <div className="mt-3 flex items-center gap-3 rounded-[6px] border border-border bg-black/15 px-3 py-2">
                        <SiluetaConfianza porcentaje={muestra.hipotesis[0].peso} />
                        <div className="min-w-0">
                          <div className="font-mono text-[9px] uppercase tracking-wide text-subtle">coincidencia</div>
                          <div className="text-[13px] italic text-fg">{muestra.hipotesis[0].nombre}</div>
                        </div>
                      </div>
                    )}

                    <div className="mt-3 flex flex-col gap-2.5">
                      {muestra.hipotesis.map((h, i) => (
                        <div
                          key={h.nombre}
                          style={{ animation: `jg-reveal-up .5s cubic-bezier(.16,1,.3,1) both ${0.22 + i * 0.05}s` }}
                        >
                          <div className="flex items-baseline justify-between gap-2">
                            <span className={`text-[13.5px] ${i === 0 ? "font-semibold text-fg" : "text-muted"}`}>
                              {h.nombre}
                              {h.detalle && <span className="ml-1.5 text-[11px] text-subtle">{h.detalle}</span>}
                            </span>
                            <span className="shrink-0 font-mono text-[11px] tabular-nums text-subtle">{h.peso}%</span>
                          </div>
                          <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-elevated">
                            <div
                              className={`h-full rounded-full jg-barra-llena ${i === 0 ? "bg-fg" : "bg-subtle/50"}`}
                              style={{ "--fin": `${(h.peso / maxPeso) * 100}%`, animationDelay: `${0.3 + i * 0.05}s` } as React.CSSProperties}
                            />
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Misma insignia que `InsigniaVerificacion` del cliente —
                        siempre en `fg`/blanco, nunca verde. */}
                    <div
                      className="mt-3.5 flex items-center gap-1.5 border-t border-border pt-3"
                      style={{ animation: "jg-reveal-up .5s cubic-bezier(.16,1,.3,1) both .42s" }}
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
                        strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-fg">
                        <path d="M20 6 9 17l-5-5" />
                      </svg>
                      <span className="text-[10.5px] text-fg">verificado por {caso.motor}</span>
                    </div>
                  </div>
                )}

                <div
                  className="mt-auto overflow-hidden rounded-[8px] border border-border"
                  style={{ animation: "jg-reveal-up .55s cubic-bezier(.16,1,.3,1) both .48s" }}
                >
                  {muestra.hora !== undefined ? <LineaHoraDia hora={muestra.hora} /> : <MiniMapaMundo puntos={muestra.puntos ?? []} />}
                </div>
              </div>
            </div>
            )}
          </div>

          <p className="mt-3 text-center font-mono text-[10px] text-subtle">
            *Not actual app footage — mockup for illustration only.
          </p>
        </div>
      </div>
    </section>
  );
}
