import { Icon } from "../ui/Icon";

/** Rayas diagonales deslizándose despacio — la lectura visual es "cinta de
 *  obra en movimiento", no decoración: mientras se mueve, el modo sigue
 *  activo. Reutiliza `jg-alert-pulse` (ya existe en index.css) para el
 *  pulso del icono en vez de definir una animación nueva para eso. */
export function MantenimientoBanner({ mensaje }: { mensaje: string }) {
  return (
    <div
      className="relative flex shrink-0 items-center gap-2.5 border-b border-warning/25 px-4 py-2 text-[11px] text-warning-fg"
      style={{
        backgroundImage: "repeating-linear-gradient(135deg, rgba(239,159,39,.16) 0 10px, rgba(239,159,39,.05) 10px 20px)",
        backgroundColor: "rgba(239,159,39,.06)",
        animation: "jg-maint-stripes 3.5s linear infinite",
      }}
    >
      <span style={{ animation: "jg-alert-pulse 2.4s ease-in-out infinite" }}>
        <Icon name="alert" size={13} />
      </span>
      <b className="font-medium text-fg">Mantenimiento</b>
      <span className="truncate">{mensaje.trim() || "Servidor en mantenimiento."}</span>
    </div>
  );
}
