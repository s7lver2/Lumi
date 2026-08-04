/** Cristal sobre el mapa: translúcido y con desenfoque, nunca opaco. Es la
 *  pieza que da su carácter a la v1 y a las referencias de Raven, y estaba
 *  copiada a mano en cada panel del subsistema 6 con valores ligeramente
 *  distintos. Una sola definición evita que se vayan separando. */
export function FloatingCard({
  className = "", style, onClick, children,
}: {
  className?: string;
  style?: React.CSSProperties;
  onClick?: (e: React.MouseEvent) => void;
  children: React.ReactNode;
}) {
  return (
    <div onClick={onClick} style={style}
      className={`rounded-card border border-white/10 bg-[rgba(24,26,30,.82)] shadow-lg shadow-black/40 backdrop-blur-md ${className}`}>
      {children}
    </div>
  );
}

/** Fondo oscuro de un diálogo modal, con su entrada y su salida. */
export function Backdrop({ closing, onClick }: { closing: boolean; onClick?: () => void }) {
  return (
    <div onClick={onClick}
      className="absolute inset-0 z-40 bg-black/55 backdrop-blur-[2px]"
      style={{ animation: `${closing ? "jg-backdrop-out" : "jg-backdrop-in"} 180ms ease both` }} />
  );
}

/** Envoltorio con la escala de entrada/salida de la v1. */
export function Pop({ closing, className = "", children }:
  { closing: boolean; className?: string; children: React.ReactNode }) {
  return (
    <div className={className}
      style={{ animation: `${closing ? "jg-popup-scale-out" : "jg-popup-scale-in"} 180ms cubic-bezier(.2,.85,.35,1) both` }}>
      {children}
    </div>
  );
}
