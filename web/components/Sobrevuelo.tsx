"use client";
import { useEffect, useRef, useState } from "react";
import { usarEscenaViva } from "./usarEscenaViva";

/** El sobrevuelo de la interfaz: una maqueta de la UI de Lumi asoma tumbada
 *  en el horizonte, sobrevuela el terreno a velocidad constante y se
 *  levanta hasta quedar de plano y legible. Reemplaza a la "ventana viva"
 *  del concepto — spec §7. Los parámetros están medidos con una maqueta
 *  interactiva, no estimados: no se tocan sin recalcular.
 *
 *  Cuatro trampas geométricas (spec §7 / plan Task 5):
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
const DESDE = 420;
const HASTA = -355; // centra la ventana por geometría: 92 + Y·cos75° ≈ 0
const FIN_VIAJE = 0.66;
const RECORRIDO_PX = 5200;

type Pintura = { y: number; alza: number; rot: number; opSombra: number; opSuelo: number; deriva: number };

function pintar(p: number): Pintura {
  if (p < FIN_VIAJE) {
    const v = p / FIN_VIAJE; // velocidad constante: es un vuelo, no una frenada
    const y = DESDE + (HASTA - DESDE) * v;
    return { y, alza: 0, rot: 0, opSombra: Math.min(1, v * 3), opSuelo: 1, deriva: Math.sin(v * Math.PI) * 26 };
  }
  const s = 1 - Math.pow(1 - (p - FIN_VIAJE) / (1 - FIN_VIAJE), 3); // ease-out
  return {
    y: HASTA,
    alza: 26 * s, // simbólico — ver trampa 4
    rot: -TUMBE * s, // contrarrota el tumbe → de frente
    opSombra: 1 - s,
    opSuelo: 1 - s * 0.85,
    deriva: 0,
  };
}

const PASOS = [
  { n: "01", t: "Tus proyectos, siempre a mano", d: "Cada investigación es un espacio propio: imágenes, casos y análisis anteriores, exactamente donde los dejaste." },
  { n: "02", t: "El análisis avanza a la vista", d: "Cada miniatura muestra en qué punto está su verificación — en cola, en curso o resuelta." },
  { n: "03", t: "El mapa, no un cuadro de texto", d: "El resultado se ancla sobre el terreno, con el radio de confianza real del verificador que lo resolvió." },
  { n: "04", t: "Control total del servidor", d: "Modelos, GPUs y usuarios, gestionados desde el mismo cliente — nunca desde un panel de terceros." },
];

export function Sobrevuelo() {
  const seccionRef = useRef<HTMLElement>(null);
  const { viva, reducido } = usarEscenaViva(seccionRef as React.RefObject<HTMLElement>);
  const [movil, setMovil] = useState(false);
  const [pintura, setPintura] = useState<Pintura>(() => pintar(0));
  const [paso, setPaso] = useState(0);

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
      setPaso(Math.min(PASOS.length - 1, Math.floor(recorrido * PASOS.length)));
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

  const { y, alza, rot, opSombra, opSuelo, deriva } = movil ? pintar(1) : pintura;

  return (
    <section
      ref={seccionRef}
      id="interfaz"
      className="relative"
      style={{ height: movil ? undefined : `calc(100vh + ${RECORRIDO_PX}px)` }}
    >
      <div className={movil ? "relative py-24" : "sticky top-0 h-screen overflow-hidden"}>
        <div className="pointer-events-none absolute left-0 right-0 top-16 z-10 mx-auto max-w-[720px] px-7 text-center">
          <span className="font-mono text-[11px] uppercase tracking-wide text-subtle">meet lumi</span>
          <h2 className="mt-2 text-[clamp(24px,3.4vw,36px)] font-semibold tracking-tight">
            La misma interfaz, sin importar el modelo
          </h2>
        </div>

        {!movil && (
          <div className="pointer-events-none absolute left-7 top-1/2 z-10 max-w-[300px] -translate-y-1/2">
            <div className="font-mono text-[11px] text-subtle">{PASOS[paso].n}</div>
            <h3 className="mt-1 text-[19px] font-semibold">{PASOS[paso].t}</h3>
            <p className="mt-2 leading-relaxed text-muted">{PASOS[paso].d}</p>
          </div>
        )}

        <div
          className="preserva-3d sin-perspectiva-origen absolute inset-0"
          style={{ perspective: 820 }}
        >
          {/* .camara — solo translateX. Nunca rotateZ (trampa 2). */}
          <div className="preserva-3d absolute inset-0" style={{ transform: `translateX(${deriva}px)` }}>
            {/* .suelo — lleva la máscara del horizonte (trampa 1) */}
            <div
              className="absolute inset-0"
              style={{
                transform: "translateY(92px) rotateX(75deg)",
                transformOrigin: "50% 50%",
                backgroundImage:
                  "repeating-linear-gradient(0deg, rgba(232,232,230,.05) 0 1px, transparent 1px 64px)," +
                  "repeating-linear-gradient(90deg, rgba(232,232,230,.05) 0 1px, transparent 1px 64px)",
                maskImage: "radial-gradient(60% 50% at 50% 50%, black 0%, black 55%, transparent 85%)",
                WebkitMaskImage: "radial-gradient(60% 50% at 50% 50%, black 0%, black 55%, transparent 85%)",
                opacity: opSuelo,
              }}
            />

            {/* .carril — mismo plano que el suelo, SIN máscara: aquí cuelga la ventana */}
            <div
              className="preserva-3d absolute inset-0"
              style={{ transform: "translateY(92px) rotateX(75deg)", transformOrigin: "50% 50%" }}
            >
              {/* .pieza */}
              <div
                className="preserva-3d absolute left-1/2 top-1/2"
                style={{ transform: `translate(-50%,-50%) translateY(${y}px) translateZ(${alza}px)` }}
              >
                {/* .sombra — se queda tumbada, no entra en .giro */}
                <div
                  className="absolute left-1/2 top-1/2 h-[80px] w-[820px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-black blur-2xl"
                  style={{ opacity: opSombra * 0.55 }}
                />
                {/* .giro — contrarrota el tumbe */}
                <div className="preserva-3d" style={{ transform: `rotateX(${rot}deg)`, transformOrigin: "50% 50%" }}>
                  <VentanaMaqueta />
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

