import { useState } from "react";
import { comprobarActualizacion, dispararActualizacionSilenciosa, type EstadoActualizacion } from "../lib/actualizaciones";

/** El bloque de "comprobar actualizaciones" — antes vivía solo dentro de
 *  `ProfileView.tsx` (con sesión). Ahora lo reusa también `AjustesView.tsx`
 *  (sin sesión, la comprobación no la necesita: es una llamada aparte a
 *  Vercel, no a `lumid`). Misma lógica, dos sitios donde vivir. */
export function ActualizacionesSeccion() {
  const [estado, setEstado] = useState<EstadoActualizacion | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [comprobando, setComprobando] = useState(false);
  // `comprobarActualizacion()` devuelve `null` tanto si nunca se ha llamado
  // como si ya se llamó y no hay nada nuevo — sin esto, comprobar y no
  // encontrar nada se veía exactamente igual que no haber comprobado nunca,
  // y el botón parecía no hacer nada.
  const [comprobado, setComprobado] = useState(false);

  async function comprobarAhora() {
    setComprobando(true);
    setError(null);
    try {
      setEstado(await comprobarActualizacion());
      setComprobado(true);
    } catch (e) {
      setEstado(null);
      setError(String(e));
    } finally {
      setComprobando(false);
    }
  }

  return (
    <div className="rounded-card border border-border bg-panel p-[13px_16px]">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[8.5px] uppercase tracking-[.15em] text-subtle">Lumi</span>
      </div>
      {estado?.tipo === "disponible" && (
        <p className="text-[11px] text-draw-fg">Versión {estado.version} disponible — {estado.notas}</p>
      )}
      {estado?.tipo === "retirada" && (
        <p className="text-[11px] text-warning-fg">Tu versión fue retirada. Actualiza en cuanto puedas.</p>
      )}
      {!estado && !error && !comprobando && (
        <p className="text-[11px] text-muted">
          {comprobado ? "Ya tienes la última versión." : "Sin comprobar en esta sesión."}
        </p>
      )}
      {error && <p className="text-[11px] text-subtle">No se pudo comprobar: {error}</p>}
      <div className="mt-2.5 flex items-center gap-2">
        <button onClick={() => void comprobarAhora()} disabled={comprobando}
          className="jg-press rounded-lg border border-white/15 px-2.5 py-1 text-[10.5px] text-fg disabled:opacity-40">
          {comprobando ? "Comprobando…" : "Comprobar ahora"}
        </button>
        {estado?.tipo === "disponible" && (
          <button onClick={() => void dispararActualizacionSilenciosa(estado.version)}
            className="jg-press rounded-lg bg-accent px-2.5 py-1 text-[10.5px] font-medium text-black">
            Actualizar ahora
          </button>
        )}
      </div>
    </div>
  );
}
