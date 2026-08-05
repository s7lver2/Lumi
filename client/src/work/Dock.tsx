import type { Analysis, Image } from "../lib/api";
import { lumiUrl } from "../lib/bridge";
import { useReorder } from "../lib/useReorder";

/** En qué anda cada imagen. `null` es «nadie la ha analizado todavía». */
export type ImgState = "pendiente" | "en_curso" | "hecho" | "error" | null;

/** La tira de miniaturas, el resumen del resultado y la acción principal, en
 *  una sola franja de 56 px.
 *
 *  Antes eran tres piezas flotando sobre el mapa por su cuenta —tira, barra de
 *  resumen y un botón de «Analizar esta imagen» que aparecía y desaparecía—.
 *  Juntas ocupan menos y, sobre todo, la acción está siempre en el mismo sitio.
 *
 *  El orden de la tira se cambia arrastrando y se recuerda en este equipo: el
 *  servidor no guarda ninguna columna de orden y no se la inventa el cliente. */
export function Dock({
  images, selected, stateOf, queueOf, summary, primaryLabel, busy, rightInset,
  onSelect, onAdd, onPrimary,
}: {
  images: Image[];
  selected: number | null;
  stateOf: (imageId: number) => ImgState;
  /** Puesto en la cola, 1 el primero. `null` si no está esperando. */
  queueOf: (imageId: number) => number | null;
  summary: { analysis: Analysis | null; image: Image | null; caseName: string };
  primaryLabel: string;
  busy: boolean;
  rightInset: number;
  onSelect: (id: number) => void;
  onAdd: () => void;
  onPrimary: () => void;
}) {
  const orden = useReorder(`case-imgs`, images, "x");
  const { analysis, image, caseName } = summary;
  const hecho = analysis?.state === "hecho";

  const linea1 = image
    ? hecho
      ? `${image.filename} · ${analysis!.result_lat!.toFixed(6)}, ${analysis!.result_lng!.toFixed(6)}`
      : image.filename
    : caseName;
  const linea2 = hecho
    ? `${analysis!.model} · confianza ${(analysis!.result_confidence ?? 0).toFixed(2)} · radio ${
        Math.round(analysis!.result_radius_m ?? 0)} m`
    : analysis?.state === "error"
      ? analysis.error ?? "el análisis falló y no dejó motivo"
      : analysis
        ? "esperando al motor de inferencia"
        : image
          ? "sin analizar"
          : null;

  return (
    <div style={{ right: rightInset }}
      className="absolute bottom-0 left-0 z-20 flex h-[56px] items-center gap-2.5 border-t border-border
        bg-[rgba(13,15,17,.84)] px-2.5 backdrop-blur-md transition-[right] duration-[420ms] ease-expo">
      <div className="flex min-w-0 items-center gap-1.5 overflow-x-auto">
        {orden.items.map((im) => (
          <Thumb key={im.id} image={im} on={im.id === selected}
            state={stateOf(im.id)} queue={queueOf(im.id)}
            drag={orden.drag(im.id)}
            onClick={() => { if (!orden.dragging) onSelect(im.id); }} />
        ))}
        <button onClick={onAdd} title="Añadir imágenes" aria-label="Añadir imágenes"
          className="jg-press grid h-[38px] w-[38px] shrink-0 place-items-center rounded-[8px]
            border border-dashed border-white/[.16] text-[13px] leading-none text-subtle hover:text-fg">
          +
        </button>
      </div>

      <div className="ml-1 min-w-0 flex-1">
        <p className="truncate text-[11.5px] text-fg">{linea1}</p>
        {linea2 && <p className="truncate text-[10px] text-subtle">{linea2}</p>}
      </div>

      <button onClick={onPrimary} disabled={busy}
        className="jg-press shrink-0 rounded-[9px] bg-accent px-3.5 py-2 text-[11.5px] font-medium
          text-black disabled:opacity-40">
        {busy ? "Un momento…" : primaryLabel}
      </button>
    </div>
  );
}

function Thumb({ image, on, state, queue, drag, onClick }: {
  image: Image;
  on: boolean;
  state: ImgState;
  queue: number | null;
  drag: ReturnType<ReturnType<typeof useReorder>["drag"]>;
  onClick: () => void;
}) {
  const trabajando = state === "en_curso";
  const enCola = state === "pendiente";
  const fallo = state === "error";
  const tapada = trabajando || enCola || fallo;

  return (
    <button {...drag} onClick={onClick} title={`${image.filename}${
      trabajando ? " · analizando" : enCola ? " · en cola" : fallo ? " · el análisis falló" : ""}`}
      className={`group relative h-[38px] w-[38px] shrink-0 cursor-grab overflow-hidden rounded-[8px]
        border transition-[transform,border-color,box-shadow] duration-300 ease-expo
        hover:-translate-y-[3px] active:cursor-grabbing
        data-[dragging]:rotate-[-4deg] data-[dragging]:scale-90 data-[dragging]:opacity-40
        ${fallo ? "border-danger/70" : on ? "border-fg shadow-[0_0_0_1px_theme(colors.fg)]" : "border-border hover:border-white/25"}`}>
      <img src={lumiUrl(`/v1/images/${image.id}/thumb`)} alt=""
        className="h-full w-full bg-elevated object-cover" />

      {tapada && (
        <span className={`absolute inset-0 backdrop-blur-[2.5px] ${
          fallo ? "bg-[rgba(30,12,12,.5)]" : "bg-[rgba(10,12,14,.34)]"}`} />
      )}

      {/* El daemon no informa de cuánto lleva hecho un análisis (la cola es el
          subsistema 4), así que no hay barra: una que avanzase sola estaría
          inventándose el dato. Un punto que late dice «trabajando» sin mentir. */}
      {trabajando && (
        <span className="absolute right-1 top-1 h-[4px] w-[4px] rounded-full bg-fg"
          style={{ animation: "jg-live 1.5s cubic-bezier(.16,1,.3,1) infinite" }} />
      )}

      {enCola && (
        <>
          <span className="absolute inset-0 overflow-hidden">
            <span className="absolute inset-0"
              style={{
                background: "linear-gradient(105deg,transparent 38%,rgba(255,255,255,.11) 50%,transparent 62%)",
                animation: "jg-sweep-x 1.9s linear infinite",
              }} />
          </span>
          <span className="absolute inset-0 grid place-items-center font-mono text-[9px] text-muted">
            {queue !== null ? `${queue}ª` : ""}
          </span>
        </>
      )}

      {fallo && (
        <span className="absolute inset-0 grid place-items-center text-[13px] leading-none text-danger-fg">!</span>
      )}
    </button>
  );
}
