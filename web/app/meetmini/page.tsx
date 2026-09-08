import { HeroIndice } from "../../components/meetmini/HeroIndice";
import { ArquitecturaMini } from "../../components/meetmini/ArquitecturaMini";
import { RequisitosMini } from "../../components/meetmini/RequisitosMini";
import { BenchmarksMini } from "../../components/meetmini/BenchmarksMini";
import { CierreMini } from "../../components/meetmini/CierreMini";
import { SeparadorSeccion } from "../../components/SeparadorSeccion";
import { productosDescargables } from "../../lib/version";

export default function Page() {
  const productos = productosDescargables();
  return (
    <main>
      <section className="relative flex min-h-[100vh] items-center justify-center overflow-hidden">
        <HeroIndice />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-56 bg-gradient-to-t from-bg to-transparent" />

        <div className="relative z-10 mx-auto w-full max-w-[720px] px-7 text-center">
          <span className="jg-hero-in block font-mono text-[11px] uppercase tracking-[.14em] text-subtle">
            Lumi Mini · Generation 2
          </span>
          <h1 className="jg-hero-in mt-4 text-[clamp(36px,6.6vw,66px)] font-semibold leading-[1.04] tracking-tight" style={{ animationDelay: ".07s" }}>
            One retriever. One verifier. That's it.
          </h1>
          <p className="jg-hero-in mx-auto mt-6 max-w-[52ch] leading-relaxed text-muted" style={{ animationDelay: ".16s" }}>
            A compact model built for everyday cases — the first to answer, not the most demanding.
            Mini brings the power other models need down to hardware you already own.
          </p>
        </div>
      </section>

      <SeparadorSeccion />

      <ArquitecturaMini />

      <SeparadorSeccion />

      <RequisitosMini />

      <SeparadorSeccion />

      <BenchmarksMini />

      <SeparadorSeccion />

      <CierreMini productos={productos} />
    </main>
  );
}
