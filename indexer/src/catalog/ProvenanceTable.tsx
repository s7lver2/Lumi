import type { PorcentajesImagenes } from "../lib/api";

/** Las DOS procedencias, en dos tablas lado a lado. Son dos preguntas
 *  distintas — de dónde salió el píxel, quién pagó por indexarlo — y por eso
 *  suman distinto: la nota de abajo de cada una lo dice, siempre, no solo
 *  cuando el número sorprende. */
export function ProvenanceTable({
  p,
  trabajo,
}: {
  p: PorcentajesImagenes;
  trabajo: [string, number, number][];
}) {
  return (
    <div className="grid grid-cols-2 gap-4">
      <div>
        <p className="mb-2 text-[10.5px] uppercase tracking-[.08em] text-subtle">Procedencia de las imágenes</p>
        <table className="w-full text-[11px]">
          <thead>
            <tr className="text-left text-subtle">
              <th className="pb-1.5 font-normal">Tipo</th>
              <th className="pb-1.5 font-normal">Por imágenes</th>
              <th className="pb-1.5 font-normal">Por territorio · z14</th>
            </tr>
          </thead>
          <tbody>
            {p.por_tipo.map((t) => (
              <tr key={t.tipo} className="border-t border-border text-fg">
                <td className="py-1.5">{t.tipo}</td>
                <td className="py-1.5 font-mono">{t.imagenes_pct.toFixed(1)} %</td>
                <td className="py-1.5 font-mono">{t.territorio_pct.toFixed(1)} %</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-[9px] font-mono text-[9.5px] text-subtle">
          territorio suma {p.territorio_suma.toFixed(0)} % · dos orígenes pueden cubrir la misma tesela
        </p>
      </div>

      <div>
        <p className="mb-2 text-[10.5px] uppercase tracking-[.08em] text-subtle">Procedencia del trabajo</p>
        <table className="w-full text-[11px]">
          <thead>
            <tr className="text-left text-subtle">
              <th className="pb-1.5 font-normal">Origen</th>
              <th className="pb-1.5 font-normal">Teselas</th>
              <th className="pb-1.5 font-normal">Cuota</th>
            </tr>
          </thead>
          <tbody>
            {trabajo.map(([origen, teselas, pct]) => (
              <tr key={origen} className="border-t border-border text-fg">
                <td className="py-1.5">{origen}</td>
                <td className="py-1.5 font-mono">{teselas}</td>
                <td className="py-1.5 font-mono">{pct.toFixed(1)} %</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-[9px] font-mono text-[9.5px] text-subtle">
          suma 100 % · una tesela la indexó exactamente uno
        </p>
      </div>
    </div>
  );
}
