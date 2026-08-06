import type { Clasificacion } from "../lib/api";
import { Icon } from "../ui/Icon";

/** Se muestra cuando `c.nuevas === 0`: no hay un botón de indexar apagado
 *  porque aquí no hay trabajo que hacer, ni siquiera deshabilitado. */
export function BlockedDialog({
  c,
  onAjustar,
  onInstalar,
}: {
  c: Clasificacion;
  onAjustar: () => void;
  onInstalar: () => void;
}) {
  return (
    <div className="w-[420px] rounded-card border border-white/[.13] bg-[rgba(16,19,25,.66)] p-[22px] text-center backdrop-blur-xl">
      <div className="relative mx-auto grid h-[52px] w-[52px] place-items-center rounded-full bg-warning/[.08]">
        <Icon name="lock" size={32} className="text-warning-fg" />
      </div>
      <p className="mt-3 text-sm text-fg">Esta área ya está toda indexada</p>
      <p className="mt-1.5 text-[11px] leading-relaxed text-muted">
        {c.locales} teselas ya están en este equipo y {c.catalogo} las cubre alguien más. No queda
        ni una tesela nueva: no hay nada que cueste GPU aquí.
      </p>

      {c.autores.length > 0 && (
        <div className="mt-3 flex flex-col gap-1 text-left">
          {c.autores.map(([autor, n]) => (
            <div key={autor} className="flex items-center justify-between rounded-lg border border-border px-2.5 py-1.5 text-[10.5px]">
              <span className="truncate text-muted">{autor}</span>
              <span className="font-mono text-fg">{n} teselas</span>
            </div>
          ))}
        </div>
      )}

      <p className="mt-[13px] flex items-start gap-[7px] text-left text-[10.5px] leading-snug text-subtle">
        <Icon name="info" size={12} className="mt-px shrink-0" />
        Si crees que el material existente está desfasado, amplía la selección o pide una
        recaptura desde el detalle de la tesela. Lo que no hay es un botón de rehacerlo porque sí.
      </p>

      <div className="mt-4 flex justify-center gap-2">
        <button onClick={onAjustar} className="jg-press rounded-lg border border-border px-4 py-2 text-[11.5px] text-fg">
          Ajustar el área
        </button>
        <button onClick={onInstalar} className="jg-press rounded-lg bg-accent px-4 py-2 text-[11.5px] font-medium text-black">
          Instalar lo que existe
        </button>
      </div>
    </div>
  );
}
