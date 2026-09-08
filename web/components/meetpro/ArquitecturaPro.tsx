"use client";
import { usarRevelado } from "../usarRevelado";

/** El pipeline real de Pro (`registros/niveles/pro.json`), pero leído como
 *  lo que es: no una cadena de pasos como la de Mini, sino un concurso — 4
 *  recuperadores en paralelo, 4 verificadores geométricos que compiten por
 *  quién confirma más inliers, 10 agentes que describen y penalizan al
 *  final. Los nombres de motores (recuperación, verificación, agentes) son
 *  reales, tal cual el registro; las barras de "eliminación progresiva"
 *  son el mecanismo ilustrado con cifras de ejemplo — la puntuación real
 *  de inliers varía en cada consulta, esto solo enseña la FORMA del
 *  proceso. */

const RECUPERACION = ["lumi-preview", "lumi-2", "eigenplaces", "dino-mix"];
const VERIFICADORES = ["roma", "dinov2-vitl14", "lightglue-aliked", "aliked-n16"];
const AGENTES = [
  "idioma", "lado de conducción", "clima aparente", "hora por sombras", "topónimos",
  "estación", "escena", "señalización", "matrícula", "dimensiones",
];

// Ejemplo: puntuación de inliers de 5 candidatos típicos tras pasar por los
// 4 verificadores — el ganador es el que más confirmaciones reales junta,
// no el primero en llegar ni un promedio entre todos.
const CANDIDATOS_EJEMPLO = [
  { id: "A", inliers: 340, gana: true },
  { id: "B", inliers: 61 },
  { id: "C", inliers: 38 },
  { id: "D", inliers: 19 },
  { id: "E", inliers: 9 },
];
const MAX_INLIERS = Math.max(...CANDIDATOS_EJEMPLO.map((c) => c.inliers));

function Pildora({ children, apagada }: { children: React.ReactNode; apagada?: boolean }) {
  return (
    <span
      className={`rounded-[5px] border px-2.5 py-1 font-mono text-[11px] ${
        apagada ? "border-border/60 text-subtle" : "border-border text-fg"
      }`}
    >
      {children}
    </span>
  );
}

export function ArquitecturaPro() {
  const { ref, visible } = usarRevelado<HTMLElement>();

  return (
    <section ref={ref} className="mx-auto max-w-[760px] px-7 py-28">
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
        La geometría elimina, no promedia
      </h2>
      <p
        className="mt-3 max-w-[70ch] leading-relaxed text-muted"
        style={visible ? { animation: "jg-reveal-up .7s cubic-bezier(.16,1,.3,1) both .1s" } : { opacity: 0 }}
      >
        Cuatro recuperadores buscan a la vez, cuatro verificadores confirman con geometría real, y
        diez agentes describen lo que ven. Nada se promedia entre ellos — el candidato con más
        inliers gana, el resto se descarta.
      </p>

      <div
        className="mt-10"
        style={visible ? { animation: "jg-reveal-up .6s cubic-bezier(.16,1,.3,1) both .2s" } : { opacity: 0 }}
      >
        <span className="font-mono text-[11px] uppercase tracking-wide text-subtle">recuperación · 4 en paralelo</span>
        <div className="mt-2.5 flex flex-wrap gap-2">
          {RECUPERACION.map((m) => <Pildora key={m}>{m}</Pildora>)}
        </div>
      </div>

      <div
        className="mt-8"
        style={visible ? { animation: "jg-reveal-up .6s cubic-bezier(.16,1,.3,1) both .28s" } : { opacity: 0 }}
      >
        <span className="font-mono text-[11px] uppercase tracking-wide text-subtle">verificación geométrica · 4 compitiendo</span>
        <div className="mt-2.5 flex flex-wrap gap-2">
          {VERIFICADORES.map((m) => <Pildora key={m}>{m}</Pildora>)}
        </div>
      </div>

      <div
        className="mt-10 rounded-card border border-border bg-panel p-4"
        style={visible ? { animation: "jg-reveal-up .6s cubic-bezier(.16,1,.3,1) both .36s" } : { opacity: 0 }}
      >
        <div className="flex items-baseline justify-between">
          <span className="font-mono text-[11px] uppercase tracking-wide text-subtle">inliers por candidato</span>
          <span className="font-mono text-[10px] text-subtle">ejemplo — varía en cada consulta</span>
        </div>
        <div className="mt-3 flex flex-col gap-2.5">
          {CANDIDATOS_EJEMPLO.map((c, i) => (
            <div key={c.id} className="grid grid-cols-[70px_1fr_56px] items-center gap-3">
              <span className={`text-[12px] ${c.gana ? "text-fg" : "text-muted"}`}>candidato {c.id}</span>
              <div className="h-1.5 overflow-hidden rounded-full bg-elevated">
                <div
                  className={`h-full rounded-full jg-barra-llena ${c.gana ? "bg-fg" : "bg-subtle/50"}`}
                  style={{ "--fin": `${(c.inliers / MAX_INLIERS) * 100}%`, animationDelay: `${0.45 + i * 0.08}s` } as React.CSSProperties}
                />
              </div>
              <span className="text-right font-mono text-[12px] text-fg">{c.inliers} pts</span>
            </div>
          ))}
        </div>
      </div>

      <div
        className="mt-8"
        style={visible ? { animation: "jg-reveal-up .6s cubic-bezier(.16,1,.3,1) both .5s" } : { opacity: 0 }}
      >
        <span className="font-mono text-[11px] uppercase tracking-wide text-subtle">agentes · 10, todos describen</span>
        <div className="mt-2.5 flex flex-wrap gap-2">
          {AGENTES.map((a) => <Pildora key={a} apagada>{a}</Pildora>)}
        </div>
      </div>
    </section>
  );
}
