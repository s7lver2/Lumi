import { useEffect, useRef, useState } from "react";

import { api, type ProgresoDescarga } from "../lib/api";
import { color, nombre } from "../lib/origenes";
import { IndexQueueBar } from "../ui/IndexQueueBar";
import { DownloadMap } from "./DownloadMap";

const eur = (n: number) => `${n.toFixed(2).replace(".", ",")} €`;

/** "≈ 3 min" / "≈ 40 s", o `null` si todavía no hay ni una hecha con qué
 *  calcular un ritmo. La ventana es desde que arrancó, no una media móvil:
 *  con un puñado de teselas cada muestra pesa demasiado para suavizarla. */
function formatoEta(segundos: number): string {
  if (segundos < 60) return `≈ ${Math.max(1, Math.round(segundos))} s`;
  const min = Math.round(segundos / 60);
  return min < 60 ? `≈ ${min} min` : `≈ ${(min / 60).toFixed(1)} h`;
}

export function DownloadView({ indiceId, imagenesEstimadas, onTerminado }: {
  indiceId: number; imagenesEstimadas: number | null; onTerminado: () => void;
}) {
  const [p, setP] = useState<ProgresoDescarga | null>(null);
  const [eta, setEta] = useState<string | null>(null);
  const [deteniendo, setDeteniendo] = useState(false);
  const desde = useRef<number | null>(null);

  // El sondeo TERMINA cuando la descarga termina. Es la misma lección del paso
  // de servicios: un intervalo eterno inunda el log y miente sobre el estado.
  useEffect(() => {
    let arranco = false;
    const t = setInterval(() => {
      void api.descargaProgreso().then((x) => {
        setP(x);
        if (x.trabajando) {
          arranco = true;
          if (desde.current === null) desde.current = Date.now();
          const transcurrido = (Date.now() - desde.current) / 1000;
          // Por teselas el ritmo se queda mudo mientras una sola tarda
          // minutos (el caso real de Tokio): `teselas_hechas` no sube y el
          // ETA nunca aparece. Con la estimación del sondeo como techo, se
          // mide en IMÁGENES — que sí suben aunque la tesela en curso no
          // haya terminado — y el ETA avanza de verdad.
          if (imagenesEstimadas && imagenesEstimadas > 0) {
            const ritmo = x.imagenes / Math.max(1, transcurrido);
            const restantes = Math.max(0, imagenesEstimadas - x.imagenes);
            setEta(ritmo > 0 ? formatoEta(restantes / ritmo) : null);
          } else {
            const ritmo = x.teselas_hechas / Math.max(1, transcurrido);
            setEta(ritmo > 0 ? formatoEta((x.teselas_total - x.teselas_hechas) / ritmo) : null);
          }
        } else if (arranco) { clearInterval(t); onTerminado(); }
      });
    }, 700);
    return () => clearInterval(t);
  }, [onTerminado, imagenesEstimadas]);

  if (!p) return null;
  const pct = p.teselas_total ? (p.teselas_hechas / p.teselas_total) * 100 : 0;

  return (
    <div className="flex h-full">
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden p-[20px_22px]">
        <div className="flex items-center">
          <span className="flex-1 text-[13px] text-fg">Bajando imágenes de red</span>
          {eta && (imagenesEstimadas ? p.imagenes < imagenesEstimadas : p.teselas_hechas < p.teselas_total) && (
            <span className="mr-2.5 font-mono text-[10.5px] text-subtle">{eta} restantes</span>
          )}
          <span className="font-mono text-[11px] text-muted">
            {p.teselas_hechas} de {p.teselas_total} teselas
          </span>
        </div>
        <div className="mt-2.5 h-1.5 overflow-hidden rounded-[3px] bg-elevated">
          <i className="block h-full bg-fg transition-[width] duration-500" style={{ width: `${pct}%` }} />
        </div>

        {/* La barra de arriba solo avanza tesela a tesela, y una sola puede
            tardar minutos en zonas densas. Sin esto, esos minutos se leen
            como que no pasa nada — aunque el registro de abajo sí se mueva,
            hay que mirarlo para saberlo. Sin total que enseñar (no se sabe
            cuántas fotos trae una tesela hasta que termina), la franja va
            rayada y en marcha: es "sigue viva", no "va por la mitad". */}
        {p.en_curso && (
          <div className="mt-2.5 flex items-center gap-2 text-[10.5px] text-subtle">
            <span className="h-[7px] w-[7px] shrink-0 rounded-full" style={{ background: color(p.en_curso.fuente) }} />
            <span className="truncate">{nombre(p.en_curso.fuente)} · {p.en_curso.quadkey}</span>
            <span className="h-1 flex-1 overflow-hidden rounded-[2px] bg-elevated">
              {/* En cuanto se conoce el total (Mapillary lo sabe antes de bajar
                  la primera foto), la franja pasa de "sigue viva" a una barra
                  de verdad — ya hay algo real que medir. */}
              {p.en_curso.objetivo > 0 ? (
                <i className="block h-full transition-[width] duration-300"
                  style={{ width: `${(p.en_curso.imagenes / p.en_curso.objetivo) * 100}%`, background: color(p.en_curso.fuente) }} />
              ) : (
                <i className="jg-barra-rayada block h-full w-full" style={{ color: color(p.en_curso.fuente) }} />
              )}
            </span>
            <span className="shrink-0 font-mono text-muted">
              {p.en_curso.objetivo > 0
                ? `${p.en_curso.imagenes} de ${p.en_curso.objetivo} fotos`
                : p.en_curso.imagenes > 0 ? `${p.en_curso.imagenes} fotos` : "resolviendo…"}
            </span>
          </div>
        )}

        <p className="mt-[22px] text-[8.5px] uppercase tracking-[.13em] text-subtle">Por origen</p>
        <table className="mt-2 w-full border-collapse text-[11.5px]">
          <tbody>
            {p.por_origen.map((l) => (
              <tr key={l.fuente} className="border-t border-border">
                <td className="w-[35%] py-2">
                  <span className="flex items-center gap-2.5">
                    <span className="h-[9px] w-[9px] rounded-full" style={{ background: color(l.fuente) }} />
                    {nombre(l.fuente)}
                  </span>
                </td>
                <td className="py-2">
                  <span className="block h-[5px] w-[150px] overflow-hidden rounded-[3px] bg-elevated">
                    <i className="block h-full"
                      style={{ width: `${l.total ? (l.hechas / l.total) * 100 : 0}%`, background: color(l.fuente) }} />
                  </span>
                </td>
                <td className="py-2 text-right font-mono text-muted">{l.hechas}/{l.total}</td>
                {/* En los de pago manda el euro; en los gratuitos el euro es
                    siempre 0,00 y lo que informa es cuánto material trajeron. */}
                <td className={`py-2 text-right font-mono ${l.coste_eur > 0 ? "text-warning-fg" : "text-subtle"}`}>
                  {l.coste_eur > 0 ? eur(l.coste_eur) : `${l.imagenes} fotos`}
                </td>
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

        {/* El mapa abajo, no arriba: lo de arriba son números que se leen de
            un vistazo; esto es lo que se mira mientras corre, de fondo. */}
        <div className="mt-[18px] min-h-0 flex-1 overflow-hidden rounded-lg border border-border">
          <DownloadMap teselas={p.teselas} />
        </div>

        {/* Bajar e indexar son dos colas separadas: una foto que acaba de
            llegar ya está en la de embebido, corriendo a su propio ritmo, no
            al de la descarga. Sin esto aquí, la única pista de que existe es
            una franja al pie de TODA la ventana — fácil de no ver, y que
            desaparece en cuanto la descarga termina y esta pantalla se deja. */}
        <div className="-mx-[22px] -mb-[20px] mt-[18px]">
          <IndexQueueBar indiceId={indiceId} />
        </div>
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
          onClick={() => { setDeteniendo(true); void api.descargaParar(); }}
          disabled={deteniendo}
          className="jg-press mt-5 w-full rounded-lg border border-border py-[7px] text-[11.5px] text-fg disabled:opacity-40"
        >
          {/* No para al momento: la tesela en curso termina antes de que el
              origen actual pare, y si hay más de un origen activo el
              siguiente ni llega a empezar. Sin este texto, ese hueco se lee
              como "no ha hecho nada". */}
          {deteniendo ? "Deteniendo… acaba la tesela en curso" : "Detener"}
        </button>
      </aside>
    </div>
  );
}
