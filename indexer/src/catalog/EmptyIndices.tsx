import { Icon } from "../ui/Icon";

/** El fondo cuando no hay ni un índice todavía. Antes era una línea de texto
 *  perdida en una pantalla vacía; esto le da un sitio adonde mirar y un
 *  siguiente paso claro, aquí y en el selector que aparece al entrar en
 *  Territorio o Ingesta sin haber abierto uno. */
export function EmptyIndices({ onCrear }: { onCrear: () => void }) {
  return (
    <div className="lumi-anim flex flex-col items-center gap-3 py-10 text-center"
      style={{ animation: "jg-fade-rise 220ms cubic-bezier(.2,.85,.35,1) both" }}>
      <span className="grid h-14 w-14 place-items-center rounded-full border border-dashed border-border text-subtle">
        <Icon name="layers" size={22} />
      </span>
      <p className="text-[13px] text-fg">Vaya, por aquí no hay ningún índice todavía</p>
      <p className="max-w-[280px] text-[11px] leading-relaxed text-subtle">
        Un índice es donde vive el material de un área: sus imágenes, su procedencia y sus
        vectores. Crea el primero para empezar.
      </p>
      <button onClick={onCrear}
        className="jg-press mt-1.5 rounded-lg bg-accent px-4 py-2 text-[11.5px] font-medium text-black">
        + Crear el primer índice
      </button>
    </div>
  );
}