const MINIATURAS: { estado: "resuelta" | "curso" | "cola" }[] = [
  { estado: "resuelta" }, { estado: "resuelta" }, { estado: "curso" }, { estado: "cola" },
  { estado: "resuelta" }, { estado: "cola" }, { estado: "curso" }, { estado: "cola" },
];

function VentanaMaqueta() {
  return (
    <div className="w-[860px] max-w-[86vw] overflow-hidden rounded-card border border-border bg-panel shadow-2xl">
      <div className="flex items-center gap-2.5 border-b border-border bg-elevated px-3.5 py-2">
        <span className="h-2.5 w-2.5 rounded-full" style={{ background: "#e88f8f" }} />
        <span className="h-2.5 w-2.5 rounded-full" style={{ background: "#efb968" }} />
        <span className="h-2.5 w-2.5 rounded-full" style={{ background: "#85b7eb" }} />
        <span className="ml-2 flex items-center gap-1.5 font-mono text-[11px] text-subtle">
          <span className="text-accent">✦</span> costa norte / lote 04
        </span>
      </div>
      <div className="flex h-[460px]">
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
            <div className="absolute inset-0 opacity-40" style={{
              backgroundImage: "linear-gradient(rgba(232,232,230,.06) 1px, transparent 1px), linear-gradient(90deg, rgba(232,232,230,.06) 1px, transparent 1px)",
              backgroundSize: "28px 28px",
            }} />
            <div className="absolute left-[38%] top-[46%] h-16 w-16 -translate-x-1/2 -translate-y-1/2 rounded-full border border-draw" style={{ boxShadow: "0 0 0 6px rgba(55,138,221,.12)" }} />
            <div className="absolute left-[38%] top-[46%] h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-draw-fg" />
            <div className="absolute bottom-3 right-3 rounded-card border border-border bg-panel/90 px-3 py-2 font-mono text-[10.5px] leading-relaxed text-muted backdrop-blur">
              43.3714° N 8.4127° W<br />
              <span className="text-subtle">radio ~ ejemplo, no medido</span>
            </div>
          </div>
          <div className="flex gap-1.5 p-2.5">
            {MINIATURAS.map((m, i) => (
              <div
                key={i}
                className="relative h-10 flex-1 rounded-[6px] border border-border bg-elevated"
              >
                <span
                  className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full"
                  style={{
                    background: m.estado === "resuelta" ? "#f2f3f5" : m.estado === "curso" ? "#efb968" : "#6a6c70",
                  }}
                />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
