import { useEffect, useState } from "react";
import { lumiUrl } from "../lib/bridge";
import { useServer } from "../lib/store";

/** Círculo con la inicial, a falta de foto de perfil — o la foto en sí, si
 *  se pasa `userId` y `/v1/users/:id/avatar` responde. `onError` cae de
 *  vuelta a las iniciales sin que nadie tenga que comprobar antes si existe
 *  una foto: un 404 no es un error que mostrar, es la señal de "todavía sin
 *  foto". */
export function Avatar({ name, size = 19, userId }: { name: string; size?: number; userId?: number }) {
  const letter = name.trim().slice(0, 1).toUpperCase() || "?";
  const [fallo, setFallo] = useState(false);
  // `avatarVersion` (store.ts) cambia cuando la propia foto se sube o se
  // borra: sin volver a intentar aquí, una instancia que ya había visto un
  // 404 (sin foto todavía) se quedaba mostrando la inicial para siempre,
  // aunque ahora sí exista una foto — nada la avisaba de que lo intentara
  // otra vez.
  const version = useServer((s) => s.avatarVersion);
  useEffect(() => setFallo(false), [userId, version]);
  const mostrarFoto = userId != null && !fallo;
  return (
    <span
      style={{ width: size, height: size, fontSize: Math.round(size * 0.47) }}
      className="grid shrink-0 place-items-center overflow-hidden rounded-full bg-elevated text-fg">
      {mostrarFoto ? (
        <img src={lumiUrl(`/v1/users/${userId}/avatar?v=${version}`)} alt="" onError={() => setFallo(true)}
          className="h-full w-full object-cover" />
      ) : letter}
    </span>
  );
}
