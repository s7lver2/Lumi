/** Carril + relleno, mismo patrón que ya usa el resto de la app para
 *  almacenamiento/VRAM (`ProjectPicker`, `TitleBar`) — no un componente
 *  nuevo, la misma pieza visual con datos de tope en vez de bytes. */
export function UsageBar({ etiqueta, usado, tope }: { etiqueta: string; usado: number; tope: number }) {
  const pct = tope > 0 ? Math.min(100, (usado / tope) * 100) : 0;
  return (
    <div className="flex items-center gap-3 text-[11px]">
      <span className="w-[70px] shrink-0 text-subtle">{etiqueta}</span>
      <span className="h-[3px] flex-1 overflow-hidden rounded-sm bg-elevated">
        <span className={`block h-full rounded-sm transition-[width] duration-700 ease-expo ${
          pct >= 100 ? "bg-warning" : "bg-fg"}`} style={{ width: `${pct}%` }} />
      </span>
      <span className="w-[64px] shrink-0 text-right font-mono text-[10.5px] text-muted">{usado} / {tope}</span>
    </div>
  );
}
