import { type Estimacion } from "../lib/api";
import { color, nombre } from "../lib/origenes";
import { Icon } from "../ui/Icon";

const eur = (n: number) => `${n.toFixed(2).replace(".", ",")} €`;

/** Antes de descargar. Dos puertas y son distintas: esta confirmación es
 *  INFORMADA —ves el número antes de que se gaste nada— y el tope mensual es
 *  una BARRERA que rechaza el trabajo entero. Media descarga es un índice con
 *  agujeros que nadie sabe dónde están. */
export function EstimateDialog({
  e,
  onCancelar,
  onConfirmar,
}: {
  e: Estimacion;
  onCancelar: () => void;
  onConfirmar: (soloGratis: boolean) => void;
}) {
  const pctGastado = Math.min(100, (e.gastado_eur / e.tope_eur) * 100);
  const pctEsta = Math.min(100 - pctGastado, (e.total_eur / e.tope_eur) * 100);
  const pctFuera = Math.min(100, (e.exceso_eur / e.tope_eur) * 100);
  const hayGratis = e.lineas.some((l) => l.coste_eur === 0);

  return (
    <div className={`w-[600px] rounded-card border bg-[rgba(16,19,25,.72)] p-[22px_24px]
      shadow-lg shadow-black/40 backdrop-blur-xl
      ${e.cabe ? "border-white/[.13]" : "border-danger/45"}`}>
      {e.cabe ? (
        <>
          <p className="text-sm text-fg">Antes de descargar</p>
          <p className="mt-[5px] text-[10.5px] leading-relaxed text-subtle">
            Esto es lo que va a costar, por origen. Lo gratuito también se lista: hace falta para
            entender de dónde va a salir cada imagen.
          </p>
        </>
      ) : (
        <div className="flex items-start gap-2.5">
          <Icon name="alert" size={16} className="mt-0.5 shrink-0 text-danger-fg" />
          <div>
            <p className="text-[13.5px] text-danger-fg">Esta descarga pasaría el tope del mes</p>
            <p className="mt-1.5 text-[10.5px] leading-relaxed text-subtle">
              Llevas <b className="font-normal text-fg">{eur(e.gastado_eur)}</b> gastados y esto
              sumaría <b className="font-normal text-fg">{eur(e.total_eur)}</b>, que son{" "}
              <b className="font-normal text-fg">{eur(e.exceso_eur)}</b> por encima del tope de{" "}
              <b className="font-normal text-fg">{eur(e.tope_eur)}</b>. No se descarga nada.
            </p>
          </div>
        </div>
      )}

      <table className="mt-[18px] w-full border-collapse text-[11.5px]">
        <thead>
          <tr className="text-[8px] uppercase tracking-[.11em] text-subtle">
            <th className="w-2/5 pb-2 text-left font-normal">Origen</th>
            <th className="pb-2 text-left font-normal">Teselas</th>
            <th className="pb-2 text-left font-normal">Unidades</th>
            <th className="pb-2 text-right font-normal">Coste</th>
          </tr>
        </thead>
        <tbody>
          {e.lineas.map((l) => (
            <tr key={l.fuente} className="border-t border-border">
              <td className="py-2">
                <span className="flex items-center gap-2.5">
                  <span className="h-[9px] w-[9px] shrink-0 rounded-full" style={{ background: color(l.fuente) }} />
                  {nombre(l.fuente)}
                </span>
              </td>
              <td className="py-2 font-mono">{l.teselas}</td>
              <td className="py-2 font-mono">{l.unidades.toLocaleString("es")}</td>
              <td className={`py-2 text-right font-mono ${l.coste_eur > 0 ? "text-warning-fg" : "text-subtle"}`}>
                {l.coste_eur > 0 ? eur(l.coste_eur) : "gratis"}
              </td>
            </tr>
          ))}
          <tr className="border-t border-white/20 font-medium">
            <td className="pt-[11px]" colSpan={3}>Total estimado</td>
            <td className="pt-[11px] text-right font-mono">{eur(e.total_eur)}</td>
          </tr>
        </tbody>
      </table>

      <div className="mt-[18px] rounded-[9px] border border-border p-[12px_13px]">
        <div className="flex items-center">
          <span className="flex-1 text-[8px] uppercase tracking-[.11em] text-subtle">
            Presupuesto del mes
          </span>
          <span className="font-mono text-[10.5px] text-muted">
            {eur(e.gastado_eur)} de {eur(e.tope_eur)}
          </span>
        </div>
        <div className="mt-2 flex h-[5px] overflow-hidden rounded-[3px] bg-elevated">
          <i className="block h-full bg-fg" style={{ width: `${pctGastado}%` }} />
          <i className="block h-full bg-warning" style={{ width: `${pctEsta}%` }} />
          {!e.cabe && <i className="block h-full bg-danger" style={{ width: `${pctFuera}%` }} />}
        </div>
        <p className="mt-2 text-[10.5px] text-subtle">
          {e.cabe
            ? `quedarían ${eur(e.tope_eur - e.gastado_eur - e.total_eur)}`
            : "lo rojo es lo que no cabe"}
        </p>
      </div>

      <p className="mt-[13px] text-[10.5px] leading-relaxed text-subtle">
        Solo se apunta lo que el proveedor <b className="font-normal text-fg">sirva de verdad</b>:
        una petición que falla y no devuelve imagen no se cobra ni se cuenta. Y el presupuesto va
        con la descarga como contador vivo, no como una cifra que se mira al empezar.
      </p>

      <div className="mt-[18px] flex justify-end gap-2.5">
        <button onClick={onCancelar} className="jg-press rounded-lg border border-white/15 px-4 py-2 text-[11.5px] text-fg">
          Cancelar
        </button>
        {hayGratis && (
          <button
            onClick={() => onConfirmar(true)}
            className="jg-press rounded-lg border border-white/15 px-4 py-2 text-[11.5px] text-fg"
          >
            Solo los gratuitos · 0,00 €
          </button>
        )}
        <button
          onClick={() => onConfirmar(false)}
          disabled={!e.cabe}
          className="jg-press rounded-lg bg-accent px-4 py-2 text-[11.5px] font-medium text-black disabled:opacity-40"
        >
          Confirmar y descargar · {eur(e.total_eur)}
        </button>
      </div>
    </div>
  );
}
