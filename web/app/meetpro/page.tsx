import { HeroCarrera } from "../../components/meetpro/HeroCarrera";
import { mapaAsciiMundo } from "../../lib/mapaAscii";

export default function Page() {
  // Calculado en build (página estática): a esta resolución tarda unos
  // 15-20s, aceptable como coste de build, no aceptable por petición.
  const mapa = mapaAsciiMundo(340, 148);

  return (
    <main>
      <section className="relative flex min-h-[100vh] items-center justify-center overflow-hidden">
        <HeroCarrera mapa={mapa} />

        <div className="relative z-10 mx-auto w-full max-w-[640px] px-7 pt-[7vh] text-center">
          <span className="jg-hero-in block font-mono text-[11px] uppercase tracking-[.14em] text-subtle">
            Lumi Pro · Generation 2
          </span>
          <h1 className="jg-hero-in mt-4 text-[clamp(30px,4.6vw,50px)] font-semibold leading-[1.06] tracking-tight" style={{ animationDelay: ".07s" }}>
            Four eyes on the same map.<br />One pin lands.
          </h1>
          <p className="jg-hero-in mx-auto mt-6 max-w-[56ch] leading-relaxed text-muted" style={{ animationDelay: ".16s" }}>
            Four independent models look for a match at once. Each stakes a claim — geometry
            decides which one actually holds.
          </p>
        </div>
      </section>
    </main>
  );
}
