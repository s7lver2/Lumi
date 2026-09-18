export function Esquema({ etiqueta, children }: { etiqueta: string; children: React.ReactNode }) {
  return (
    <div className="mt-7 rounded-card border border-border bg-panel px-5 pb-[18px] pt-[22px]">
      <div className="font-mono text-[9.5px] uppercase tracking-[.12em] text-subtle">{etiqueta}</div>
      <div className="mt-[18px]">{children}</div>
    </div>
  );
}
