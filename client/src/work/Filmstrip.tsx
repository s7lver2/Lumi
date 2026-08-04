import type { Image } from "../lib/api";
import { lumiUrl } from "../lib/bridge";
import { FloatingCard } from "../ui/FloatingCard";

export function Filmstrip({
  images, selected, onSelect, onAdd, shifted,
}: {
  images: Image[];
  selected: number | null;
  onSelect: (id: number) => void;
  onAdd: () => void;
  /** La barra lateral de resultados ya no está siempre. Cuando está, la tira
   *  tiene 250 px menos de sitio antes de meterse debajo. */
  shifted?: boolean;
}) {
  const i = images.findIndex((im) => im.id === selected);
  return (
    <FloatingCard className="absolute bottom-[58px] left-[56px] z-20 flex items-center gap-1.5 p-[7px]"
      style={{ maxWidth: shifted ? "calc(100% - 330px)" : "calc(100% - 90px)" }}>
      <div className="flex gap-1.5 overflow-x-auto">
        {images.map((im, n) => (
          <button key={im.id} onClick={() => onSelect(im.id)} title={im.filename}
            style={{ animation: `jg-fade-rise 200ms ${Math.min(n, 10) * 22}ms cubic-bezier(.16,1,.3,1) both` }}
            className={`jg-press h-[33px] w-[44px] shrink-0 overflow-hidden rounded-[5px] border ${
              selected === im.id ? "border-fg" : "border-white/10 hover:border-white/25"
            }`}>
            <img src={lumiUrl(`/v1/images/${im.id}/thumb`)} alt=""
              className="h-full w-full bg-elevated object-cover" />
          </button>
        ))}
      </div>
      <button onClick={onAdd} title="Añadir imágenes" aria-label="Añadir imágenes"
        className="jg-press grid h-[33px] w-[44px] shrink-0 place-items-center rounded-[5px]
          border border-dashed border-white/[.16] text-[13px] leading-none text-subtle hover:text-fg">
        +
      </button>
      {images.length > 0 && (
        <span className="shrink-0 px-1.5 font-mono text-[9.5px] text-subtle">
          {i < 0 ? images.length : `${i + 1} / ${images.length}`}
        </span>
      )}
    </FloatingCard>
  );
}
