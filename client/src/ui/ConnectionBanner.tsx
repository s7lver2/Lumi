import { Icon } from "./Icon";

/** Banner de conectividad para usuarios normales (app/admin), distinto del
 *  `StatusOverlay` de página completa que usa el wizard del owner: aquí no
 *  hace falta un formulario de desbloqueo ni el detalle de un fallo de
 *  aprovisionamiento, solo saber que el servidor no responde ahora mismo. */
export function ConnectionBanner() {
  return (
    <div className="relative z-30 flex items-center justify-center gap-2 border-b border-warning/40 bg-warning/10 px-4 py-2 text-xs text-warning-fg"
      style={{ animation: "jg-fade-rise .4s both" }}>
      <Icon name="signal-off" size={13} />
      <span>Sin conexión con el servidor. Reintentando…</span>
    </div>
  );
}
