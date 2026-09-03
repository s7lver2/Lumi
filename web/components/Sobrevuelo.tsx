"use client";
import { useEffect, useRef, useState } from "react";
import { usarEscenaViva } from "./usarEscenaViva";

/** El sobrevuelo de la interfaz: una maqueta de la UI de Lumi asoma tumbada
 *  en el horizonte, sobrevuela el terreno a velocidad constante, se levanta
 *  hasta quedar de plano y legible, y luego —fase nueva— salta entre cuatro
 *  pantallas distintas de la interfaz alternando de lado (derecha,
 *  izquierda, derecha…) en vez de barrer siempre en la misma dirección,
 *  mientras el texto de cada una ocupa el hueco de scroll que le corresponde.
 *  Reemplaza a la "ventana viva" del concepto — spec §7. Los parámetros
 *  están medidos con una maqueta interactiva, no estimados: no se tocan
 *  sin recalcular.
 *
 *  Cuatro trampas geométricas (spec §7 / plan Task 5) — siguen aplicando
 *  tal cual a la fase nueva, que solo añade una traslación X sobre la
 *  pieza ya plana, nunca una rotación:
 *  1. El suelo lleva la máscara del horizonte; la ventana cuelga del
 *     carril, un plano hermano SIN máscara — si colgara del suelo, la
 *     máscara se la comería antes de que llegara a verse.
 *  2. La cámara solo hace translateX. Nunca rotateZ: ladea la UI y se
 *     nota en cuanto la ventana acaba de frente.
 *  3. Ningún ancestro 3D lleva will-change — anularía el preserve-3d de
 *     sus hijos y la contrarrotación dejaría de aplicarse.
 *  4. El despegue final es de solo 26px en translateZ: a 75° eso ya
 *     equivale a subir casi lo mismo en pantalla.
 */

const TUMBE = 75;
const DESDE = 830; // sigue fuera de campo en scroll=0, pero el tramo vacío antes de asomar es más corto que el original 980, no cero
const HASTA = -355; // centra la ventana por geometría: 92 + Y·cos75° ≈ 0
const FIN_VUELO = 0.46; // hasta aquí el viaje termina de llegar a HASTA
const INICIO_ALZA = 0.28; // el alzamiento empieza a mezclarse ANTES de que el viaje acabe — las dos cosas a la vez, no una detrás de otra
const FIN_LEVANTAMIENTO = 0.58;
const RECORRIDO_PX = 15400; // fase A+B como antes, más recorrido para la fase C: más scroll por salto, menos sensación de caos

