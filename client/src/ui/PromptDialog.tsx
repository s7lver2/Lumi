import { useState } from "react";
import { useDismissable } from "../lib/useDismissable";
import { Backdrop, Pop } from "./FloatingCard";
import { Icon } from "./Icon";
import { Center } from "./layout";

/** Un popup para un solo campo: crear un proyecto, crear un caso. Todo lo
 *  demás —invitar, subir imágenes, elegir modelo— se decide después, dentro,
 *  donde se ve lo que estás decidiendo.
 *
 *  `taken` son los nombres que ya existen. El choque se avisa mientras
 *  escribes y apaga «Crear»: enterarte después de confirmar es enterarte
 *  tarde, y el servidor contestaría con un error donde bastaba con no dejar
 *  pulsar. */
export function PromptDialog({
  open, icon = "folder", title, subtitle, placeholder, confirmLabel = "Crear",
  taken = [], busy, error, chrome = false, onConfirm, onClose,
}: {
  open: boolean;
  icon?: "folder" | "pin";
  title: string;
  subtitle?: string;
  placeholder: string;
  confirmLabel?: string;
  taken?: string[];
  busy: boolean;
  error: string | null;
  /** `true` cuando se muestra dentro del espacio de trabajo (con el carril a
   *  la izquierda): centra respecto al lienzo visible, no a la ventana. */
  chrome?: boolean;
  onConfirm: (value: string) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState("");
  const { rendered, closing } = useDismissable(open, 180);
  if (!rendered) return null;

  const limpio = value.trim();
  const choca = taken.some((t) => t.trim().toLowerCase() === limpio.toLowerCase());
  const puede = limpio !== "" && !choca && !busy;
  const confirm = () => { if (puede) onConfirm(limpio); };

  return (
    <>
      <Backdrop closing={closing} onClick={busy ? undefined : onClose} />
      <Center chrome={chrome} className="z-[45]">
        <Pop closing={closing} className="w-[340px]">
          <div className="rounded-card border border-white/[.13] bg-[rgba(16,19,25,.92)] p-4
            shadow-lg shadow-black/50 backdrop-blur-xl">
            <div className="mb-3.5 flex items-center gap-2.5">
              <span className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-[9px]
                bg-white/[.06] text-fg">
                <Icon name={icon === "pin" ? "globe" : "folder"} size={15} />
              </span>
              <div className="min-w-0">
                <p className="truncate text-[12.5px] font-medium text-fg">{title}</p>
                {subtitle && <p className="truncate text-[10.5px] text-subtle">{subtitle}</p>}
              </div>
            </div>

            <input autoFocus value={value} disabled={busy}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") confirm();
                if (e.key === "Escape") onClose();
              }}
              placeholder={placeholder}
              className="w-full rounded-[9px] border border-border bg-[#0d0f12] px-[11px] py-[9px]
                text-[13px] text-fg outline-none transition-colors duration-300 ease-expo
                placeholder:text-subtle focus:border-white/40" />

            {choca && <p className="mt-1.5 text-[10.5px] text-warning-fg">ya existe uno con ese nombre</p>}
            {error && <p className="mt-1.5 text-[10.5px] leading-snug text-danger-fg">{error}</p>}

            <div className="mt-3.5 flex items-center gap-2">
              <span className="mr-auto font-mono text-[10px] text-[#4a4d52]">↵ crear · esc cancelar</span>
              <button onClick={onClose} disabled={busy}
                className="jg-press rounded-[9px] border border-white/15 px-3.5 py-[7px] text-[11.5px]
                  text-fg disabled:opacity-40">
                Cancelar
              </button>
              <button onClick={confirm} disabled={!puede}
                className="jg-press rounded-[9px] bg-accent px-4 py-[7px] text-[11.5px] font-medium
                  text-black disabled:opacity-40">
                {busy ? "Un momento…" : confirmLabel}
              </button>
            </div>
          </div>
        </Pop>
      </Center>
    </>
  );
}
