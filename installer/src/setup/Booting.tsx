/** El hueco entre abrir la ventana y que llegue el primer `saludo()`. Mismo
 *  vocabulario que `SetupWizard` (brandline ✦, sin versión todavía porque es
 *  justo lo que `saludo` trae) pero sin tarjeta de cristal: no hay contenido
 *  que enmarcar, solo un estado, y una tarjeta con una sola línea dentro
 *  sería la tarjeta-con-una-cosa que el propio DESIGN.md descarta. */
export function Booting() {
  return (
    <div className="relative z-10 flex w-[552px] items-center gap-2.5" style={{ animation: "jg-fade-rise .7s both" }}>
      <span className="text-[15px] text-fg">✦</span>
      <span className="text-[17px] font-medium text-fg">Lumi Indexer</span>
      <svg
        width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth="1.8" strokeLinecap="round" className="ml-1 text-subtle"
        style={{ animation: "lumi-spin 1s linear infinite" }}
      >
        <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      </svg>
    </div>
  );
}
