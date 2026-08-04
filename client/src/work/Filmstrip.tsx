import type { Image } from "../lib/api";
import { lumiUrl } from "../lib/bridge";

export function Filmstrip({
  images, selected, onSelect, onAdd,
}: {
  images: Image[];
  selected: number | null;
  onSelect: (id: number) => void;
  onAdd: () => void;
}) {
  return (
    <div className="absolute bottom-[46px] left-[50px] z-20 flex gap-1.5 rounded-card border border-white/10 bg-[rgba(24,26,30,.93)] p-1.5 shadow-lg shadow-black/40 backdrop-blur">
      {images.map((im) => (
        <button key={im.id} onClick={() => onSelect(im.id)} title={im.filename}
          className={`h-[30px] w-[40px] overflow-hidden rounded border transition-colors duration-300 ease-expo ${
            selected === im.id ? "border-fg" : "border-white/10 hover:border-white/25"
          }`}>
          <img src={lumiUrl(`/v1/images/${im.id}/thumb`)} alt="" className="h-full w-full object-cover" />
        </button>
      ))}
      <button onClick={onAdd} title="Añadir imágenes"
        className="h-[30px] w-[40px] rounded border border-dashed border-white/15 text-[13px] leading-none text-subtle hover:text-fg">
        +
      </button>
    </div>
  );
}
