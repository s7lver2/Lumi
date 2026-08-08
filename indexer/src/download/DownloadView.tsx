import { useEffect, useState } from "react";

import { api, type ProgresoDescarga } from "../lib/api";
import { color, nombre } from "../lib/origenes";

const eur = (n: number) => `${n.toFixed(2).replace(".", ",")} €`;

export function DownloadView({ onTerminado }: { onTerminado: () => void }) {
  const [p, setP] = useState<ProgresoDescarga | null>(null);

  // El sondeo TERMINA cuando la descarga termina. Es la misma lección del paso
  // de servicios: un intervalo eterno inunda el log y miente sobre el estado.
  useEffect(() => {
    let arranco = false;
    const t = setInterval(() => {
      void api.descargaProgreso().then((x) => {
        setP(x);
        if (x.trabajando) arranco = true;
        else if (arranco) { clearInterval(t); onTerminado(); }
      });
    }, 700);
    return () => clearInterval(t);
  }, [onTerminado]);

  if (!p) return null;
  const pct = p.teselas_total ? (p.teselas_hechas / p.teselas_total) * 100 : 0;

  return (
    <div className="flex h-full">
      <div className="flex-1 overflow-hidden p-[20px_22px]">
        <div className="flex items-center">
          <span className="flex-1 text-[13px] text-fg">Bajando imágenes de red</span>
          <span className="font-mono text-[11px] text-muted">
            {p.teselas_hechas} de {p.teselas_total} teselas
          </span>
        </div>
        <div className="mt-2.5 h-1.5 overflow-hidden rounded-[3px] bg-elevated">
          <i className="block h-full bg-fg transition-[width] duration-500" style={{ width: `${pct}%` }} />
        </div>

        <p className="mt-[22px] text-[8.5px] uppercase tracking-[.13em] text-subtle">Por origen</p>
        <table className="mt-2 w-full border-collapse text-[11.5px]">
          <tbody>
            {p.por_origen.map(([f, hechas, total]) => (
              <tr key={f} className="border-t border-border">
                <td className="w-[35%] py-2">
                  <span className="flex items-center gap-2.5">
                    <span className="h-[9px] w-[9px] rounded-full" style={{ background: color(f) }} />
                    {nombre(f)}
                  </span>
                </td>
                <td className="py-2">
                  <span className="block h-[5px] w-[150px] overflow-hidden rounded-[3px] bg-elevated">
                    <i className="block h-full" style={{ width: `${total ? (hechas / total) * 100 : 0}%`, background: color(f) }} />
                  </span>
                </td>
                <td className="py-2 text-right font-mono text-muted">{hechas}/{total}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {p.registro.length > 0 && (
          <>
            <p className="mt-[22px] text-[8.5px] uppercase tracking-[.13em] text-subtle">Registro</p>
            <div className="mt-2 h-[180px] overflow-y-auto rounded-lg border border-border bg-[#0b0d0f] px-3 py-2.5">
              {p.registro.map((l, i) => (
                <p key={i} className="font-mono text-[10px] leading-[1.9] text-muted">{l}</p>
              ))}
              <div ref={(el) => el?.scrollIntoView({ block: "nearest" })} />
            </div>
          </>
        )}
        {p.sin_saldo && (
          <p className="mt-2.5 text-[11px] text-warning-fg">
            El presupuesto se agotó a mitad. Lo bajado está dentro y pagado; las teselas que se
            quedaron sin terminar siguen pendientes y no se han marcado como hechas, así que al
            retomar con más presupuesto continúan por donde iban.
          </p>
        )}
      </div>

      <aside className="w-[300px] border-l border-border bg-[rgba(16,18,21,.5)] p-[20px_18px]">
        <p className="text-[8.5px] uppercase tracking-[.13em] text-subtle">Gasto</p>
        <p className="mt-2 font-mono text-[15px] text-warning-fg">{eur(p.gastado_eur)}</p>
        <p className="mt-2 text-[10.5px] leading-relaxed text-subtle">
          Solo lo servido. Una petición que falla no se cobra ni se apunta.
        </p>

        <div className="my-4 h-px bg-border" />
        <p className="text-[8.5px] uppercase tracking-[.13em] text-subtle">Retomar</p>
        <p className="mt-2 text-[10.5px] leading-relaxed text-subtle">
          Cada pareja <b className="font-normal text-fg">tesela × origen</b> se anota al terminar.
          Si cierras esto a mitad, al volver se sigue por donde iba y{" "}
          <b className="font-normal text-fg">no se vuelve a pagar</b> por nada ya descargado.
        </p>

        <button
          onClick={() => void api.descargaParar()}
          className="jg-press mt-5 w-full rounded-lg border border-border py-[7px] text-[11.5px] text-fg"
        >
          Detener
        </button>
      </aside>
    </div>
  );
}
