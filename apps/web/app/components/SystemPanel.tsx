// apps/web/app/components/SystemPanel.tsx
"use client";
import { useState } from "react";
import { FloatingCard } from "./FloatingCard";
import { ResetConfirmDialog } from "./ResetConfirmDialog";

export function SystemPanel() {
  const [resetOpen, setResetOpen] = useState(false);
  const [resetStatus, setResetStatus] = useState<string | null>(null);

  return (
    <div className="space-y-4">
      <FloatingCard className="flex items-center justify-between p-5">
        <div>
          <div className="text-sm font-medium text-fg">Volver a ejecutar el setup</div>
          <p className="mt-1 text-xs text-muted">
            Reinstala dependencias, migra la base de datos o cambia credenciales paso a paso.
          </p>
        </div>
        <a href="/setup" className="rounded-md border border-white/15 px-4 py-2 text-xs text-fg hover:bg-white/10">
          Abrir setup
        </a>
      </FloatingCard>

      <FloatingCard className="flex items-center justify-between border-[rgba(163,51,51,0.35)] bg-[rgba(163,51,51,0.04)] p-5">
        <div>
          <div className="text-sm font-medium text-danger-fg">Restablecer configuración</div>
          <p className="mt-1 text-xs text-muted">
            Borra todos los datos de la aplicación y restaura los modelos originales. Se guarda una copia de
            seguridad local antes de borrar. No se puede deshacer.
          </p>
          {resetStatus && <p className="mt-1 text-xs text-muted">{resetStatus}</p>}
        </div>
        <button
          onClick={() => setResetOpen(true)}
          className="rounded-md border border-[rgba(163,51,51,0.5)] bg-[rgba(163,51,51,0.15)] px-4 py-2 text-xs font-medium text-danger-fg hover:bg-[rgba(163,51,51,0.25)]"
        >
          Restablecer…
        </button>
      </FloatingCard>

      {resetOpen && (
        <ResetConfirmDialog
          onClose={() => setResetOpen(false)}
          onDone={() => setResetStatus("Configuración restablecida")}
        />
      )}
    </div>
  );
}