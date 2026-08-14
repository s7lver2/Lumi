/** Una sección que todavía no existe. Una frase de qué será y en qué ciclo,
 *  y nada más: la pantalla no justifica decisiones, eso está en la spec. */
const QUE: Record<string, { titulo: string; grupo: string; ciclo: string; que: string }> = {
  mantenimiento: {
    titulo: "Mantenimiento", grupo: "Operación", ciclo: "ciclo 3c",
    que: "Poner el servidor en MAINTENANCE sin pararlo.",
  },
  notificaciones: {
    titulo: "Notificaciones", grupo: "Operación", ciclo: "ciclo 3c",
    que: "Avisos escritos por el administrador para quien esté conectado.",
  },
  hardware: {
    titulo: "Hardware", grupo: "Operación", ciclo: "ciclo 3c",
    que: "Dispositivos, VRAM y temperaturas con su histórico.",
  },
};

export function Hueco({ seccion }: { seccion: string }) {
  const d = QUE[seccion];
  if (!d) return null;
  return (
    <div className="px-6 pb-8 pt-5">
      <span className="mb-1.5 block text-[8.5px] uppercase tracking-[.15em] text-subtle">{d.grupo}</span>
      <div className="flex items-end gap-3 border-b border-border pb-[11px]">
        <h2 className="text-[21px] font-medium leading-none tracking-[-.025em]">{d.titulo}</h2>
        <span className="ml-auto pb-0.5 text-[10.5px] text-subtle">{d.ciclo}</span>
      </div>
      <div className="mt-[18px] max-w-[620px] rounded-[11px] border border-dashed border-border p-[24px_22px]">
        <h3 className="mb-[7px] flex items-center gap-2.5 text-[12.5px] font-medium">
          Todavía no está
          <span className="rounded-[5px] border border-border px-1.5 py-px text-[8.5px]
            tracking-[.05em] text-subtle">pronto</span>
        </h3>
        <p className="text-[11px] leading-[1.75] text-muted">{d.que}</p>
      </div>
    </div>
  );
}