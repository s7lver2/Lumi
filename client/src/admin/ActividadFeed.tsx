import { useEffect, useState } from "react";
import { api, type ActividadItem } from "../lib/api";
import { ago } from "../lib/time";

function texto(i: ActividadItem): string {
  switch (i.tipo) {
    case "cuenta_creada": return `${i.username} creó su cuenta`;
    case "analisis_resuelto": return `análisis #${i.id} ${i.estado === "hecho" ? "resuelto" : "con error"}`;
    case "aviso_publicado": return `aviso publicado — "${i.extracto}"`;
    case "solicitud_resuelta": return `solicitud de ${i.display_name} ${i.aprobada ? "aprobada" : "rechazada"}`;
  }
}

/** Se pide una vez al entrar, igual que el resto del Resumen — no hay
 *  sondeo continuo (ver spec, "Fuera de alcance"). */
export function ActividadFeed({ token }: { token: string }) {
  const [items, setItems] = useState<ActividadItem[] | null>(null);

  useEffect(() => {
    api.actividadGet(token).then(setItems).catch(() => setItems([]));
  }, [token]);

  return (
    <div className="mt-3 rounded-card border border-border p-3.5">
      <p className="text-[12.5px] text-fg">Actividad reciente</p>
      <p className="mb-3 text-[11px] text-muted">últimos eventos del servidor</p>

      {items === null && <p className="text-[11px] text-subtle">cargando</p>}
      {items?.length === 0 && <p className="text-[11px] text-subtle">nada todavía</p>}
      {items?.map((i, idx) => (
        <div key={idx}
          style={{ animation: `jg-fade-rise .5s ${Math.min(idx, 8) * 40}ms cubic-bezier(.16,1,.3,1) both` }}
          className="flex items-baseline gap-2 border-t border-border py-1.5 text-[11px] first:border-t-0">
          <span className="text-muted">{texto(i)}</span>
          <span className="ml-auto shrink-0 font-mono text-[9.5px] text-subtle">{ago(i.at)}</span>
        </div>
      ))}
    </div>
  );
}
