/** Pill de fase — el feature ya existe, esto no es un "próximamente". Mismo
 *  patrón visual que `AgentesVisual.tsx` (`web/`, marketing) para su badge de
 *  fase, adaptado a "beta" en vez de una fecha. */
export function BetaPill() {
  return (
    <span className="rounded-[5px] border border-dashed border-subtle/50 px-1.5 py-0.5
      font-mono text-[9px] text-subtle">
      beta
    </span>
  );
}
