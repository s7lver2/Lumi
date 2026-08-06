import { Icon } from "../ui/Icon";

/** El stepper de burbujas de la v1, mismo vocabulario: hecho en blanco,
 *  en curso con el borde de `draw-fg`, pendiente en `subtle`. No hay verde. */
export function Stepper({ pasos, actual }: { pasos: string[]; actual: number }) {
  return (
    <div className="mb-[18px] flex items-center">
      {pasos.map((p, i) => (
        <div key={p} className="contents">
          {i > 0 && <span className="mb-5 h-px flex-1 bg-border" />}
          <div className="flex w-[104px] flex-col items-center gap-1.5">
            <span
              className={`grid h-[19px] w-[19px] place-items-center rounded-full text-[9.5px] ${
                i < actual
                  ? "bg-fg text-black"
                  : i === actual
                    ? "border border-draw-fg text-draw-fg"
                    : "border border-[#3a3e44] text-subtle"
              }`}
            >
              {i < actual ? <Icon name="check" size={11} /> : i + 1}
            </span>
            <span className={`text-[10.5px] ${i <= actual ? "text-fg" : "text-subtle"}`}>{p}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
