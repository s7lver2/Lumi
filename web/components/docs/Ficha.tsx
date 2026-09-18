import { registroCompleto } from "../../lib/registros";

export function Ficha({ id, ruta }: { id: string; ruta: string }) {
  const r = registroCompleto(id);
  const estado = r.alternativaNoActiva ? "alternativa no activa" : `activo · ${r.activoEnNiveles.join(", ")}`;

  const filas: { k: string; v: string; mono?: boolean }[] = [];
  if (r.tipo) filas.push({ k: "Tipo", v: r.tipo });
  if (r.licencia) filas.push({ k: "Licencia", v: r.licencia });
  if (r.ficheroPesos) filas.push({ k: "Pesos", v: r.ficheroPesos, mono: true });
  if (r.sha256) filas.push({ k: "Huella SHA-256", v: r.sha256, mono: true });
  filas.push({ k: "Estado", v: estado });

  return (
    <div className="mt-[26px] overflow-hidden rounded-card border border-border">
      <div className="flex items-center gap-[9px] border-b border-border bg-elevated px-[14px] py-[9px]">
        <span className="text-[9.5px] uppercase tracking-[.12em] text-subtle">Del registro</span>
        <span className="ml-auto font-mono text-[10px] text-subtle">{ruta}</span>
      </div>
      <div className="grid grid-cols-2 bg-panel">
        {filas.map((f, i) => (
          <div
            key={f.k}
            className={`border-b border-border px-[14px] py-[11px] ${i % 2 === 0 ? "border-r" : ""} ${
              i >= filas.length - (filas.length % 2 === 0 ? 2 : 1) ? "border-b-0" : ""
            }`}
          >
            <div className="text-[9px] uppercase tracking-[.11em] text-subtle">{f.k}</div>
            <div className={`mt-1 break-all text-[12px] leading-snug ${f.mono ? "font-mono text-muted" : "text-fg"}`}>{f.v}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
