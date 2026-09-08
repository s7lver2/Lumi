/** Lo que se ve mientras `App` resuelve la sesión guardada (reconectar con
 *  el servidor, comprobar `/v1/auth/me`) antes de saber a qué pantalla
 *  aterrizar. Antes ese hueco era `null`: la barra de título y el planeta
 *  ya estaban montados, pero el centro se quedaba vacío sin ninguna señal
 *  de que algo estuviera pasando. Mismo vocabulario que `Pane` en
 *  `entry/EntryScreen.tsx` (el ✦ que respira, mismo ritmo de aparición). */
export function LoadingScreen() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2.5"
      style={{ animation: "jg-fade-rise .5s both" }}>
      <span className="text-lg text-fg" style={{ animation: "jg-lock-breathe 2.4s ease-in-out infinite" }}>✦</span>
      <span className="text-[11px] text-subtle">cargando…</span>
    </div>
  );
}
