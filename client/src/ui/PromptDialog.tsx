import { useState } from "react";
import { useDismissable } from "../lib/useDismissable";
import { Backdrop, FloatingCard, Pop } from "./FloatingCard";
import { centerInWorkspace } from "./layout";

/** Un popup para un solo campo de texto: crear un proyecto, un caso. Antes
 *  era un input que aparecía dentro de la lista y se confirmaba al perder el
 *  foco, que es exactamente el gesto que un clic accidental dispara sin
 *  querer. Aquí hace falta pulsar el botón o Intro, a propósito. */
export function PromptDialog({
  open, title, subtitle, placeholder, confirmLabel = "Crear", busy, error, chrome = false, onConfirm, onClose,
}: {
  open: boolean;
  title: string;
  subtitle?: string;
  placeholder: string;
  confirmLabel?: string;
  busy: boolean;
  error: string | null;
  /** `true` cuando se muestra dentro del espacio de trabajo (carril + barra
   *  superior encima): centra respecto al mapa visible, no a la ventana
   *  entera. El selector de proyectos no tiene ese cromo, así que no lo pide. */
  chrome?: boolean;
  onConfirm: (value: string) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState("");
  const { rendered, closing } = useDismissable(open, 180);
  if (!rendered) return null;

  const confirm = () => { if (value.trim()) onConfirm(value.trim()); };

  return (
    <>
      <Backdrop closing={closing} onClick={busy ? undefined : onClose} />
      <Pop closing={closing} style={chrome ? centerInWorkspace : { left: "50%", top: "50%" }}
        className="absolute z-[45] w-[360px] -translate-x-1/2 -translate-y-1/2">
        <FloatingCard className="p-5">
          <p className="text-[13px] text-fg">{title}</p>
          {subtitle && <p className="mt-1 text-[11px] leading-relaxed text-muted">{subtitle}</p>}
          <input autoFocus value={value} disabled={busy}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") confirm();
              if (e.key === "Escape") onClose();
            }}
            placeholder={placeholder}
            className="mt-3.5 w-full rounded-lg border border-border bg-[#0d0f12] px-3 py-2 text-[12.5px]
              text-fg outline-none transition-colors duration-300 ease-expo placeholder:text-subtle focus:border-white/40" />
          {error && <p className="mt-2.5 text-[11px] leading-snug text-danger-fg">{error}</p>}
          <div className="mt-4 flex justify-end gap-2">
            <button onClick={onClose} disabled={busy}
              className="jg-press rounded-lg border border-white/15 px-4 py-2 text-[11.5px] text-fg disabled:opacity-40">
              Cancelar
            </button>
            <button onClick={confirm} disabled={busy || !value.trim()}
              className="jg-press rounded-lg bg-accent px-4 py-2 text-[11.5px] font-medium text-black disabled:opacity-40">
              {busy ? "Un momento…" : confirmLabel}
            </button>
          </div>
        </FloatingCard>
      </Pop>
    </>
  );
}
