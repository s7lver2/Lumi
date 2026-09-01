import { useEffect, useState } from "react";

import { api, type Modelo, type ProgresoCola, type ProgresoIndiceEmbed, type ProgresoPesos, type ResumenIndice } from "../lib/api";
import { Icon } from "../ui/Icon";

/** El progreso de embebido de ESTE índice — no el de la cola entera. Pedir
 *  el índice al entrar (en vez de mostrar los ocho modelos de golpe, de
 *  cualquier índice que tuviera trabajo pendiente) es lo que faltaba: antes
 *  se veía todo lo que la cola estuviera haciendo en ese instante, sin haber
 *  elegido nada, que es justo lo que sorprendía. */
export function EmbedQueueView({ indiceId, onCambiarIndice }: {
  indiceId: number; onCambiarIndice: () => void;
}) {
  const [filas, setFilas] = useState<ProgresoIndiceEmbed[]>([]);
  const [cola, setCola] = useState<ProgresoCola[]>([]);
  const [modelos, setModelos] = useState<Modelo[]>([]);
  const [indices, setIndices] = useState<ResumenIndice[]>([]);
  const [pesos, setPesos] = useState<ProgresoPesos | null>(null);
  const [descargando, setDescargando] = useState<string | null>(null);
  const nombreIndice = indices.find((i) => i.id === indiceId)?.nombre ?? `índice ${indiceId}`;

  useEffect(() => {
    const tick = () => void api.indiceProgresoEmbebido(indiceId).then(setFilas);
    tick();
    const t = setInterval(tick, 1200);
    return () => clearInterval(t);
  }, [indiceId]);

  useEffect(() => {
    const tick = () => void api.colaProgreso().then(setCola);
    tick();
    const t = setInterval(tick, 3000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => { void api.modelosLista().then(setModelos); }, []);
  useEffect(() => { void api.indicesLista().then(setIndices); }, []);

  useEffect(() => {
    if (!descargando) return;
    const tick = () => void api.modeloPesosProgreso().then((p) => {
      setPesos(p);
      if (p?.terminado) setDescargando(null);
    });
    tick();
    const t = setInterval(tick, 800);
    return () => clearInterval(t);
  }, [descargando]);

  const visibles = filas.filter((p) => p.total > 0);
  const pausada = cola.some((p) => p.pausada);
  const hayTrabajo = cola.some((p) => p.indice_total > 0 || p.trabajando);
  // Antes de esto, un modelo esperando a Qdrant se veía IDÉNTICO a uno
  // trabajando de verdad: "0/32" para siempre, sin ninguna pista de que el
  // problema es Qdrant y no la cola en sí.
  const esperandoQdrant = cola.some((p) => p.esperando_qdrant);

  async function alternar() {
    await api.colaPausar(!pausada);
    setCola(await api.colaProgreso());
  }

  async function descargarPesos(modeloId: string) {
    setDescargando(modeloId);
    setPesos(null);
    try {
      await api.modeloPesosDescargar(modeloId);
    } catch (e) {
      setPesos({ modelo_id: modeloId, pct: 0, mib: 0, total_mib: 0, terminado: true, error: String(e), registro: [] });
      setDescargando(null);
    }
  }

  return (
    <div className="mx-auto flex h-full max-w-[820px] flex-col gap-3 overflow-y-auto p-8">
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <p className="text-sm text-fg">Embebido</p>
          <button onClick={onCambiarIndice} className="jg-press text-[10.5px] text-subtle hover:text-fg">
            «{nombreIndice}» · cambiar índice
          </button>
        </div>
        {cola.length > 0 && (
          <button onClick={() => void alternar()}
            className={`jg-press rounded-lg border px-3 py-1.5 text-[11px] ${
              pausada && hayTrabajo ? "border-white/30 bg-white/[.08] text-fg" : "border-border text-fg"
            }`}>
            {pausada ? "Arrancar embebido" : "Pausar embebido"}
          </button>
        )}
      </div>

      {esperandoQdrant && (
        <div className="rounded-lg border border-warning/40 bg-warning/[.08] px-3.5 py-2.5">
          <p className="text-[11px] leading-relaxed text-warning-fg">
            Qdrant no responde todavía — el embebido no puede avanzar sin él.
            Ve a Ajustes → Servicios locales y comprueba que esté levantado.
          </p>
        </div>
      )}

      {visibles.length === 0 && (
        <div className="mt-6 flex flex-col items-center gap-2 text-center text-muted">
          <Icon name="embebido" size={22} />
          <p className="max-w-[38ch] text-[11.5px] leading-relaxed">
            Este índice no tiene ningún modelo con trabajo pendiente ni hecho todavía.
          </p>
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        {visibles.map((p) => {
          const pctIndice = p.total ? Math.round((p.hechas / p.total) * 100) : 0;
          const modelo = modelos.find((m) => m.id === p.modelo_id);
          const puedeDescargar = modelo && !modelo.puerta && modelo.fichero_url;
          return (
            <div key={p.modelo_id} className="rounded-lg border border-border bg-panel px-3.5 py-2.5">
              <div className="flex items-center gap-2.5">
                <span className="w-24 shrink-0 truncate font-mono text-[11px] text-fg">{p.modelo_id}</span>
                <span className="min-w-0 flex-1 truncate text-right text-[10.5px] text-muted">
                  {p.esperando_qdrant
                    ? "esperando a Qdrant…"
                    : p.pausada
                      ? "en pausa"
                      : p.activo
                        ? `lote ${p.lote_hechas}/${p.lote_total}`
                        : p.hechas >= p.total
                          ? "completo"
                          : "en espera de su turno"}
                </span>
              </div>
              <div className="mt-2 h-[3px] overflow-hidden rounded-sm bg-elevated">
                <div className="h-full bg-fg transition-[width] duration-500" style={{ width: `${pctIndice}%` }} />
              </div>
              <div className="mt-1.5 flex items-center justify-between font-mono text-[9.5px] text-subtle">
                <span>{pctIndice}%</span>
                <span>{p.hechas} de {p.total}</span>
              </div>
              {p.guardado_fallos > 0 && (
                <p className="mt-1.5 font-mono text-[9.5px] text-warning-fg">{p.guardado_fallos} sin subir</p>
              )}
              {p.ultimo_fallo && (
                <div className="mt-1.5">
                  <p className="text-[9.5px] leading-relaxed text-danger-fg">{p.ultimo_fallo}</p>
                  {puedeDescargar && (() => {
                    // `pesos` describe el ÚLTIMO intento de este modelo, no
                    // solo el que está en curso ahora mismo — `descargando`
                    // se limpia en cuanto `terminado` llega, y si el botón
                    // dependiera de esa bandera el error/log recién llegado
                    // desaparecía en el mismo instante en que aparecía: la
                    // pantalla volvía al botón "Descargar pesos" de golpe,
                    // sin dar tiempo a leer qué había pasado.
                    const esteIntento = pesos?.modelo_id === p.modelo_id ? pesos : null;
                    const enCurso = descargando === p.modelo_id;
                    if (!esteIntento) {
                      return (
                        <button onClick={() => void descargarPesos(p.modelo_id)}
                          className="jg-press mt-1.5 rounded-lg border border-border px-2.5 py-1 text-[10px] text-fg">
                          Descargar pesos
                        </button>
                      );
                    }
                    return (
                      <div className="mt-1.5">
                        {enCurso && (
                          <>
                            <div className="h-[3px] overflow-hidden rounded-sm bg-elevated">
                              <div className="h-full bg-fg transition-[width] duration-500"
                                style={{ width: `${esteIntento.pct}%` }} />
                            </div>
                            <p className="mt-1 font-mono text-[9.5px] text-subtle">
                              descargando pesos… {esteIntento.mib}/{esteIntento.total_mib || "?"} MiB
                            </p>
                          </>
                        )}
                        {esteIntento.error && <p className="mt-1 text-[9.5px] text-danger-fg">{esteIntento.error}</p>}
                        {!!esteIntento.registro.length && (
                          <pre className="mt-1.5 max-h-[110px] overflow-auto whitespace-pre-wrap rounded-lg
                            border border-border bg-[#08090b] px-2 py-1.5 font-mono text-[9px] text-muted">
                            {esteIntento.registro.slice(-15).join("\n")}
                          </pre>
                        )}
                        {esteIntento.terminado && (
                          <button onClick={() => void descargarPesos(p.modelo_id)}
                            className="jg-press mt-1.5 rounded-lg border border-border px-2.5 py-1 text-[10px] text-fg">
                            {esteIntento.error ? "Reintentar" : "Descargar de nuevo"}
                          </button>
                        )}
                      </div>
                    );
                  })()}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
