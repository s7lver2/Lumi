/** Monograma sobre superficie neutra. El punto de conexión va FUERA de la caja
 *  y no la tiñe: un icono dentro de una caja de color es de las prohibiciones
 *  explícitas de DESIGN.md. */
export function UserTile({ nombre, conectado, size = 38 }: {
  nombre: string; conectado: boolean; size?: number;
}) {
  const ini = nombre.replace(/[^a-zA-Z]/g, "").slice(0, 2).toUpperCase();
  return (
    <span className="relative grid shrink-0 place-items-center rounded-[11px] border border-border
      bg-elevated font-medium tracking-[-.02em] text-fg
      shadow-[inset_0_1px_0_rgba(255,255,255,.045)]"
      style={{ width: size, height: size, fontSize: size < 30 ? 9.5 : 13,
        borderRadius: size < 30 ? 7 : 11 }}>
      {ini}
      <span className={`absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full ring-[2.5px]
        ring-panel ${conectado ? "bg-fg" : "bg-subtle"}`} />
    </span>
  );
}
