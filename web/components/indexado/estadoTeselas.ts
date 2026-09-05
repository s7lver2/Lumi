/** Mismo código de color que `indexer/src/territory/MapCanvas.tsx` usa de
 *  verdad sobre el lienzo — la web recrea el estado real de una tesela, no
 *  un semáforo inventado para la ocasión. Compartido por el hero, la
 *  sección de territorio y la de reclamos. */
export type EstadoTesela = "local" | "catalogo" | "nueva" | "reclamada";

export const COLOR_TESELA: Record<EstadoTesela, { fill: string; stroke?: string; dash?: string }> = {
  local: { fill: "rgba(232,232,230,.13)" },
  catalogo: { fill: "rgba(55,138,221,.16)" },
  reclamada: { fill: "rgba(239,159,39,.14)", stroke: "rgba(239,159,39,.45)" },
  nueva: { fill: "rgba(255,255,255,.02)", stroke: "rgba(232,232,230,.14)", dash: "2 2" },
};
