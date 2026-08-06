import { useEffect, useState } from "react";

import { api, type DetalleIndice, type LoteResumen } from "../lib/api";
import { SealDialog } from "../seal/SealDialog";
import { Icon } from "../ui/Icon";
import { ProvenanceTable } from "./ProvenanceTable";

export function IndexDetail({ id, onVolver }: { id: number; onVolver: () => void }) {
  const [detalle, setDetalle] = useState<DetalleIndice | null>(null);
  const [lotes, setLotes] = useState<LoteResumen[]>([]);
  const [sellando, setSellando] = useState(false);

  useEffect(() => {
    void api.indiceDetalle(id).then(setDetalle);
    void api.indiceLotes(id).then(setLotes);
  }, [id]);

  if (!detalle) return null;

  return (
    <div className="mx-auto flex h-full max-w-[980px] flex-col gap-5 overflow-y-auto p-8">
      <div className="flex items-center justify-between">
        <button onClick={onVolver} className="flex w-fit items-center gap-1.5 text-[11px] text-subtle hover:text-fg">
          <Icon name="back" size={11} /> Índices
        </button>
        <button onClick={() => setSellando(true)}
          className="jg-press rounded-lg border border-border px-3 py-1.5 text-[11px] text-fg">
          Sellar
        </button>
      </div>

      {sellando && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40">
          <SealDialog indiceId={id} nombre={String(id)} onSellado={() => setSellando(false)} />
        </div>
      )}

      <div className="grid grid-cols-[1fr_260px] gap-6">
        <ProvenanceTable p={detalle.imagenes} trabajo={detalle.trabajo} />

        <div>
          <p className="mb-2 text-[10.5px] uppercase tracking-[.08em] text-subtle">Lotes</p>
          <div className="flex flex-col gap-1.5">
            {lotes.length === 0 && <p className="text-[11px] text-subtle">sin lotes todavía</p>}
            {lotes.map((l) => (
              <div key={l.id} className="rounded-lg border border-border px-2.5 py-2 text-[11px]">
                <div className="flex items-center justify-between">
                  <span className="text-fg">{l.clase}</span>
                  <span className={`rounded-full border px-1.5 py-px text-[9px] ${
                    l.estado === "hecho" ? "border-border text-subtle"
                      : l.estado === "error" ? "border-danger text-danger-fg"
                        : "border-draw-fg text-draw-fg"}`}>
                    {l.estado}
                  </span>
                </div>
                <p className="mt-1 truncate font-mono text-[9.5px] text-subtle">{l.origen}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
