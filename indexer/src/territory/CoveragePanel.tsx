import type { Clasificacion } from "../lib/api";
import { Icon } from "../ui/Icon";

/** El panel derecho de 328 px: superficie y teselas arriba, la barra de tres
 *  estados, las tres filas con su cuenta, quién publicó lo azul, y el coste
 *  con solo lo punteado (lo nuevo). */
export function CoveragePanel({ c, onPlanear }: { c: Clasificacion; onPlanear: () => void }) {
  const total = c.locales + c.catalogo + c.nuevas + c.reclamadas;
  const pct = (n: number) => (total === 0 ? 0 : (n / total) * 100);

  return (
    <div className="flex h-full w-[328px] flex-col border-l border-border bg-[rgba(13,15,17,.9)] p-4">
      <p className="text-[10.5px] uppercase tracking-[.08em] text-subtle">Teselas</p>
      <p className="mt-1 font-mono text-lg text-fg">{total}</p>

      <div className="mt-3 flex h-[6px] overflow-hidden rounded-[3px] bg-elevated">
        <i className="block bg-fg" style={{ width: `${pct(c.locales)}%` }} />
        <i className="block bg-draw" style={{ width: `${pct(c.catalogo)}%` }} />
        <i className="block bg-warning" style={{ width: `${pct(c.reclamadas)}%` }} />
        <i className="block bg-white/[.06]" style={{ width: `${pct(c.nuevas)}%` }} />
      </div>

      <div className="mt-3 flex flex-col gap-1.5 text-[11px]">
        <Fila etiqueta="Ya en este equipo" n={c.locales} color="bg-fg" />
        <Fila etiqueta="Publicadas por otros" n={c.catalogo} color="bg-draw" />
        <Fila etiqueta="Reclamadas por otros" n={c.reclamadas} color="bg-warning" />
        <Fila etiqueta="Nuevas · cuestan GPU" n={c.nuevas} color="bg-white/[.2]" />
      </div>

      {c.autores.length > 0 && (
        <div className="mt-4">
          <p className="text-[10px] uppercase tracking-[.08em] text-subtle">Se heredaría de</p>
          <div className="mt-1.5 flex flex-col gap-1">
            {c.autores.map(([autor, n]) => (
              <div key={autor} className="flex items-center justify-between text-[10.5px] text-muted">
                <span className="truncate">{autor}</span>
                <span className="font-mono text-fg">{n}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {c.reclamadas > 0 && (
        <p className="mt-3 text-[10.5px] leading-snug text-muted">
          Ni las descargas del proveedor ni te descargas sus paquetes:{" "}
          <b className="font-normal text-fg">no entran en tu índice</b>. Tu ficha declara que esa
          zona la cubren ellos, y quien instale tu índice desde el catálogo se los baja también.
        </p>
      )}

      <p className="mt-[11px] flex items-start gap-[7px] text-[10.5px] leading-snug text-subtle">
        <Icon name="info" size={12} className="mt-px shrink-0" />
        Las {c.locales + c.catalogo} teselas que ya existen no se vuelven a descargar del
        proveedor ni se vuelven a embeber.
      </p>

      <div className="flex-1" />

      <button onClick={onPlanear} disabled={total === 0}
        className="jg-press rounded-lg bg-accent px-4 py-2 text-[11.5px] font-medium text-black disabled:opacity-40">
        {c.nuevas > 0 ? "Ver el plan" : "Instalar lo que existe"}
      </button>
    </div>
  );
}

function Fila({ etiqueta, n, color }: { etiqueta: string; n: number; color: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className={`block h-[7px] w-[7px] shrink-0 rounded-sm ${color}`} />
      <span className="flex-1 text-muted">{etiqueta}</span>
      <span className="font-mono text-fg">{n}</span>
    </div>
  );
}
