import { useEffect, useState } from "react";
import { api, type ProjectImage } from "../lib/api";
import { lumiUrl } from "../lib/bridge";
import { useServer } from "../lib/store";
import { FloatingCard } from "../ui/FloatingCard";
import { Icon } from "../ui/Icon";
import { Center } from "../ui/layout";

const GB = 1024 * 1024 * 1024;
const size = (b: number) =>
  b < GB ? `${Math.round(b / 1024 / 1024)} MB` : `${(b / GB).toFixed(1)} GB`;

type Tab = "images" | "project";

/** Un caso vacío no es un mapa mudo: es una invitación a soltar fotos. Es la
 *  pieza de la v1 (`MapDropTarget`) que faltaba entera, y sin ella la única
 *  forma de empezar era el «+» de la tira de miniaturas, que no dice nada.
 *
 *  La v1 tenía una tercera pestaña, "Enlace": pegar una URL y que el servidor
 *  la trajera. Se queda fuera aquí a propósito — el daemon tendría que salir
 *  a buscar lo que sea que haya en esa URL, y sin una lista blanca de
 *  dominios eso es la puerta de entrada a un SSRF. No es una pieza que falte
 *  por prisa, es una que hay que diseñar aparte. */
export function DropTarget({
  dragging, busy, freeBytes, projectId, caseId, onPick, onReuse,
}: {
  dragging: boolean;
  busy: boolean;
  freeBytes: number | null;
  projectId: number;
  caseId: number;
  onPick: () => void;
  onReuse: (imageIds: number[]) => void;
}) {
  const [tab, setTab] = useState<Tab>("images");
  const token = useServer((s) => s.token) ?? undefined;
  const [gallery, setGallery] = useState<ProjectImage[] | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (tab !== "project" || gallery !== null) return;
    api.get<ProjectImage[]>(`/v1/projects/${projectId}/images`, token)
      .then((all) => setGallery(all.filter((im) => im.case_id !== caseId)))
      .catch(() => setGallery([]));
  }, [tab, gallery, projectId, caseId, token]);

  function toggle(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  return (
    <Center className="z-20">
    <div className="w-[330px]" style={{ animation: "jg-popup-scale-in 240ms cubic-bezier(.2,.85,.35,1) both" }}>
      <FloatingCard className={`overflow-hidden transition-colors duration-300 ease-expo ${
        dragging ? "border-white/40" : ""
      }`}>
        {tab === "images" && (
          <div className="p-[24px] text-center">
            {/* La bandeja respira despacio y se abre en abanico al acercarte:
                el mismo gesto que la pila de las filas de casos. Explicar por
                escrito que se puede arrastrar sobraba — la bandeja ya lo dice. */}
            <span className="group relative mx-auto mb-3.5 block h-[34px] w-[46px]">
              {[0, 1, 2].map((i) => (
                <span key={i}
                  className={`absolute inset-0 rounded-[7px] border bg-[linear-gradient(140deg,#2c323a,#171a1e)]
                    transition-transform duration-[450ms] ease-expo ${
                      dragging ? "border-white/40" : "border-white/[.14]"} ${
                      i === 0 ? "opacity-45" : i === 1 ? "opacity-70" : ""}`}
                  style={{
                    animation: dragging ? undefined : `jg-float 3.6s cubic-bezier(.16,1,.3,1) ${i * 0.28}s infinite`,
                    transform: dragging
                      ? ["translate(-13px,-8px) rotate(-11deg)", "translate(0,-11px)", "translate(13px,-8px) rotate(11deg)"][i]
                      : undefined,
                  }} />
              ))}
            </span>
            <p className="text-[13px] font-medium text-fg">
              {dragging ? "Suelta aquí" : "Suelta imágenes aquí"}
            </p>
            <button onClick={onPick} disabled={busy}
              className="jg-press mt-3.5 rounded-lg bg-accent px-4 py-2 text-[11.5px] font-medium text-black disabled:opacity-50">
              {busy ? "Subiendo…" : "Del disco…"}
            </button>
            <p className="mt-3 flex items-center justify-center gap-1 font-mono text-[9.5px] text-subtle">
              <Icon name="cloud" size={11} />
              {freeBytes !== null ? `${size(Math.max(0, freeBytes))} libres` : "JPG · PNG · WEBP"}
            </p>
          </div>
        )}

        {tab === "project" && (
          <div className="p-[14px_14px_11px]">
            {gallery === null ? (
              <p className="py-7 text-center text-[11px] text-subtle">cargando</p>
            ) : gallery.length === 0 ? (
              <p className="py-7 text-center text-[11px] leading-relaxed text-subtle">
                Ningún otro caso de este proyecto tiene imágenes todavía.
              </p>
            ) : (
              <>
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-[10.5px] font-medium text-fg">{gallery.length} imágenes en el proyecto</span>
                  <span className="text-[10px] text-muted">{selected.size} seleccionadas</span>
                </div>
                <div className="grid max-h-[190px] grid-cols-4 gap-[7px] overflow-y-auto">
                  {gallery.map((im) => (
                    <button key={im.id} onClick={() => toggle(im.id)} title={`${im.filename} · ${im.case_name}`}
                      className={`relative aspect-square overflow-hidden rounded-md border-2 bg-elevated
                        transition-transform duration-200 ease-expo hover:scale-[1.05] ${
                          selected.has(im.id) ? "border-fg" : "border-white/15"
                        }`}>
                      <img src={lumiUrl(`/v1/images/${im.id}/thumb`)} alt=""
                        className="h-full w-full object-cover" />
                      {selected.has(im.id) && (
                        <span className="absolute left-0.5 top-0.5 flex h-3.5 w-3.5 items-center justify-center
                          rounded-sm bg-accent text-[8px] text-black">
                          <Icon name="check" size={9} />
                        </span>
                      )}
                    </button>
                  ))}
                </div>
                <button onClick={() => { onReuse([...selected]); setSelected(new Set()); }}
                  disabled={selected.size === 0 || busy}
                  className="jg-press mt-2.5 w-full rounded-lg bg-accent py-1.5 text-[11px] font-medium
                    text-black disabled:opacity-40">
                  {busy ? "Un momento…" : `Usar seleccionadas (${selected.size})`}
                </button>
              </>
            )}
          </div>
        )}

        <div className="flex gap-1 border-t border-white/[.08] p-1.5">
          <TabBtn on={tab === "images"} onClick={() => setTab("images")} icon="image" label="Imágenes" />
          <TabBtn on={tab === "project"} onClick={() => setTab("project")} icon="layers" label="De este proyecto" />
        </div>
      </FloatingCard>
    </div>
    </Center>
  );
}

function TabBtn({ on, onClick, icon, label }: {
  on: boolean; onClick: () => void; icon: "image" | "layers"; label: string;
}) {
  return (
    <button onClick={onClick}
      className={`jg-press flex flex-1 items-center justify-center gap-1.5 rounded-lg py-1.5 text-[10.5px]
        ${on ? "bg-white/[.06] font-medium text-fg" : "text-muted hover:text-fg"}`}>
      <Icon name={icon} size={12} className={on ? "text-fg" : "text-subtle"} />
      {label}
    </button>
  );
}

/** Marco punteado sobre toda el área de trabajo mientras hay algo encima del
 *  ratón. Sin esto, arrastrar sobre un caso que ya tiene imágenes no daba
 *  ninguna señal de que soltar fuera a servir de algo. */
export function DropFrame() {
  return (
    <div className="pointer-events-none absolute bottom-0 left-11 right-0 top-[38px] z-[35] m-3.5
      rounded-[14px] border border-dashed border-white/25 bg-white/[.02]"
      style={{ animation: "jg-backdrop-in 140ms ease both" }} />
  );
}
