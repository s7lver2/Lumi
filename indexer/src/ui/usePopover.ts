import { useEffect, useRef, useState } from "react";

/** Cierra al pulsar fuera y con Escape. Mismo hook que `client/src/ui/TitleBar.tsx`. */
export function usePopover(): [boolean, (v: boolean) => void, React.RefObject<HTMLDivElement | null>] {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const fuera = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", fuera);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", fuera);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  return [open, setOpen, box];
}
