import { Icon } from "./Icon";

/** La aprobación llega aquí, SIN diálogo que interrumpa: se enciende sin
 *  cortar lo que el usuario esté haciendo. El subsistema 3 la reutiliza para
 *  las notificaciones que el admin envía. */
export function Bell({ count, onClick }: { count: number; onClick: () => void }) {
  return (
    <button onClick={onClick} className="relative p-1 text-fg opacity-80 transition-opacity duration-300 ease-expo hover:opacity-100">
      <Icon name="bell" size={16} />
      {count > 0 && (
        <span className="absolute right-0.5 top-0.5 h-[6px] w-[6px] rounded-full bg-draw-fg"
          style={{ animation: "jg-core-pulse 1.8s ease-in-out infinite" }} />
      )}
    </button>
  );
}
