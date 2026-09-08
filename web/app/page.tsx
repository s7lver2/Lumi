import { HeroOrbita } from "../components/HeroOrbita";
import { Sobrevuelo } from "../components/Sobrevuelo";
import { Escalera } from "../components/Escalera";
import { VideoDemo } from "../components/VideoDemo";
import { AgentesVisual } from "../components/AgentesVisual";
import { Confianza } from "../components/Confianza";
import { Cobertura } from "../components/Cobertura";
import { SeparadorSeccion } from "../components/SeparadorSeccion";
import { SelectorDescarga } from "../components/SelectorDescarga";
import { PalabraRotativa } from "../components/PalabraRotativa";
import { productosDescargables } from "../lib/version";

export default function Home() {
  const productos = productosDescargables();
  return (
    <main>
      <section id="hero" className="relative flex min-h-[100vh] items-center justify-center overflow-hidden">
        <div className="absolute inset-0">
          <HeroOrbita />
        </div>
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-56 bg-gradient-to-t from-bg to-transparent" />
        <div className="pointer-events-none absolute inset-x-0 top-0 h-36 bg-gradient-to-b from-bg/70 to-transparent" />

        <div className="relative z-10 mx-auto w-full max-w-[720px] px-7 text-center">
          <span className="jg-hero-in block font-mono text-[11px] uppercase tracking-[.14em] text-subtle">
            The Next Gen Of Forensic Research · Completely Free
          </span>
          <h1
            className="jg-hero-in mt-4 text-[clamp(36px,6.6vw,66px)] font-semibold leading-[1.04] tracking-tight"
            style={{ animationDelay: ".07s" }}
          >
            Lumi. <em className="italic text-muted">Give Me A Image We Find Out <PalabraRotativa />.</em>
          </h1>
          <p
            className="jg-hero-in mx-auto mt-6 max-w-[48ch] leading-relaxed text-muted"
            style={{ animationDelay: ".16s" }}
          >
            Lumi is a forense toolkit designed for detection, recon, and extraction
            of information from images, completely free and self-hosted
          </p>

          <div className="jg-hero-in mt-8 flex flex-wrap items-start justify-center gap-3" style={{ animationDelay: ".24s" }}>
            <SelectorDescarga productos={productos} />
            <a
              className="jg-micro jg-micro-scale rounded-card border border-border px-4 py-2 text-[13px] font-medium text-fg hover:border-subtle hover:bg-elevated"
              href="#modelos"
            >
              Meet The Family
            </a>  
            <a
              className="jg-micro jg-micro-scale rounded-card border border-border px-4 py-2 text-[13px] font-medium text-fg hover:border-subtle hover:bg-elevated"
              href="/indexado#mapa"
            >
              Open Map
            </a>
          </div>

          <p className="jg-hero-in mt-6 font-mono text-[11px] text-subtle" style={{ animationDelay: ".32s" }}>
            Free - Self hosted
          </p>
        </div>
      </section>

      <Sobrevuelo />

      <SeparadorSeccion />

      <Escalera />

      <SeparadorSeccion />

      <AgentesVisual />

      <SeparadorSeccion />

      <VideoDemo />

      <SeparadorSeccion />

      <Confianza />

      <SeparadorSeccion />

      <Cobertura />
    </main>
  );
}