function easeOutCubic(x: number) {
  return 1 - Math.pow(1 - x, 3);
}
function easeInOutCubic(x: number) {
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

type Pintura = {
  y: number; alza: number; rot: number; opSombra: number; opSuelo: number; deriva: number;
  fase: "vuelo" | "levantamiento" | "showcase";
  indiceFloat: number; // posición continua dentro de PANTALLAS durante la fase C
  offsetX: number; // desplazamiento horizontal de la ventana, fase C — llega casi al borde
  giroY: number; // grados de rotateY durante el salto: la ventana "mira" hacia donde viaja
};

function pintar(p: number): Pintura {
  if (p < FIN_LEVANTAMIENTO) {
    // El viaje (y) y el alzamiento (alza/rot) ya no son dos tramos
    // secuenciales con un corte seco en FIN_VUELO: el alzamiento arranca en
    // INICIO_ALZA, todavía dentro del tramo de vuelo, así que en el hueco
    // [INICIO_ALZA, FIN_VUELO] las dos cosas ocurren a la vez y se funden.
    const vLineal = Math.min(1, p / FIN_VUELO);
    const vCurva = easeInOutCubic(vLineal); // curva de velocidad, no un vuelo a ritmo constante
    const y = DESDE + (HASTA - DESDE) * vCurva;

    const vAlza = Math.max(0, Math.min(1, (p - INICIO_ALZA) / (FIN_LEVANTAMIENTO - INICIO_ALZA)));
    const s = easeOutCubic(vAlza);

    return {
      y,
      alza: 26 * s, // simbólico — ver trampa 4
      rot: -TUMBE * s, // contrarrota el tumbe → de frente
      opSombra: Math.min(1, vCurva * 3) * (1 - s),
      opSuelo: 1 - s * 0.85,
      deriva: Math.sin(vCurva * Math.PI) * 26,
      fase: p < FIN_VUELO ? "vuelo" : "levantamiento", indiceFloat: 0, offsetX: 0, giroY: 0,
    };
  }
  // Fase C: la pieza ya está plana (s=1 fijo) y ahora salta de parada en
  // parada, casi hasta el borde del encuadre, con una curva de
  // aceleración/frenado por tramo — no un mapeo 1:1 del scroll a la
  // posición horizontal.
  const u = Math.max(0, Math.min(1, (p - FIN_LEVANTAMIENTO) / (1 - FIN_LEVANTAMIENTO)));
  const N = PANTALLAS.length;
  const indiceFloat = u * (N - 1);
  const tramo = Math.min(N - 2, Math.floor(indiceFloat));
  const frac = indiceFloat - tramo;
  const fracSuave = easeInOutCubic(frac);
  const ANCHO_TRAMO = 640; // px de salto por parada — prácticamente al borde del encuadre
  // Salto alterno: cada pantalla nueva entra desde el lado contrario a la
  // anterior (derecha, izquierda, derecha…) en vez de un barrido monótono
  // en una sola dirección — se siente como hojear pestañas, no como una
  // cinta transportadora.
  const posiciones = [0];
  for (let i = 1; i < N; i++) posiciones.push(posiciones[i - 1] + (i % 2 === 1 ? -1 : 1) * ANCHO_TRAMO);
  const centro = posiciones.reduce((a, b) => a + b, 0) / N;
  const offsetX = posiciones[tramo] + (posiciones[tramo + 1] - posiciones[tramo]) * fracSuave - centro;
  // giroY: durante el salto la ventana gira levemente hacia el lado al que
  // viaja (perspectiva jugando con el ángulo) y vuelve a quedar de frente
  // en cuanto se asienta en la parada — nunca rotateZ (trampa 2), esto es
  // un rotateY sobre la propia pieza, no sobre la cámara.
  const direccionTramo = Math.sign(posiciones[tramo + 1] - posiciones[tramo]) || 1;
  const giroY = direccionTramo * Math.sin(fracSuave * Math.PI) * 9; // menos giro que antes (16°) — se sentía caótico
  return {
    // opSuelo en 0, no 0.15: en el showcase la mirada está en la interfaz,
    // no en el terreno — el suelo no aporta nada aquí, y apagarlo del todo
    // (en vez de dejarlo asomar tenue) descarta también cualquier resto de
    // la costura diagonal que seguía viniendo de ese plano.
    y: HASTA, alza: 26, rot: -TUMBE, opSombra: 0, opSuelo: 0, deriva: 0,
    fase: "showcase", indiceFloat, offsetX, giroY,
  };
}

// Las cuatro pantallas del showcase — mismo guion que antes vivía solo en
// el texto de esquina, ahora también gobierna qué se ve dentro de la
// ventana. Para sustituir un mockup ilustrado por una captura real: añade
// src: "/ruta.png" aquí y PantallaContenido la usa en vez del mockup.
//
// `zoom` es opcional: cuando existe, es TODA la ventana (marco incluido) la
// que se acerca sobre ese punto (origen en % del propio recuadro) al quedar
// centrada, y se aleja al salir — no es un recorte de la captura, es la
// pieza entera resaltando su propio detalle.
const PANTALLAS: {
  n: string; etiqueta: string; t: string; d: string; src?: string;
  zoom?: { escala: number; origen: string };
}[] = [
  {
    n: "01", etiqueta: "proyectos",
    t: "Tus proyectos, siempre a mano",
    d: "Cada investigación es un espacio propio: imágenes, casos y análisis anteriores, exactamente donde los dejaste.",
    zoom: { escala: 1.16, origen: "24% 46%" }, // se acerca a la lista de proyectos
  },
  {
    n: "02", etiqueta: "análisis",
    t: "El análisis, no una cola",
    d: "Cada imagen se enfrenta a varios verificadores geométricos a la vez — gana quien se acerque más al punto real, no un modelo único.",
    zoom: { escala: 1.16, origen: "78% 50%" }, // se acerca al panel de verificadores
  },
  {
    n: "03", etiqueta: "resultado",
    t: "La sección de resultado, tal cual",
    d: "Cada hipótesis lista los verificadores que compitieron y su distancia entre sí, anclada sobre el terreno con el radio de confianza real.",
    zoom: { escala: 1.32, origen: "68% 50%" }, // se acerca al mapa y su marcador
  },
  {
    n: "04", etiqueta: "administración",
    t: "Control total del servidor",
    d: "Modelos, GPUs y usuarios, gestionados desde el mismo cliente — nunca desde un panel de terceros.",
    zoom: { escala: 1.24, origen: "50% 82%" }, // se acerca a la carga de GPU
  },
];

export function Sobrevuelo() {
  const seccionRef = useRef<HTMLElement>(null);
  const { viva, reducido } = usarEscenaViva(seccionRef as React.RefObject<HTMLElement>);
  const [movil, setMovil] = useState(false);
  const [pintura, setPintura] = useState<Pintura>(() => pintar(0));

  const objetivoRef = useRef(0);
  const suaveRef = useRef(0);
  const corriendoRef = useRef(false);
  // Espejo en refs de viva/reducido/movil: el listener de scroll se registra
  // una sola vez y no puede quedarse con un closure obsoleto de estos tres
  // valores, o deja de reaccionar en cuanto cualquiera cambia tras montar.
  const vivaRef = useRef(viva);
  const reducidoRef = useRef(reducido);
  const movilRef = useRef(movil);
  vivaRef.current = viva;
  reducidoRef.current = reducido;
  movilRef.current = movil;

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const sinc = () => setMovil(mq.matches);
    sinc();
    mq.addEventListener("change", sinc);
    return () => mq.removeEventListener("change", sinc);
  }, []);

  // Progreso 0..1 leído del scroll dentro de la propia sección — no del
  // documento entero. En móvil no se secuestra el scroll: la escena queda
  // fija en su fotograma final.
  useEffect(() => {
    function medir() {
      if (movilRef.current) return;
      const el = seccionRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const total = rect.height - window.innerHeight;
      const recorrido = total > 0 ? Math.max(0, Math.min(1, -rect.top / total)) : 0;
      objetivoRef.current = recorrido;
      arrancar();
    }
    medir();
    window.addEventListener("scroll", medir, { passive: true });
    window.addEventListener("resize", medir);
    return () => {
      window.removeEventListener("scroll", medir);
      window.removeEventListener("resize", medir);
    };
  }, []);

  function arrancar() {
    if (movilRef.current) return;
    if (reducidoRef.current) {
      // Sin amortiguación: el valor pintado salta directo al del scroll.
      suaveRef.current = objetivoRef.current;
      setPintura(pintar(suaveRef.current));
      return;
    }
    if (corriendoRef.current || !vivaRef.current) return;
    corriendoRef.current = true;
    requestAnimationFrame(bucle);
  }

  function bucle() {
    const d = objetivoRef.current - suaveRef.current;
    if (Math.abs(d) < 0.00025) {
      suaveRef.current = objetivoRef.current;
      setPintura(pintar(suaveRef.current));
      corriendoRef.current = false;
      return;
    }
    suaveRef.current += d * 0.062;
    setPintura(pintar(suaveRef.current));
    if (!vivaRef.current) { corriendoRef.current = false; return; }
    requestAnimationFrame(bucle);
  }

  useEffect(() => {
    if (viva && !movil) arrancar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viva, movil]);

  const { y, alza, rot, opSombra, opSuelo, deriva, fase, indiceFloat, offsetX, giroY } = movil ? pintar(1) : pintura;

  const idxCercano = Math.max(0, Math.min(PANTALLAS.length - 1, Math.round(indiceFloat)));
  const opacidadTexto = fase === "showcase" ? 1 - Math.min(1, Math.abs(indiceFloat - idxCercano) * 2.4) : 0;
  const pantallaTexto = PANTALLAS[idxCercano];
  // El zoom es de TODA la ventana, no de la captura interior: cuando una
  // pantalla con `zoom` queda centrada, el marco entero se acerca sobre su
  // punto de interés y se aleja de nuevo al abandonarla. 0.95 en vez de
  // 1.15: el cruce entre pantallas dura más scroll, se siente menos brusco.
  const enfoqueActivo = Math.max(0, 1 - Math.min(1, Math.abs(indiceFloat - idxCercano) * 0.95));
  const zoomActivo = pantallaTexto.zoom;
  const escalaZoomVentana = zoomActivo ? 1 + (zoomActivo.escala - 1) * enfoqueActivo : 1;

  return (
    <section
      ref={seccionRef}
      id="interfaz"
      className="relative"
      style={{ height: movil ? undefined : `calc(100vh + ${RECORRIDO_PX}px)` }}
    >
      <div className={movil ? "relative py-16" : "sticky top-0 h-screen overflow-hidden"}>
        {movil ? (
          <div className="mx-auto max-w-[720px] px-7 text-center">
            <span className="font-mono text-[11px] uppercase tracking-wide text-subtle">meet lumi</span>
            <h2 className="mt-2 text-[clamp(24px,3.4vw,36px)] font-semibold tracking-tight">
              La misma interfaz, sin importar el modelo
            </h2>
          </div>
        ) : (
          <div className="pointer-events-none absolute left-0 right-0 top-16 z-10 mx-auto max-w-[720px] px-7 text-center">
            <span className="font-mono text-[11px] uppercase tracking-wide text-subtle">meet lumi</span>
            <h2 className="mt-2 text-[clamp(24px,3.4vw,36px)] font-semibold tracking-tight">
              La misma interfaz, sin importar el modelo
            </h2>
          </div>
        )}

        {!movil && (
          <>
            {/* El texto salta de lado contrario a la ventana (ver PANTALLAS
                impares/pares en offsetX): cuando la ventana salta a la
                derecha el texto se funde a la izquierda, y viceversa — las
                dos cosas se mueven, no solo la ventana. */}
            <TextoPantalla pantalla={pantallaTexto} lado="izquierda" opacidad={idxCercano % 2 === 0 ? opacidadTexto : 0} />
            <TextoPantalla pantalla={pantallaTexto} lado="derecha" opacidad={idxCercano % 2 === 1 ? opacidadTexto : 0} />
            <PuntosProgreso total={PANTALLAS.length} idx={idxCercano} opacidad={fase === "showcase" ? 1 : 0} />
          </>
        )}

        <div
          className={movil ? "preserva-3d sin-perspectiva-origen relative mt-10 h-[340px]" : "preserva-3d sin-perspectiva-origen absolute inset-0"}
          style={{ perspective: 820 }}
        >
          {/* .camara — solo translateX. Nunca rotateZ (trampa 2). */}
          <div className="preserva-3d absolute inset-0" style={{ transform: `translateX(${deriva}px)` }}>
            {/* .suelo — lleva la máscara del horizonte (trampa 1). Sin
                cuadrícula: solo un plano tenue que se desvanece hacia el
                horizonte con la misma máscara radial de antes.
                El div es mucho más grande que el viewport (inset -60%) y la
                máscara usa píxeles fijos, no porcentaje de su propia caja:
                así el borde recto del rectángulo transformado en 3D —la
                costura que se veía como líneas diagonales— queda muy fuera
                del frustum de la cámara, en vez de solo intentar que se
                desvanezca justo a tiempo. */}
            <div
              className="absolute"
              style={{
                inset: "-60%",
                transform: "translateY(92px) rotateX(75deg)",
                transformOrigin: "50% 50%",
                background: "rgba(232,232,230,.035)",
                maskImage: "radial-gradient(900px 460px at 50% 50%, black 0%, black 35%, transparent 62%)",
                WebkitMaskImage: "radial-gradient(900px 460px at 50% 50%, black 0%, black 35%, transparent 62%)",
                opacity: opSuelo,
                backfaceVisibility: "hidden",
                WebkitBackfaceVisibility: "hidden",
              }}
            />

            {/* .carril — mismo plano que el suelo, SIN máscara: aquí cuelga la ventana.
                backface-visibility: hidden también aquí — es una de las dos placas
                giradas 75° que se solapan con la ventana, y sin esto el navegador
                puede dejar un resto de la cara trasera del plano visible como una
                línea fina donde se cruza con el borde de la ventana. */}
            <div
              className="preserva-3d absolute inset-0"
              style={{
                transform: "translateY(92px) rotateX(75deg)",
                transformOrigin: "50% 50%",
                backfaceVisibility: "hidden",
                WebkitBackfaceVisibility: "hidden",
              }}
            >
              {/* .pieza */}
              <div
                className="preserva-3d absolute left-1/2 top-1/2"
                style={{ transform: `translate(-50%,-50%) translateY(${y}px) translateZ(${alza}px)` }}
              >
                {/* .sombra — se queda tumbada, no entra en .giro */}
                <div
                  className="absolute left-1/2 top-1/2 h-[90px] w-[980px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-black blur-2xl"
                  style={{ opacity: opSombra * 0.55 }}
                />
                {/* .giro — contrarrota el tumbe */}
                <div className="preserva-3d" style={{ transform: `rotateX(${rot}deg)`, transformOrigin: "50% 50%" }}>
                  {/* Fase C: la ventana entera —marco incluido— salta en X,
                      gira levemente hacia donde viaja (giroY, nunca
                      rotateZ) y se acerca como un todo sobre la pantalla
                      que resalta (escalaZoomVentana). Sigue siendo
                      preserve-3d dentro de .giro, así que no reabre
                      ninguna de las cuatro trampas. */}
                  <div
                    className="preserva-3d"
                    style={{
                      transform: `translateX(${offsetX}px) rotateY(${giroY}deg) scale(${(1 + (alza / 26) * 0.24) * escalaZoomVentana})`,
                      transformOrigin: zoomActivo?.origen ?? "50% 50%",
                    }}
                  >
                    <div className="relative w-[1180px] max-w-[94vw] overflow-hidden rounded-card border border-border bg-panel shadow-2xl">
                      <BarraVentana />
                      <div className="relative h-[560px]">
                        {PANTALLAS.map((pn, i) => (
                          <div
                            key={pn.n}
                            className="absolute inset-0"
                            style={{
                              opacity: Math.max(0, 1 - Math.min(1, Math.abs(indiceFloat - i) * 0.95)),
                              pointerEvents: i === idxCercano ? "auto" : "none",
                            }}
                          >
                            <PantallaContenido indice={i} src={pn.src} />
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-bg to-transparent" />
      </div>
    </section>
  );
}

/** Puntos de progreso de la fase C, fijos abajo del todo — separados del
 *  texto a propósito: pegados a él (como antes) el propio texto los tapaba
 *  y quedaban invisibles. Aquí no compiten con nada más. */
function PuntosProgreso({ total, idx, opacidad }: { total: number; idx: number; opacidad: number }) {
  return (
    <div
      className="pointer-events-none absolute inset-x-0 bottom-9 z-10 flex justify-center gap-1.5"
      style={{ opacity: opacidad, transition: "opacity .2s linear" }}
    >
      {Array.from({ length: total }).map((_, i) => (
        <span
          key={i}
          className={i === idx ? "h-[3px] w-6 rounded-full bg-fg transition-all duration-300" : "h-[3px] w-3 rounded-full bg-subtle/50 transition-all duration-300"}
        />
      ))}
    </div>
  );
}

/** El texto de una pantalla del showcase, en uno de los dos lados fijos
 *  (izquierda/derecha) — el que está activo se funde in, el otro a 0. Es
 *  el elemento con más protagonismo de la fase C, no un rótulo de esquina:
 *  etiqueta + título grande + descripción. Los puntos de progreso viven
 *  aparte, abajo del todo (`PuntosProgreso`) — pegados al texto quedaban
 *  tapados por él. */
function TextoPantalla({
  pantalla, lado, opacidad,
}: {
  pantalla: (typeof PANTALLAS)[number]; lado: "izquierda" | "derecha"; opacidad: number;
}) {
  const derecha = lado === "derecha";
  return (
    <div
      className={`pointer-events-none absolute top-1/2 z-10 max-w-[400px] -translate-y-1/2 ${
        derecha ? "right-8 text-right" : "left-8 text-left"
      }`}
      style={{ opacity: opacidad, transition: "opacity .16s linear" }}
    >
      <div className="flex items-center gap-2 font-mono text-[11.5px] uppercase tracking-wide text-subtle" style={{ justifyContent: derecha ? "flex-end" : "flex-start" }}>
        <span>{pantalla.n} / 04</span>
        <span className="text-subtle/50">·</span>
        <span>{pantalla.etiqueta}</span>
      </div>
      <h3 className="mt-3 text-[34px] font-semibold leading-[1.08] tracking-tight">{pantalla.t}</h3>
      <p className="mt-4 text-[15px] leading-relaxed text-muted">{pantalla.d}</p>
    </div>
  );
}

const MINIATURAS: { estado: "resuelta" | "curso" | "cola" }[] = [
  { estado: "resuelta" }, { estado: "resuelta" }, { estado: "curso" }, { estado: "cola" },
  { estado: "resuelta" }, { estado: "cola" }, { estado: "curso" }, { estado: "cola" },
];

/** Barra de título común a las cuatro pantallas — el mismo chasis de
 *  ventana que ya existía, ahora compartido en vez de ir pegado a un solo
 *  mockup. */
function BarraVentana() {
  return (
    <div className="flex items-center gap-2.5 border-b border-border bg-elevated px-3.5 py-2">
      <span className="h-2.5 w-2.5 rounded-full" style={{ background: "#e88f8f" }} />
      <span className="h-2.5 w-2.5 rounded-full" style={{ background: "#efb968" }} />
      <span className="h-2.5 w-2.5 rounded-full" style={{ background: "#85b7eb" }} />
      <span className="ml-2 flex items-center gap-1.5 font-mono text-[11px] text-subtle">
        <span className="text-accent">✦</span> costa norte / lote 04
      </span>
    </div>
  );
}

/** Contenido de cada una de las cuatro pantallas del showcase. Cuando
 *  `src` existe (una captura real ya sustituida), se muestra la imagen en
 *  vez del mockup ilustrado — cambio de una línea en el array PANTALLAS,
 *  no de estructura. */
function PantallaContenido({ indice, src }: { indice: number; src?: string }) {
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt="" className="h-full w-full object-cover" />;
  }
  switch (indice) {
    case 0:
      return <PantallaProyectos />;
    case 1:
      return <PantallaAnalisis />;
    case 2:
      return <PantallaResultado />;
    default:
      return <PantallaControl />;
  }
}

/** 01 — tus proyectos, siempre a mano: el sidebar de proyectos junto al
 *  mapa de trabajo, el estado "de base" de la interfaz. */
function PantallaProyectos() {
  return (
    <div className="flex h-full">
      <div className="w-[190px] shrink-0 border-r border-border bg-surface p-3">
        <div className="font-mono text-[10px] uppercase tracking-wide text-subtle">proyectos</div>
        <div className="mt-2 flex flex-col gap-1 text-[12.5px]">
          <div className="rounded-[6px] bg-elevated px-2 py-1.5 text-fg">costa norte</div>
          <div className="rounded-[6px] px-2 py-1.5 text-muted">frontera este</div>
          <div className="rounded-[6px] px-2 py-1.5 text-muted">puerto viejo</div>
        </div>
      </div>
      <div className="flex flex-1 flex-col">
        <div className="relative flex-1 border-b border-border bg-[#101216]">
          <div className="absolute left-[38%] top-[46%] h-16 w-16 -translate-x-1/2 -translate-y-1/2 rounded-full border border-draw" style={{ boxShadow: "0 0 0 6px rgba(55,138,221,.12)" }} />
          <div className="absolute left-[38%] top-[46%] h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-draw-fg" />
        </div>
        <div className="flex gap-1.5 p-2.5">
          {MINIATURAS.slice(0, 8).map((m, i) => (
            <div key={i} className="relative h-10 flex-1 rounded-[6px] border border-border bg-elevated">
              <span
                className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full"
                style={{ background: m.estado === "resuelta" ? "#f2f3f5" : m.estado === "curso" ? "#efb968" : "#6a6c70" }}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const VERIFICADORES: { nombre: string; estado: "resuelta" | "curso" | "cola"; puntuacion?: string }[] = [
  { nombre: "geometría del horizonte", estado: "resuelta", puntuacion: "0.94" },
  { nombre: "sombras y acimut solar", estado: "curso" },
  { nombre: "vegetación y clima", estado: "cola" },
  { nombre: "señalética y tipografía", estado: "cola" },
];

/** 02 — el análisis, no una cola: la imagen en curso de verificación con
 *  sus puntos candidatos, y el panel de verificadores que compiten por
 *  ella — no una fila de miniaturas esperando turno. */
function PantallaAnalisis() {
  return (
    <div className="flex h-full">
      <div className="relative flex-1 border-r border-border bg-[#101216]">
        <div className="absolute inset-6 rounded-card border border-dashed border-border/60" />
        <div className="absolute left-[42%] top-[38%] h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-draw-fg" />
        <div className="absolute left-[58%] top-[52%] h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-draw-fg" />
        <div className="absolute left-[47%] top-[63%] h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-draw-fg" />
      </div>
      <div className="w-[230px] shrink-0 bg-surface p-3.5">
        <div className="font-mono text-[10px] uppercase tracking-wide text-subtle">verificadores</div>
        <div className="mt-2.5 flex flex-col gap-2">
          {VERIFICADORES.map((v) => (
            <div key={v.nombre} className="rounded-card border border-border bg-elevated px-2.5 py-2">
              <div className="text-[11.5px] text-fg">{v.nombre}</div>
              <div className="mt-1 flex items-center gap-1.5">
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ background: v.estado === "resuelta" ? "#f2f3f5" : v.estado === "curso" ? "#efb968" : "#6a6c70" }}
                />
                <span className="font-mono text-[9.5px] text-subtle">
                  {v.estado === "resuelta" ? v.puntuacion : v.estado === "curso" ? "en curso" : "en cola"}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const HIPOTESIS: { nombre: string; distancia: string }[] = [
  { nombre: "geometría del horizonte", distancia: "140 m" },
  { nombre: "sombras y acimut solar", distancia: "310 m" },
  { nombre: "vegetación y clima", distancia: "890 m" },
];

/** 03 — la sección de resultado tal cual: el panel con las hipótesis de
 *  cada verificador y su distancia entre sí, junto al mapa con el
 *  marcador anclado — no un mapa a pantalla completa sin más contexto. */
function PantallaResultado() {
  return (
    <div className="flex h-full">
      <div className="w-[220px] shrink-0 border-r border-border bg-surface p-3.5">
        <div className="font-mono text-[10px] uppercase tracking-wide text-subtle">resultado</div>
        <div className="mt-2 text-[12.5px] text-fg">43.3714° N · 8.4127° W</div>
        <div className="mt-1 font-mono text-[10px] text-subtle">radio ~ ejemplo, no medido</div>
        <div className="mt-3 flex flex-col gap-1.5">
          {HIPOTESIS.map((h) => (
            <div key={h.nombre} className="flex items-center justify-between rounded-[6px] bg-elevated px-2 py-1.5">
              <span className="text-[11px] text-muted">{h.nombre}</span>
              <span className="font-mono text-[10px] text-subtle">{h.distancia}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="relative flex-1 bg-[#101216]">
        <div
          className="absolute inset-0 opacity-40"
          style={{
            backgroundImage:
              "linear-gradient(rgba(232,232,230,.06) 1px, transparent 1px), linear-gradient(90deg, rgba(232,232,230,.06) 1px, transparent 1px)",
            backgroundSize: "28px 28px",
          }}
        />
        <div className="absolute left-1/2 top-1/2 h-24 w-24 -translate-x-1/2 -translate-y-1/2 rounded-full border border-draw" style={{ boxShadow: "0 0 0 8px rgba(55,138,221,.12)" }} />
        <div className="absolute left-1/2 top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-draw-fg" />
      </div>
    </div>
  );
}

/** 04 — control total del servidor: un panel de administración con
 *  modelos y GPUs, no un cuadro de mando genérico. */
function PantallaControl() {
  return (
    <div className="flex h-full flex-col bg-surface p-4">
      <div className="font-mono text-[10px] uppercase tracking-wide text-subtle">servidor</div>
      <div className="mt-3 grid grid-cols-3 gap-2.5">
        {["Lumi Mini", "Lumi Pro", "Lumi Vision"].map((n) => (
          <div key={n} className="rounded-card border border-border bg-elevated p-3">
            <div className="text-[12.5px] text-fg">{n}</div>
            <div className="mt-1.5 font-mono text-[10.5px] text-subtle">instalado</div>
          </div>
        ))}
      </div>
      <div className="mt-3 flex-1 rounded-card border border-border bg-elevated p-3">
        <div className="font-mono text-[10px] uppercase tracking-wide text-subtle">gpu</div>
        <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-panel">
          <div className="h-full w-[62%] bg-fg" />
        </div>
        <div className="mt-1.5 font-mono text-[10.5px] text-subtle">carga en uso — pendiente de medir</div>
      </div>
    </div>
  );
}
