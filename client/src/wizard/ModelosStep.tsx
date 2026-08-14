import { useEffect, useState } from "react";
import { api, type NivelEstado } from "../lib/api";

/** Solo un resumen de estado, no el instalador — descargar pesos, aceptar
 *  licencias y ver el progreso es un flujo que necesita sitio (la rejilla de
 *  licencias, la puerta del proveedor) y ese sitio es el panel, no la tarjeta
 *  estrecha del asistente. Aquí solo se dice qué falta y adónde ir. */
export function ModelosStep({ token }: { token: string }) {
  const [niveles, setNiveles] = useState<NivelEstado[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<NivelEstado[]>("/v1/admin/models", token)
      .then(setNiveles)
      .catch((e) => setError(String(e)));
  }, [token]);

  return (
    <div>
      <p className="mb-4 max-w-[52ch] text-[11px] leading-[1.7] text-muted">
        Los pesos se descargan y sus licencias se aceptan desde{" "}
        <b className="text-fg">Administración → Modelos</b>, una vez termines aquí. No hace
        falta completar ninguno para seguir.
      </p>

      {error && <p className="text-[11px] text-danger-fg">{error}</p>}
      {niveles === null && !error && <p className="text-[11px] text-muted">cargando</p>}

      <div className="flex flex-col gap-2">
        {(niveles ?? []).map((n) => {
          const completo = n.resolucion.faltan.length === 0;
          return (
            <div key={n.id}
              className="flex items-center justify-between gap-3 rounded-[10px] border border-border bg-panel px-[13px] py-[10px]">
              <span className="text-[11.5px] text-fg">{n.nombre}</span>
              <span className={`rounded-[5px] border px-1.5 py-px text-[8.5px] tracking-[.05em]
                ${completo ? "border-white/[.28] text-fg" : "border-warning/40 text-warning-fg"}`}>
                {completo ? "listo" : `falta ${n.resolucion.faltan.length}`}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
