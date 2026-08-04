/** Círculo con la inicial, a falta de foto de perfil. Cuando exista un
 *  subsistema que las gestione, esta es la pieza que cambia por dentro: el
 *  mismo hueco de forma y tamaño, un `<img>` en vez de una letra. */
export function Avatar({ name, size = 19 }: { name: string; size?: number }) {
  const letter = name.trim().slice(0, 1).toUpperCase() || "?";
  return (
    <span
      style={{ width: size, height: size, fontSize: Math.round(size * 0.47) }}
      className="grid shrink-0 place-items-center rounded-full bg-elevated text-fg">
      {letter}
    </span>
  );
}
