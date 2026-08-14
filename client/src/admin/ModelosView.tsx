import { useEffect, useState } from "react";
import { api, type MetaPeso, type NivelEstado } from "../lib/api";
import { Seccion } from "./AdminPanel";
import { LicenciasGate } from "./LicenciasGate";

export function ModelosView({ token, nivelInicial, onLicenciasPendientesChange }: {
  token: string; nivelInicial?: string; onLicenciasPendientesChange?: (p: boolean) => void;
}) {
  const [niveles, setNiveles] = useState<NivelEstado[] | null>(null);
  const [abierto, setAbierto] = useState<string | null>(nivelInicial ?? null);
  const [error, setError] = useState<string | null>(null);
  const [metadatos, setMetadatos] = useState<MetaPeso[]>([]);
  const [completando, setCompletando] = useState<{ nivel: string; items: MetaPeso[] } | null>(null);

  function cargarNiveles() {
    api.get<NivelEstado[]>("/v1/admin/models", token).then(setNiveles).catch((e) => setError(String(e)));
  }

  useEffect(() => { cargarNiveles(); }, [token]);
  useEffect(() => {
    api.get<MetaPeso[]>("/v1/admin/models/metadata", token).then(setMetadatos).catch(() => {});
  }, [token]);

  useEffect(() => {
    onLicenciasPendientesChange?.(completando !== null);
  }, [completando, onLicenciasPendientesChange]);

  return (
    <Seccion titulo="Modelos e inferencia" grupo="Servidor">
      {error && <p className="text-[11px] text-danger-fg">{error}</p>}
      {niveles === null && !error && <p className="text-[11px] text-muted">cargando</p>}

      <div className="flex flex-col gap-3">
        {(niveles ?? []).map((n) => {
          const total = n.resolucion.recuperacion_total + n.resolucion.geometricos_total;
          const instalado = n.resolucion.recuperacion_instalados + n.resolucion.geometricos_instalados;
          const completo = n.resolucion.faltan.length === 0;
          const abiertoAqui = abierto === n.id;
          return (
            <div key={n.id}
              className={`rounded-[11px] border bg-panel transition-colors duration-[400ms] ease-expo
                ${abiertoAqui ? "border-white/20" : "border-border hover:border-white/[.16]"}`}>
              <button onClick={() => setAbierto(abiertoAqui ? null : n.id)}
                className="grid w-full grid-cols-[1fr_auto] items-center gap-3.5 px-[15px] py-[13px] text-left">
                <div>
                  <h4 className="flex items-center gap-2.5 text-[13.5px] font-medium">
                    {n.nombre}
                    <span className={`rounded-[5px] border px-1.5 py-px text-[8.5px] tracking-[.05em]
                      ${completo ? "border-white/[.28] text-fg" : "border-warning/40 text-warning-fg"}`}>
                      {completo ? "listo" : `falta ${n.resolucion.faltan.length}`}
                    </span>
                  </h4>
                  <div className="mt-[3px] text-[10.5px] text-muted">
                    {n.resolucion.recuperacion_total} recuperadores · {n.resolucion.geometricos_total} verificadores
                  </div>
                  <div className="mt-[9px] h-[3px] overflow-hidden rounded-sm bg-elevated">
                    <div className="h-full bg-fg transition-[width] duration-1000 ease-expo"
                      style={{ width: `${total ? Math.round((instalado / total) * 100) : 100}%` }} />
                  </div>
                </div>
                {!completo && (
                  <button onClick={(e) => {
                    e.stopPropagation();
                    const pendientes = metadatos.filter((m) => n.resolucion.faltan.includes(m.id));
                    setCompletando({ nivel: n.id, items: pendientes });
                  }} className="rounded-lg bg-accent px-3 py-1.5 text-[11px] font-medium text-black">
                    Completar {n.nombre}
                  </button>
                )}
              </button>

              <div className={`grid transition-[grid-template-rows] duration-[550ms] ease-expo
                ${abiertoAqui ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}>
                <div className="overflow-hidden">
                  <div className="border-t border-border px-[15px] py-3">
                    <p className="text-[10.5px] text-subtle">
                      {n.resolucion.faltan.length === 0
                        ? "Todo instalado en este nivel."
                        : `Falta: ${n.resolucion.faltan.join(", ")}`}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {completando && (
        <div className="mt-4">
          <LicenciasGate token={token} items={completando.items}
            onListo={() => { setCompletando(null); cargarNiveles(); }} />
        </div>
      )}
    </Seccion>
  );
}
