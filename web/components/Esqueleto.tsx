export function Esqueleto({ titulo, nota }: { titulo: string; nota: string }) {
  return (
    <main className="mx-auto max-w-[1180px] px-7 pb-24 pt-32">
      <h1 className="text-[clamp(26px,3.4vw,38px)] font-semibold tracking-tight">{titulo}</h1>
      <p className="mt-3 max-w-[62ch] leading-relaxed text-muted">{nota}</p>
      <p className="mt-8 font-mono text-[11px] text-subtle">esta página todavía no tiene contenido</p>
    </main>
  );
}
