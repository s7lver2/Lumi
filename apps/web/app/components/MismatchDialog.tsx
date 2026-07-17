// apps/web/app/components/MismatchDialog.tsx
"use client";
import { FloatingCard } from "./FloatingCard";
import type { DatasetRelease } from "../lib/catalog-types";

export function MismatchDialog({
  release,
  onCancel,
  onConfirm,
}: {
  release: DatasetRelease;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/60">
      <FloatingCard className="w-[420px] p-5">
        <div className="text-[13.5px] font-medium text-fg">Modelo distinto al activo</div>
        <p className="mt-2.5 text-[12.5px] text-muted">
          Este dataset se construyó con <b className="text-fg">{release.model.id} v{release.model.version}</b>.
          Se instalarán las imágenes y puntos igualmente, y se completarán los embeddings automáticamente con tu
          modelo activo (sin volver a gastar cuota de Street View). El área aparecerá como &quot;indexando&quot; hasta que termine.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onCancel} className="rounded-md border border-white/15 px-4 py-2 text-xs text-fg hover:bg-white/10">
            Cancelar
          </button>
          <button onClick={onConfirm} className="rounded-md bg-accent px-4 py-2 text-xs font-medium text-black">
            Instalar y completar embeddings
          </button>
        </div>
      </FloatingCard>
    </div>
  );
}
