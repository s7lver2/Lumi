import { useState } from "react";
import { Seccion } from "../admin/AdminPanel";
import { leerReducirMovimiento, setReducirMovimiento } from "../lib/apariencia";
import { AjustesSidebar, type AjustesSeccion } from "./AjustesSidebar";
import { ActualizacionesSeccion } from "./ActualizacionesSeccion";

/** Ajustes de la app, no de la cuenta — por eso vive fuera de
 *  `profile/ProfileView.tsx` y no exige sesión. Mismo esqueleto de grid que
 *  ProfileView/AdminPanel. */
export function AjustesView({ onBack }: { onBack: () => void }) {
  const [seccion, setSeccion] = useState<AjustesSeccion>("actualizaciones");

  return (
    <div className="grid h-full w-full grid-cols-[206px_1fr] overflow-hidden bg-bg">
      <AjustesSidebar actual={seccion} onIr={setSeccion} onBack={onBack} />
      <div key={seccion} className="overflow-y-auto"
        style={{ animation: "jg-fade-rise .5s cubic-bezier(.16,1,.3,1) both" }}>
        {seccion === "actualizaciones" ? (
          <Seccion titulo="Actualizaciones" grupo="Ajustes">
            <p className="text-[11px] text-muted">Comprueba si hay una versión nueva de Lumi.</p>
            <div className="mt-4">
              <ActualizacionesSeccion />
            </div>
          </Seccion>
        ) : (
          <AparienciaPanel />
        )}
      </div>
    </div>
  );
}

function AparienciaPanel() {
  const [activo, setActivo] = useState(leerReducirMovimiento());

  return (
    <Seccion titulo="Apariencia" grupo="Ajustes">
      <label className="flex items-center justify-between gap-3 rounded-card border border-border bg-panel p-[13px_16px]">
        <span className="text-[11.5px] text-fg">
          Reducir movimiento
          <small className="mt-0.5 block text-[10px] text-subtle">Desactiva las animaciones de la interfaz.</small>
        </span>
        <button role="switch" aria-checked={activo}
          onClick={() => { const v = !activo; setActivo(v); setReducirMovimiento(v); }}
          className={`relative h-5 w-9 shrink-0 rounded-full border transition-colors duration-300 ease-expo ${activo ? "border-accent bg-accent" : "border-white/15 bg-white/10"}`}>
          {/* El pomo era negro sobre un riel oscuro translúcido en el estado
              apagado — sin contraste, invisible. `bg-fg` (casi blanco) se ve
              en los dos estados; sobre el riel encendido (bg-accent, casi
              blanco también) se distingue por el aro oscuro. */}
          <span className={`absolute top-0.5 h-3.5 w-3.5 rounded-full bg-fg ring-1 ring-black/20 transition-transform duration-300 ease-expo ${activo ? "translate-x-[18px]" : "translate-x-0.5"}`} />
        </button>
      </label>
    </Seccion>
  );
}
