import { useEffect, useState } from "react";
import { api, type ColaboracionSettings } from "../lib/api";
import { Seccion } from "./Seccion";

const DEFECTO_LIBERAR_MIN = 30;

/** «Colaboración»: los cuatro ajustes que gobiernan el candado de caso de
 *  Darkroom -- Parte 4 del spec 2026-09-19. Son globales, no por proyecto:
 *  no hay ningún otro ámbito de configuración en todo el repo salvo global
 *  (`meta`) o por usuario (`limits`), y abrir un tercero por cuatro
 *  interruptores sería una puerta grande por una razón pequeña. */
export function ColaboracionView({ token, ajustes, onCambiar }: {
  token: string; ajustes: ColaboracionSettings | null; onCambiar: (s: ColaboracionSettings) => void;
}) {
  const [minutos, setMinutos] = useState(String(DEFECTO_LIBERAR_MIN));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (ajustes) setMinutos(String(Math.round(ajustes.caso_liberar_s / 60)));
  }, [ajustes?.caso_liberar_s]);

  async function fijar(patch: Partial<ColaboracionSettings>) {
    setError(null);
    try {
      const r = await api.patch<ColaboracionSettings>("/v1/admin/colaboracion", patch, token);
      onCambiar(r);
    } catch (e) {
      setError(String(e));
    }
  }

  async function guardarPlazo() {
    const min = Number(minutos);
    if (!Number.isFinite(min) || min < 1 || min > 1440) {
      setError("debe ser un número de minutos entre 1 y 1440");
      return;
    }
    await fijar({ caso_liberar_s: Math.round(min * 60) });
  }

  if (!ajustes) return null;

  return (
    <Seccion titulo="Colaboración" grupo="Servidor">
      <p className="text-[11px] text-muted">Quién puede compartir un caso, y qué pasa cuando alguien se va sin avisar.</p>

      <div className="mt-4 rounded-card border border-border bg-panel">
        <Fila titulo="Exclusividad de caso" sub="Una sola persona a la vez dentro de cada caso. Apagado, varias personas pueden abrirlo a la vez."
          on={ajustes.caso_exclusivo} onClick={() => void fijar({ caso_exclusivo: !ajustes.caso_exclusivo })} />
      </div>

      <div className="mt-3 rounded-card border border-border bg-panel p-[13px_16px]">
        <label className="mb-1.5 block text-[9.5px] uppercase tracking-[.06em] text-muted">
          Plazo de liberación por inactividad
        </label>
        <div className="flex items-center gap-1.5">
          <input value={minutos} onChange={(e) => setMinutos(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void guardarPlazo(); }}
            inputMode="numeric"
            className="w-16 rounded-lg border border-border bg-elevated px-2 py-1 text-right font-mono text-[11px]
              text-fg outline-none transition-colors duration-300 ease-expo focus:border-white/40" />
          <span className="text-[10.5px] text-subtle">min</span>
          <button onClick={() => void guardarPlazo()}
            disabled={Number(minutos) === Math.round(ajustes.caso_liberar_s / 60)}
            className="jg-press ml-1 rounded-lg border border-white/15 px-2.5 py-1 text-[10.5px] text-fg disabled:opacity-40">
            Guardar
          </button>
        </div>
      </div>

      <div className="mt-3 rounded-card border border-border bg-panel p-[13px_16px]">
        <label className="mb-1.5 block text-[9.5px] uppercase tracking-[.06em] text-muted">Quién puede expulsar</label>
        <select value={ajustes.caso_expulsar_rol}
          onChange={(e) => void fijar({ caso_expulsar_rol: e.target.value as ColaboracionSettings["caso_expulsar_rol"] })}
          className="w-full rounded-lg border border-border bg-elevated px-2.5 py-[7px] text-[11.5px] text-fg
            outline-none transition-colors duration-300 ease-expo focus:border-white/40">
          <option value="admin">Solo administradores</option>
          <option value="admin_o_dueno">Administradores y el dueño del proyecto</option>
          <option value="cualquier_miembro">Cualquier miembro del proyecto</option>
        </select>
      </div>

      <div className="mt-3 rounded-card border border-border bg-panel p-[13px_16px]">
        <label className="mb-1.5 block text-[9.5px] uppercase tracking-[.06em] text-muted">
          Tope de personas por proyecto
        </label>
        <div className="flex items-center gap-1.5">
          <input value={ajustes.proyecto_max_personas}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (Number.isFinite(v) && v >= 0) void fijar({ proyecto_max_personas: Math.round(v) });
            }}
            inputMode="numeric"
            className="w-16 rounded-lg border border-border bg-elevated px-2 py-1 text-right font-mono text-[11px]
              text-fg outline-none transition-colors duration-300 ease-expo focus:border-white/40" />
          <span className="text-[10.5px] text-subtle">personas simultáneas (0 = sin tope)</span>
        </div>
      </div>

      {error && <p className="mt-2 text-[10.5px] text-danger-fg">{error}</p>}
    </Seccion>
  );
}

function Fila({ titulo, sub, on, onClick }: { titulo: string; sub: string; on: boolean; onClick: () => void }) {
  return (
    <div className="flex items-center gap-3.5 border-b border-border p-[13px_16px] last:border-b-0">
      <button onClick={onClick}
        className={`relative h-[21px] w-9 shrink-0 cursor-pointer rounded-full border transition-colors duration-300 ease-expo ${
          on ? "border-white/30 bg-white/[.14]" : "border-border bg-elevated"}`}>
        <span className={`absolute left-[2px] top-[2px] h-[15px] w-[15px] rounded-full transition-transform duration-300 ease-expo ${
          on ? "translate-x-[15px] bg-fg" : "bg-subtle"}`} />
      </button>
      <div className="min-w-0">
        <p className="text-[12px] text-fg">{titulo}</p>
        <p className="mt-0.5 text-[10px] text-subtle">{sub}</p>
      </div>
    </div>
  );
}
