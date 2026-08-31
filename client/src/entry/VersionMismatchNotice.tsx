import { useState } from "react";
import { api, versionMayor } from "../lib/api";
import { dispararActualizacionAVersion } from "../lib/actualizaciones";

/** Popup — bloquea de verdad hasta que el investigador elige un camino, en
 *  vez de perderse entre el resto de la pantalla de login. Mismo lenguaje
 *  visual que `Pane`/`StatusOverlay` (marca ✦ + título a la izquierda,
 *  tarjeta de cristal `rgba(16,19,25,.66)` + `backdrop-blur-xl`) — es la
 *  identidad real del cliente, no la insignia circular de icono de
 *  `ConfirmarPeligro.tsx`, que es un diálogo de confirmación de admin
 *  aparte y nunca se ve durante el login/pairing.
 *
 *  Se monta igual en `LoginForm`, `AddServerForm` y `PairStep` cuando
 *  `pair`/`reconnect`/`pair_card` fallan por desajuste de versión — ver
 *  `connect()` en `client/src-tauri/src/main.rs` y la spec de
 *  compatibilidad de versión. Cliente más nuevo: dos caminos (pedir al
 *  servidor que actualice, o descargar la versión del servidor). Servidor
 *  más nuevo: uno solo (actualizar el cliente). */
export function VersionMismatchModal({ propia, servidor, onClose }: {
  propia: string; servidor: string; onClose: () => void;
}) {
  const clienteEsMasNuevo = versionMayor(propia, servidor);
  const [enviada, setEnviada] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aplicando, setAplicando] = useState(false);

  async function pedirActualizacion() {
    setError(null);
    try {
      await api.post("/v1/version-mismatch", { version_cliente: propia });
      setEnviada(true);
    } catch (e) {
      setError(String(e));
    }
  }

  // Si sale bien, la app se cierra sola dentro del comando de Rust y nunca
  // llega a este `catch` — igual que en ActualizacionesSeccion.tsx.
  async function actualizar() {
    setAplicando(true);
    setError(null);
    try {
      await dispararActualizacionAVersion(servidor);
    } catch (e) {
      setError(String(e));
      setAplicando(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-6"
      style={{ animation: "jg-backdrop-in .28s ease both" }}>
      <div className="w-full max-w-sm" style={{ animation: "jg-fade-rise .5s cubic-bezier(.16,1,.3,1) both" }}>
        <div className="mb-1 flex items-center gap-2.5">
          <span className="text-fg" style={{ animation: "jg-lock-breathe 2.4s ease-in-out infinite" }}>✦</span>
          <span className="text-[17px] font-medium text-fg">Versión incompatible</span>
        </div>
        <p className="mb-6 text-xs text-muted">
          Este cliente ({propia}) no coincide con la versión del servidor ({servidor}).
        </p>

        <div className="rounded-card border border-white/[.13] bg-[rgba(16,19,25,.66)] p-5 shadow-lg shadow-black/40 backdrop-blur-xl">
          {error && <p className="mb-3 text-xs text-danger-fg">{error}</p>}
          <div className="flex flex-wrap items-center justify-end gap-2">
            {clienteEsMasNuevo && (
              enviada ? (
                <span className="mr-auto text-[11px] text-subtle">Solicitud enviada al servidor</span>
              ) : (
                <button onClick={() => void pedirActualizacion()}
                  className="jg-press rounded-lg border border-white/15 px-3.5 py-1.5 text-[11px] text-fg">
                  Pedir al servidor que actualice
                </button>
              )
            )}
            <button onClick={onClose}
              className="jg-press rounded-lg px-3.5 py-1.5 text-[11px] text-subtle">
              Cerrar
            </button>
            <button onClick={() => void actualizar()} disabled={aplicando}
              className="jg-press rounded-lg bg-accent px-3.5 py-1.5 text-[11px] font-medium text-black disabled:opacity-40">
              {aplicando ? "Aplicando…" : clienteEsMasNuevo ? "Descargar versión del servidor" : "Actualizar cliente"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
