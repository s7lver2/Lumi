import { useEffect, useState } from "react";
import { api, type AgenteVista, type Analysis, type Image } from "../lib/api";
import { Backdrop, FloatingCard, Pop } from "../ui/FloatingCard";
import { Icon } from "../ui/Icon";
import { Center } from "../ui/layout";
import { AgenteIcono } from "./AgenteIcono";

/** Elegir agente, como popup — antes esto era la primera pantalla de
 *  `AgentesView` (pantalla completa). El owner probó la 2.0.35 en producción
 *  y pidió que la elección fuera un popup, mismo lenguaje visual que
 *  `UploadPopup`: se abre al pulsar «Analizar» con `model === "agentes"`, y
 *  al lanzar hace el mismo POST que antes hacía `AgentesView.lanzar()`.
 *
 *  También se reabre desde el propio `AgentesView` («Elegir otro agente»):
 *  por eso no depende de `UploadPopup` para nada más que su estilo. */
export function AgentPickerPopup({
  token, caseId, image, isAdmin, closing, onLaunched, onClose, onIrAModelos,
}: {
  token: string | undefined;
  caseId: number;
  image: Image;
  isAdmin: boolean;
  closing: boolean;
  onLaunched: (analyses: Analysis[]) => void;
  onClose: () => void;
  onIrAModelos: () => void;
}) {
  const [agentes, setAgentes] = useState<AgenteVista[] | null>(null);
  const [seleccionados, setSeleccionados] = useState<Set<string>>(new Set());
  const [lanzando, setLanzando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<AgenteVista[]>("/v1/agentes", token).then(setAgentes).catch((e) => setError(String(e)));
  }, [token]);

  function alternar(id: string) {
    setSeleccionados((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  // Uno por uno, no en paralelo: cada agente cuenta como su propia solicitud
  // en cola (límites diarios/semanales incluidos), y lanzarlos secuencialmente
  // es lo que hace honesto "añadidos uno por uno a la cola" en vez de una
  // ráfaga simultánea. Con más de uno seleccionado se les da un `grupo_id`
  // compartido para que la barra lateral los enseñe como un solo intento --
  // con exactamente uno, se omite y el comportamiento es idéntico al de
  // siempre (misma petición, sin campo de más).
  async function lanzar() {
    if (seleccionados.size === 0) return;
    setLanzando(true);
    setError(null);
    const ids = [...seleccionados];
    const grupo_id = ids.length > 1 ? crypto.randomUUID() : undefined;
    const lanzadas: Analysis[] = [];
    try {
      for (const agente of ids) {
        const a = await api.post<Analysis>(
          `/v1/cases/${caseId}/analyses`,
          { image_ids: [image.id], model: "agentes", agente, grupo_id },
          token,
        );
        lanzadas.push(a);
      }
      onLaunched(lanzadas);
    } catch (e) {
      setError(String(e));
      setLanzando(false);
    }
  }

  return (
    <>
      <Backdrop closing={closing} onClick={lanzando ? undefined : onClose} />
      <Center className="z-[55]">
        <Pop closing={closing} className="w-[540px]">
          <FloatingCard className="p-[17px]">
            <div className="flex items-center gap-2.5">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white/[.06] text-fg">
                <Icon name="globe" size={15} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <p className="text-[13px] font-medium text-fg">Elegir agente</p>
                  <BetaPill />
                </div>
                <p className="text-[11px] text-muted">Una o varias preguntas cerradas a la imagen</p>
              </div>
              <button onClick={onClose} disabled={lanzando} aria-label="Cerrar"
                className="jg-press shrink-0 text-subtle hover:text-fg disabled:opacity-40">
                <Icon name="x" size={13} />
              </button>
            </div>

            <RejillaAgentes agentes={agentes} seleccionados={seleccionados} onAlternar={alternar}
              isAdmin={isAdmin} onIrAModelos={onIrAModelos} />

            {error && (
              <div className="mt-3 flex items-start gap-2">
                <Icon name="alert" size={12} className="mt-px shrink-0 text-danger-fg" />
                <p className="text-[10.5px] leading-snug text-muted">{error}</p>
              </div>
            )}

            <div className="mt-4 flex items-center justify-end gap-2.5">
              {seleccionados.size > 1 && (
                <p className="text-[10.5px] text-subtle">
                  {seleccionados.size} solicitudes, un solo intento
                </p>
              )}
              <button onClick={() => void lanzar()} disabled={seleccionados.size === 0 || lanzando}
                className="jg-press rounded-lg bg-accent px-5 py-2 text-[11.5px] font-medium text-black
                  disabled:opacity-40">
                {lanzando ? "Un momento…" : seleccionados.size > 1 ? `Lanzar ${seleccionados.size} agentes` : "Lanzar agente"}
              </button>
            </div>
          </FloatingCard>
        </Pop>
      </Center>
    </>
  );
}

/** Etiqueta corta para una sub-pregunta, tanto en la rejilla del picker
 *  ("clima · tiempo · estación · vegetación" bajo el nombre de la tarjeta)
 *  como agrupando el resultado (`AgentResultPopup`). Un id sin entrada aquí
 *  se enseña tal cual — nunca se inventa una palabra para uno que no está en
 *  esta lista, solo se acorta el que sí. */
const ETIQUETAS_CORTAS: Record<string, string> = {
  "clima-aparente": "clima",
  "meteorologia": "tiempo",
  "estacion": "estación",
  "vegetacion": "vegetación",
  "lado-conduccion": "conducción",
  "senalizacion": "señales",
  "matricula": "matrícula",
  "idioma": "idioma",
  "toponimos": "texto",
};
export function etiquetaCortaDe(subId: string): string {
  return ETIQUETAS_CORTAS[subId] ?? subId;
}

/** Pill de fase — el feature ya existe, esto no es un "próximamente". Mismo
 *  patrón visual que `AgentesVisual.tsx` (`web/`, marketing) para su badge de
 *  fase, adaptado a "beta" en vez de una fecha. */
export function BetaPill() {
  return (
    <span className="rounded-[5px] border border-dashed border-subtle/50 px-1.5 py-0.5
      font-mono text-[9px] text-subtle">
      beta
    </span>
  );
}

function RejillaAgentes({ agentes, seleccionados, onAlternar, isAdmin, onIrAModelos }: {
  agentes: AgenteVista[] | null;
  seleccionados: Set<string>;
  onAlternar: (id: string) => void;
  isAdmin: boolean;
  onIrAModelos: () => void;
}) {
  if (!agentes) {
    return <p className="mt-5 text-[12px] text-muted">Cargando el registro…</p>;
  }
  if (agentes.length === 0) {
    return <p className="mt-5 text-[12px] text-muted">Este servidor no trae ningún agente.</p>;
  }
  return (
    <div className="mt-4 grid max-h-[380px] grid-cols-2 gap-2 overflow-y-auto pr-0.5">
      {agentes.map((a) => {
        const on = seleccionados.has(a.id);
        return (
          <div key={a.id}
            onClick={() => a.instalado && onAlternar(a.id)}
            className={`flex gap-2.5 rounded-xl border p-3 transition-colors duration-300 ease-expo
              ${a.instalado ? "jg-press cursor-pointer" : "cursor-default hover:border-white/20"}
              ${on ? "border-fg bg-white/[.06]" : "border-border bg-panel"}`}>
            <div className="shrink-0 pt-0.5">
              <AgenteIcono agente={a.id} apagado={!a.instalado} size={18} />
            </div>
            <div className="min-w-0 flex-1">
              <div className={`text-[12.5px] font-medium ${a.instalado ? "text-fg" : "text-muted"}`}>{a.nombre}</div>
              {a.sub_preguntas.length > 0 ? (
                // Agente fusionado (spec 2026-09-10 §1): la pregunta de
                // nivel superior es el JSON compuesto entero, ilegible en
                // una tarjeta — se enseñan sus sub-preguntas en su lugar.
                <p className={`mt-0.5 truncate text-[10.5px] ${a.instalado ? "text-muted" : "text-subtle"}`}>
                  {a.sub_preguntas.map(etiquetaCortaDe).join(" · ")}
                </p>
              ) : (
                <p className={`mt-0.5 truncate text-[10.5px] ${a.instalado ? "text-muted" : "text-subtle"}`}>
                  {a.pregunta || "Mira la imagen sin preguntar."}
                </p>
              )}
              {!a.instalado && (
                <div className="mt-1.5 flex items-center gap-2">
                  <span className="font-mono text-[9.5px] text-subtle">requiere {a.requiere ?? "un motor"}</span>
                  {isAdmin && (
                    <button onClick={(e) => { e.stopPropagation(); onIrAModelos(); }}
                      className="jg-press rounded-md border border-white/15 px-1.5 py-0.5 text-[9.5px] text-fg
                        hover:border-fg">
                      Descargar
                    </button>
                  )}
                </div>
              )}
            </div>
            {on && <Icon name="check" size={12} className="shrink-0 self-start text-fg" />}
          </div>
        );
      })}
    </div>
  );
}
