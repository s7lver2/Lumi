"use client";
import { usarRevelado } from "../usarRevelado";

/** El pipeline real de Mini, tal cual sale de `registros/niveles/mini.json`
 *  y de ARCHITECTURE.md §5c — no una ilustración inventada de "cómo
 *  funciona una IA". Diagrama de capas apiladas: el índice es
 *  infraestructura (una base sobre la que se consulta, no un paso de la
 *  secuencia), y encima se apilan recuperación → verificación → agentes,
 *  el orden real en el que cada capa refina lo que le llega de la de
 *  abajo.
 *
 *  Cada capa muestra solo su nombre por defecto — el detalle (qué hace de
 *  verdad, con qué pregunta o restricción real de su registro) vive en
 *  hover, no siempre visible. Menos texto en reposo, más denso al mirar de
 *  cerca, en vez de párrafos permanentes debajo de cada caja. */
type Agente = { id: string; nombre: string };

// Solo el nombre: aquí la idea es VER la arquitectura, no explicarla entera
// — el detalle de cada agente (pregunta real, motor) vive en el bloque
// interactivo de agentes más abajo en la página, no aquí también. Los
// cuatro son iguales entre sí: todos describen, ninguno descarta un
// candidato (los que dan una restricción geográfica solo le bajan la
// confianza cuando la contradicen) — sin más reparto que ese.
const AGENTES: Agente[] = [
  { id: "idioma", nombre: "idioma del cartel" },
  { id: "lado-conduccion", nombre: "lado de conducción" },
  { id: "clima-aparente", nombre: "clima aparente" },
  { id: "hora-sombras", nombre: "hora por sombras" },
];

/** Caja con hover: por defecto solo la migaja (capa + modelo si tiene);
 *  el detalle real se revela empujando la caja hacia abajo, no como un
 *  tooltip flotante — así no tapa nada ni se corta contra el borde. */
function CapaBox({
  etiqueta, modelo, detalle, ancha, visible, retraso,
}: {
  etiqueta: string; modelo?: string; detalle: string; ancha?: boolean; visible: boolean; retraso: number;
}) {
  return (
    <div
      className={`group jg-micro cursor-default rounded-card border border-border p-4 transition-colors hover:border-subtle
        ${ancha ? "-mx-4 bg-elevated text-center sm:-mx-7" : "bg-panel"}`}
      style={visible ? { animation: `jg-reveal-up .6s cubic-bezier(.16,1,.3,1) both ${retraso}s` } : { opacity: 0 }}
    >
      <div className={`flex items-center font-mono text-[11px] uppercase tracking-wide text-subtle ${ancha ? "justify-center" : "justify-between"}`}>
        <span>{etiqueta}</span>
        {modelo && <span className="text-[13px] normal-case tracking-normal text-fg">{modelo}</span>}
      </div>
      <div className="grid grid-rows-[0fr] transition-[grid-template-rows] duration-300 ease-out group-hover:grid-rows-[1fr]">
        <p className={`overflow-hidden text-[12px] leading-snug text-muted ${ancha ? "mx-auto max-w-[46ch]" : ""}`}>
          <span className="block pt-2.5">{detalle}</span>
        </p>
      </div>
    </div>
  );
}

function Conector({ etiqueta, visible, retraso }: { etiqueta: string; visible: boolean; retraso: number }) {
  return (
    <div
      className="flex items-center gap-2.5 self-center py-1"
      style={visible ? { animation: `jg-reveal-up .5s cubic-bezier(.16,1,.3,1) both ${retraso}s` } : { opacity: 0 }}
    >
      <span className="h-6 w-px bg-border" aria-hidden />
      <span className="font-mono text-[10px] uppercase tracking-wide text-subtle">{etiqueta}</span>
    </div>
  );
}

/** Una ficha de agente: solo el nombre — ver cuáles son, no leer qué hace
 *  cada uno. Sin revelado en hover a propósito. */
function FichaAgente({ a }: { a: Agente }) {
  return (
    <div className="jg-micro cursor-default rounded-[5px] border border-border px-2 py-1.5 text-center transition-colors hover:border-fg">
      <span className="font-mono text-[10.5px] text-fg">{a.nombre}</span>
    </div>
  );
}

export function ArquitecturaMini() {
  const { ref, visible } = usarRevelado<HTMLElement>();

  return (
    <section ref={ref} id="arquitectura" className="mx-auto max-w-[720px] px-7 py-28">
      <span
        className="font-mono text-[11px] uppercase tracking-wide text-subtle"
        style={visible ? { animation: "jg-reveal-up .7s cubic-bezier(.16,1,.3,1) both" } : { opacity: 0 }}
      >
        cómo está hecho
      </span>
      <h2
        className="mt-2 text-[clamp(24px,3.4vw,36px)] font-semibold tracking-tight"
        style={visible ? { animation: "jg-reveal-up .7s cubic-bezier(.16,1,.3,1) both .05s" } : { opacity: 0 }}
      >
        Un recuperador, un verificador, cuatro agentes
      </h2>
      <p
        className="mt-3 max-w-[70ch] leading-relaxed text-muted"
        style={visible ? { animation: "jg-reveal-up .7s cubic-bezier(.16,1,.3,1) both .1s" } : { opacity: 0 }}
      >
        Esto es todo lo que corre — no una versión recortada de una lista más larga. Pasa el
        ratón por encima de cada capa para ver qué hace de verdad.
      </p>

      <div className="mt-14 flex flex-col items-stretch">
        <div
          className="jg-micro cursor-default rounded-card border border-border bg-panel p-4 transition-colors hover:border-subtle"
          style={visible ? { animation: "jg-reveal-up .6s cubic-bezier(.16,1,.3,1) both .48s" } : { opacity: 0 }}
        >
          <div className="flex items-center justify-between font-mono text-[11px] uppercase tracking-wide text-subtle">
            <span>capa de agentes</span>
            <span className="text-[10px] normal-case tracking-normal text-subtle">4 agentes</span>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-1.5 border-t border-border pt-3">
            {AGENTES.map((a) => <FichaAgente key={a.id} a={a} />)}
          </div>
        </div>

        <Conector etiqueta="confirma candidatos" visible={visible} retraso={0.4} />
        <CapaBox etiqueta="verificación geométrica" modelo="tiny-roma"
          detalle="De los candidatos que llegan de recuperación, confirma cuál encaja de verdad con la geometría de la foto."
          visible={visible} retraso={0.32} />

        <Conector etiqueta="produce candidatos" visible={visible} retraso={0.24} />
        <CapaBox etiqueta="recuperación" modelo="cosplace"
          detalle="Busca en el índice las zonas más parecidas a la foto de consulta — el primer filtro, el más barato."
          visible={visible} retraso={0.18} />

        <Conector etiqueta="consulta contra" visible={visible} retraso={0.12} />
        <CapaBox etiqueta="índice geográfico"
          detalle="El corpus georreferenciado sobre el que se busca — la base, no un modelo más."
          ancha visible={visible} retraso={0.06} />
      </div>
    </section>
  );
}
