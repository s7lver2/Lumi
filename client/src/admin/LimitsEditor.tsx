import { useState } from "react";
import { api, type Limits } from "../lib/api";
import { KNOWN_MODELS } from "../lib/models";
import { Icon } from "../ui/Icon";

/** Las 9 palancas, con su tipo — decide qué control sale por fila. Mismo
 *  orden que `limits::KEYS` en el servidor. */
const PALANCAS: [key: keyof Limits, etiqueta: string, tipo: "bool" | "num" | "modelos"][] = [
  ["models", "Modelos", "modelos"],
  ["max_concurrent", "Concurrentes", "num"],
  ["max_daily", "Al día", "num"],
  ["max_storage_gb", "Almacenamiento (GB)", "num"],
  ["queue_priority", "Prioridad (-5 a 5)", "num"],
  ["can_create_projects", "Crear proyectos", "bool"],
  ["background_jobs", "Trabajo en segundo plano", "bool"],
  ["weekly_enabled", "Tope semanal activo", "bool"],
  ["max_weekly", "A la semana", "num"],
];

type Fila = { anular: boolean; valor: unknown };

/** Editor de las 9 palancas de límites. Sirve para dos casos con la misma
 *  pieza: los del servidor (`modo="global"`, siempre se fijan) y las
 *  anulaciones de un usuario (`modo="usuario"`, cada fila puede "heredar del
 *  global" o anular con su propio valor) — es la misma tabla de controles,
 *  solo cambia si hay un interruptor de anular por fila o no. */
export function LimitsEditor({
  modo, titulo, valores, overrides, userId, token, onGuardado, onCerrar,
}: {
  modo: "global" | "usuario";
  titulo: string;
  valores: Limits;
  /** Solo en modo "usuario": qué palancas están anuladas ahora mismo. */
  overrides?: Record<string, unknown>;
  /** Obligatorio en modo "usuario": a quién se le aplica. */
  userId?: number;
  token: string;
  onGuardado: () => void;
  onCerrar: () => void;
}) {
  const [filas, setFilas] = useState<Record<string, Fila>>(() => {
    const out: Record<string, Fila> = {};
    for (const [key] of PALANCAS) {
      const anulado = modo === "global" || key in (overrides ?? {});
      out[key] = { anular: anulado, valor: valores[key] };
    }
    return out;
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set(key: string, patch: Partial<Fila>) {
    setFilas((f) => ({ ...f, [key]: { ...f[key], ...patch } }));
  }

  async function guardar() {
    setBusy(true);
    setError(null);
    const limits: Record<string, unknown> = {};
    for (const [key] of PALANCAS) {
      const f = filas[key];
      // En global no hay "anular": el valor de la fila se fija siempre. En
      // usuario, no anular significa volver a heredar — eso es `null`, la
      // única forma que entiende `limits::clear` de deshacerlo.
      limits[key] = modo === "global" ? f.valor : (f.anular ? f.valor : null);
    }
    try {
      if (modo === "global") {
        await api.patch("/v1/admin/limits", { limits }, token);
      } else {
        // Reutiliza patch_user: mismo payload que ya usa "quitar anulación".
        await api.patch(`/v1/admin/users/${userId}`, { limits }, token);
      }
      onGuardado();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div className="w-[560px] max-w-[94vw] overflow-hidden rounded-card border border-border bg-panel"
        style={{ animation: "jg-popup-scale-in .3s cubic-bezier(.16,1,.3,1) both" }}>

        <div className="flex items-center gap-3 border-b border-border px-5 py-4">
          <Icon name="wrench" size={22} className="text-subtle" />
          <div className="flex-1">
            <div className="text-[14px] text-fg">{titulo}</div>
            <div className="text-[9.5px] text-subtle">
              {modo === "global" ? "rige para todos, salvo anulación" : "anula el global solo para esta cuenta"}
            </div>
          </div>
          <button onClick={onCerrar} className="jg-press rounded-lg px-2 py-1 text-subtle">✕</button>
        </div>

        <div className="max-h-[62vh] overflow-y-auto p-5">
          <div className="flex flex-col gap-3.5">
            {PALANCAS.map(([key, etiqueta, tipo]) => {
              const f = filas[key];
              return (
                <div key={key} className="flex items-center gap-3">
                  <span className="w-[168px] shrink-0 text-[11px] text-subtle">{etiqueta}</span>

                  {modo === "usuario" && (
                    <button onClick={() => set(key, { anular: !f.anular })}
                      className={`shrink-0 rounded border px-1.5 py-0.5 text-[9.5px] transition-colors duration-300 ease-expo ${
                        f.anular ? "border-accent text-fg" : "border-border text-subtle"}`}>
                      {f.anular ? "anulado" : "hereda"}
                    </button>
                  )}

                  <div className={`flex-1 ${modo === "usuario" && !f.anular ? "pointer-events-none opacity-40" : ""}`}>
                    {tipo === "bool" && (
                      <div className="flex gap-1.5">
                        {([true, false] as const).map((v) => (
                          <button key={String(v)} onClick={() => set(key, { valor: v })}
                            className={`rounded border px-2 py-1 text-[10.5px] transition-colors duration-300 ease-expo ${
                              f.valor === v ? "border-accent text-fg" : "border-border text-subtle"}`}>
                            {v ? "activado" : "desactivado"}
                          </button>
                        ))}
                      </div>
                    )}
                    {tipo === "num" && (
                      <input type="number"
                        min={key === "queue_priority" ? -5 : 0}
                        max={key === "queue_priority" ? 5 : undefined}
                        value={f.valor as number}
                        onChange={(e) => set(key, { valor: e.target.valueAsNumber || 0 })}
                        className="w-[110px] rounded-[9px] border border-border bg-[#0d0f12] px-[11px] py-[6px]
                          font-mono text-[12.5px] text-fg outline-none transition-colors duration-300 ease-expo
                          focus:border-white/40" />
                    )}
                    {tipo === "modelos" && (
                      <div className="flex flex-wrap gap-1.5">
                        {KNOWN_MODELS.map((m) => {
                          const lista = (f.valor as string[]) ?? [];
                          const on = lista.includes(m);
                          return (
                            <button key={m} onClick={() => set(key, {
                              valor: on ? lista.filter((x) => x !== m) : [...lista, m],
                            })}
                              className={`rounded border px-1.5 py-0.5 text-[10.5px] transition-colors duration-300 ease-expo ${
                                on ? "border-accent text-fg" : "border-border text-subtle"}`}>
                              {m}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {error && <p className="px-5 pb-2 text-[10.5px] text-danger-fg">{error}</p>}
        <div className="flex items-center justify-end gap-2 border-t border-border bg-bg px-5 py-3.5">
          <button onClick={onCerrar} disabled={busy}
            className="jg-press rounded-lg border border-border px-3.5 py-1.5 text-[11px] text-subtle disabled:opacity-40">
            Cancelar
          </button>
          <button onClick={guardar} disabled={busy}
            className="jg-press rounded-lg bg-accent px-3.5 py-1.5 text-[11px] font-medium text-black disabled:opacity-40">
            {busy ? "Un momento…" : "Aplicar cambios"}
          </button>
        </div>
      </div>
    </div>
  );
}
