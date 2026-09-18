"use client";

import { useEffect, useState } from "react";
import { useProfundidad } from "./ContextoProfundidad";

export function Detalle({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  const [abierto, setAbierto] = useState(false);
  const { senal, valor } = useProfundidad();

  useEffect(() => {
    if (senal > 0) setAbierto(valor);
    // Solo reacciona a cambios de senal (el pulso del control global), no a
    // valor por sí solo — de lo contrario un Detalle abierto a mano se
    // cerraría cada vez que otro componente lee el contexto.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [senal]);

  return (
    <div className="mt-[22px] rounded-card border border-border bg-panel">
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        className="jg-micro flex w-full items-center gap-[9px] px-[14px] py-[11px] text-left"
      >
        <span
          className="block h-2 w-2 border-b-[1.3px] border-r-[1.3px] border-subtle transition-transform duration-200"
          style={{ transform: abierto ? "rotate(45deg)" : "rotate(-45deg)" }}
        />
        <b className="text-[11.5px] font-normal text-muted">{titulo}</b>
      </button>
      {abierto && <div className="border-t border-border px-[14px] pb-[14px] pt-[13px] text-[12.5px] leading-relaxed text-muted">{children}</div>}
    </div>
  );
}
