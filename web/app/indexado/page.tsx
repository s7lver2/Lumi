import { IndexadoHero } from "../../components/indexado/IndexadoHero";
import { Origenes } from "../../components/indexado/Origenes";
import { Territorio } from "../../components/indexado/Territorio";
import { Reclamos } from "../../components/indexado/Reclamos";
import { VideoIndexado } from "../../components/indexado/VideoIndexado";
import { MapaReclamado } from "../../components/indexado/MapaReclamado";
import { SeparadorSeccion } from "../../components/SeparadorSeccion";
import { SelectorDescarga } from "../../components/SelectorDescarga";
import { productosDescargables } from "../../lib/version";

export default function Page() {
  const productos = productosDescargables().filter((p) => p.producto === "indexer");

  return (
    <main>
      <IndexadoHero productos={productos} />

      <SeparadorSeccion />
      <Origenes />

      <SeparadorSeccion />
      <Territorio />

      <SeparadorSeccion />
      <Reclamos />

      <SeparadorSeccion />
      <VideoIndexado />

      <SeparadorSeccion />
      <MapaReclamado />

      <SeparadorSeccion />
      <section id="cta" className="mx-auto max-w-[1180px] px-7 py-28 text-center">
        <span className="font-mono text-[11px] uppercase tracking-wide text-subtle">empieza a indexar</span>
        <h2 className="mx-auto mt-2 max-w-[36ch] text-[clamp(24px,3.4vw,36px)] font-semibold tracking-tight">
          El corpus crece con quien lo usa
        </h2>
        <p className="mx-auto mt-3 max-w-[52ch] leading-relaxed text-muted">
          Sin cuentas, sin servidor propio. Se dibuja un área y se publica.
        </p>
        <div className="mt-6 flex justify-center">
          <SelectorDescarga productos={productos} />
        </div>
      </section>
    </main>
  );
}
