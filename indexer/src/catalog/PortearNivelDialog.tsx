import { useEffect, useState } from "react";

import { api, type Nivel } from "../lib/api";

/** Mismo selector visual que `NewIndexDialog`, para portear un índice YA
 *  creado a otro nivel en vez de elegirlo por primera vez — subir de nivel
 *  solo añade los modelos que faltan (`indice_portear_nivel`, backend), nunca
 *  invalida lo ya embebido bajo el nivel anterior. Duplicado a propósito en
 *  vez de compartido con `NewIndexDialog`: son ~20 líneas y los dos flujos
 *  difieren en qué pasa al confirmar. */
export function PortearNivelDialog({ indiceId, onCancelar, onPorteado }: {
  indiceId: number;
  onCancelar: () => void;
  onPorteado: (modelosNuevos: string[]) => void;
}) {
  const [niveles, setNiveles] = useState<Nivel[]>([]);
  // Varios a la vez, no uno solo: el backend ya difea y encola solo lo que
  // falta de la unión (`indice_portear_nivel` recibe `Vec<String>`) — antes
  // esta pantalla solo dejaba elegir uno y envolvía en `[elegido]`, así que
  // portear a "mini y pro" a la vez exigía dos viajes por esta pantalla.
  const [elegidos, setElegidos] = useState<string[]>([]);
  const [porteando, setPorteando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // La respuesta del comando, no un booleano mudo: se enseña antes de
  // navegar, para que "portear" y "no hacía falta nada nuevo" no se vean
  // idénticos desde fuera.
  const [resultado, setResultado] = useState<string[] | null>(null);

  useEffect(() => { void api.nivelesLista().then(setNiveles); }, []);

  function alternar(id: string) {
    setElegidos((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  }

  async function confirmar() {
    if (elegidos.length === 0) return;
    setPorteando(true);
    setError(null);
    try {
      setResultado(await api.indicePortearNivel(indiceId, elegidos));
    } catch (e) {
      setError(String(e));
    } finally {
      setPorteando(false);
    }
  }

  return (
    <div className="w-[400px] rounded-card border border-white/[.13] bg-[rgba(16,19,25,.66)] p-[20px_22px] backdrop-blur-xl">
      <p className="text-sm text-fg">Portear a otro nivel</p>
      <p className="mt-1 text-[10.5px] leading-relaxed text-subtle">
        Puedes elegir varios a la vez — solo se encolan los modelos que falten de la unión de
        todos. Subir de nivel no pierde lo ya embebido; bajar no borra vectores ya calculados,
        solo dejan de exigirse.
      </p>

      {resultado === null && (
        <>
          <div className="mt-3.5 grid grid-cols-3 gap-1.5">
            {niveles.map((n) => (
              <button key={n.id} type="button" onClick={() => alternar(n.id)}
                aria-pressed={elegidos.includes(n.id)}
                className={`rounded-lg border px-3 py-2 text-left transition-colors
                  ${elegidos.includes(n.id) ? "border-draw bg-draw/[.08]" : "border-border bg-[#0b0d0f] hover:border-white/25"}`}>
                <span className="block text-[11.5px] text-fg">{n.nombre}</span>
                <span className="font-mono text-[9.5px] text-subtle">
                  {n.recuperacion.length} {n.recuperacion.length === 1 ? "modelo" : "modelos"}
                </span>
              </button>
            ))}
          </div>
          {error && <p className="mt-2 text-[10.5px] text-danger-fg">{error}</p>}

          <div className="mt-4 flex justify-end gap-2">
            <button onClick={onCancelar}
              className="jg-press rounded-lg border border-border px-4 py-2 text-[11.5px] text-fg">
              Cancelar
            </button>
            <button onClick={() => void confirmar()} disabled={elegidos.length === 0 || porteando}
              className="jg-press rounded-lg bg-accent px-4 py-2 text-[11.5px] font-medium text-black disabled:opacity-40">
              {porteando ? "Porteando…" : "Portear"}
            </button>
          </div>
        </>
      )}

      {resultado !== null && (
        <>
          <p className="mt-3.5 text-[11px] leading-relaxed text-fg">
            {resultado.length > 0
              ? <>Se encolaron para embeber: <span className="font-mono text-[10.5px]">{resultado.join(", ")}</span></>
              : "El índice ya tenía todos los modelos de este nivel — no hacía falta encolar nada nuevo."}
          </p>
          <div className="mt-4 flex justify-end">
            <button onClick={() => onPorteado(resultado)}
              className="jg-press rounded-lg bg-accent px-4 py-2 text-[11.5px] font-medium text-black">
              Ver progreso
            </button>
          </div>
        </>
      )}
    </div>
  );
}
