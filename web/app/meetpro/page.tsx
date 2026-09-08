import { HeroCarrera } from "../../components/meetpro/HeroCarrera";
import { ArquitecturaPro } from "../../components/meetpro/ArquitecturaPro";
import { RequisitosPro } from "../../components/meetpro/RequisitosPro";
import { BenchmarksPro } from "../../components/meetpro/BenchmarksPro";
import { SeparadorSeccion } from "../../components/SeparadorSeccion";
import { mapaAsciiMundo } from "../../lib/mapaAscii";

export default function Page() {
  // Calculado en build (página estática): a esta resolución tarda unos
  // 15-20s, aceptable como coste de build, no aceptable por petición.
  //
  // 400x120 y no un número "bonito" al azar: un carácter mono mide en
  // pantalla ~0.6 de ancho por cada unidad de alto (mismo factor que ya usa
  // `HeroIndice.tsx`), así que para que el mapa se vea con las proporciones
  // reales (360° de largo por 180° de alto, 2:1) hacen falta columnas y filas
  // en proporción 2/0.6 ≈ 3.33, no las columnas/filas del mapa a secas —
  // con menos columnas de las que tocan, todo sale estirado verticalmente.
  const mapa = mapaAsciiMundo(400, 120);

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

      <SeparadorSeccion />

      <ArquitecturaPro />

      <SeparadorSeccion />

      <RequisitosPro />

      <SeparadorSeccion />

      <BenchmarksPro />
    </main>
  );
}
