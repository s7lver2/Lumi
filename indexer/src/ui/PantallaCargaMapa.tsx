/** El hueco entre que se monta una pantalla con mapa y que llega el trozo
 *  diferido de `mapbox-gl` (1,8 MB que ya no viajan en el bundle principal).
 *  Mismo vocabulario que `Booting`: sin tarjeta de cristal, sin spinner
 *  genérico centrado en una caja — solo el estado, en el sitio donde va a
 *  aparecer el mapa. */
export function PantallaCargaMapa() {
  return (
    <div className="flex h-full w-full items-center justify-center gap-2.5">
      <svg
        width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth="1.8" strokeLinecap="round" className="text-subtle"
        style={{ animation: "lumi-spin 1s linear infinite" }}
      >
        <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      </svg>
      <span className="text-[11px] text-subtle">cargando mapa…</span>
    </div>
  );
}
