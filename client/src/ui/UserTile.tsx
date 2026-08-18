import { useState } from "react";
import { lumiUrl } from "../lib/bridge";

/** Monograma sobre superficie neutra — o la foto de perfil, si se pasa
 *  `userId` y hay una. El punto de conexión va FUERA de la caja y no la
 *  tiñe: un icono dentro de una caja de color es de las prohibiciones
 *  explícitas de DESIGN.md. */
export function UserTile({ nombre, conectado, size = 38, userId }: {
  nombre: string; conectado: boolean; size?: number; userId?: number;
}) {
  const ini = nombre.replace(/[^a-zA-Z]/g, "").slice(0, 2).toUpperCase();
  const [fallo, setFallo] = useState(false);
  const mostrarFoto = userId != null && !fallo;
  return (
    <span className="relative grid shrink-0 place-items-center overflow-hidden rounded-[11px] border border-border
      bg-elevated font-medium tracking-[-.02em] text-fg
      shadow-[inset_0_1px_0_rgba(255,255,255,.045)]"
      style={{ width: size, height: size, fontSize: size < 30 ? 9.5 : 13,
        borderRadius: size < 30 ? 7 : 11 }}>
      {mostrarFoto ? (
        <img src={lumiUrl(`/v1/users/${userId}/avatar`)} alt="" onError={() => setFallo(true)}
          className="h-full w-full object-cover" />
      ) : ini}
      <span className={`absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full ring-[2.5px]
        ring-panel ${conectado ? "bg-fg" : "bg-subtle"}`} />
    </span>
  );
}
