import { HeroOrbita } from "../components/HeroOrbita";
import { Sobrevuelo } from "../components/Sobrevuelo";
import { Escalera } from "../components/Escalera";
import { Agentes } from "../components/Agentes";
import { Cobertura } from "../components/Cobertura";
import { BotonCopiarComando } from "../components/BotonCopiarComando";
import { SelectorDescarga } from "../components/SelectorDescarga";
import { artefactosCliente } from "../lib/version";

const COMANDO = "curl -fsSL lumi.s7lver.xyz/install | sh";

export default function Home() {
  const artefactos = artefactosCliente();
  return (
    <main>
      <section className="relative flex min-h-[100vh] items-center justify-center overflow-hidden">
        <div className="absolute inset-0">
          <HeroOrbita />
        </div>
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-56 bg-gradient-to-t from-bg to-transparent" />
        <div className="pointer-events-none absolute inset-x-0 top-0 h-36 bg-gradient-to-b from-bg/70 to-transparent" />

        <div className="relative z-10 mx-auto w-full max-w-[720px] px-7 text-center">
          <span className="jg-hero-in block font-mono text-[11px] uppercase tracking-[.14em] text-subtle">
            geolocalización forense · autoalojada
          </span>
          <h1
            className="jg-hero-in mt-4 text-[clamp(36px,6.6vw,66px)] font-semibold leading-[1.04] tracking-tight"
            style={{ animationDelay: ".07s" }}
          >
            Meet Lumi. <em className="italic text-muted">The definitive AI forensic toolkit.</em>
          </h1>
          <p
            className="jg-hero-in mx-auto mt-6 max-w-[48ch] leading-relaxed text-muted"
            style={{ animationDelay: ".16s" }}
          >
            Lumi encadena varios verificadores geométricos que compiten por acercarse
            más al punto real — no es un modelo mejor, es la competencia entre varios.
            Autoalojado: tus imágenes y tus GPUs no salen de tu servidor.
          </p>

          <div className="jg-hero-in mt-8 flex flex-wrap items-start justify-center gap-3" style={{ animationDelay: ".24s" }}>
            <SelectorDescarga artefactos={artefactos} />
            <a
              className="jg-micro jg-micro-scale rounded-card border border-border px-4 py-2 text-[13px] font-medium text-fg hover:border-subtle hover:bg-elevated"
              href="#modelos"
            >
              Conocer los modelos
            </a>
            <a
              className="jg-micro jg-micro-scale rounded-card border border-border px-4 py-2 text-[13px] font-medium text-fg hover:border-subtle hover:bg-elevated"
              href="#cobertura"
            >
              Ver el mapa de cobertura
            </a>
          </div>

          <div
            className="jg-hero-in mt-6 inline-flex items-center gap-2 font-mono text-[11.5px] text-subtle"
            style={{ animationDelay: ".32s" }}
          >
            <span className="text-subtle/70">$</span>
            <code>curl -fsSL lumi.s7lver.xyz/install | sh</code>
            <BotonCopiarComando comando={COMANDO} />
            <span className="text-subtle/60">— instala el CLI en tu servidor</span>
          </div>
          <p className="jg-hero-in mt-2 font-mono text-[11px] text-subtle" style={{ animationDelay: ".36s" }}>
            se autoaloja en tu propio servidor — sin cuentas, sin nube de terceros
          </p>
        </div>
      </section>

      <Sobrevuelo />

      <Escalera />

      <Agentes />

      <Cobertura />
    </main>
  );
}
