import type { PorcentajesImagenes } from "../lib/api";
import { color, nombre } from "../lib/origenes";

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

        {p.por_fuente.length > 0 && (
          <>
            <p className="mb-2 mt-5 text-[10.5px] uppercase tracking-[.08em] text-subtle">Por fuente</p>
            <div className="flex flex-col gap-1.5">
              {p.por_fuente.map((f) => (
                <div key={f.fuente} className="flex items-center gap-2">
                  <span className="h-[9px] w-[9px] shrink-0 rounded-full" style={{ background: color(f.fuente) }} />
                  <span className="w-[120px] shrink-0 text-[11px] text-fg">{nombre(f.fuente)}</span>
                  <span className="h-1 flex-1 overflow-hidden rounded-[2px] bg-elevated">
                    <i className="block h-full" style={{ width: `${f.imagenes_pct}%`, background: color(f.fuente) }} />
                  </span>
                  <span className="w-10 shrink-0 text-right font-mono text-[10px] text-muted">
                    {f.imagenes_pct.toFixed(0)}%
                  </span>
                </div>
              ))}
            </div>
          </>
        )}
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
