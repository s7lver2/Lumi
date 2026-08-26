import { useState } from "react";
import { api, versionMayor } from "../lib/api";
import { dispararActualizacionAVersion } from "../lib/actualizaciones";
import { Icon } from "../ui/Icon";

/** Popup, no una línea más dentro del formulario: bloquea de verdad hasta
 *  que el investigador elige un camino, en vez de perderse entre el resto
 *  de la pantalla de login. Mismo patrón que `ConfirmarPeligro.tsx` (el
 *  único otro popup del proyecto): fondo oscurecido + tarjeta centrada.
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
  const [errorEnvio, setErrorEnvio] = useState<string | null>(null);

  async function pedirActualizacion() {
    try {
      await api.post("/v1/version-mismatch", { version_cliente: propia });
      setEnviada(true);
    } catch (e) {
      setErrorEnvio(String(e));
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70"
      style={{ animation: "jg-backdrop-in .28s ease both" }}>
      <div className="w-[340px] rounded-card border border-border bg-panel p-5 text-center"
        style={{ animation: "jg-popup-scale-in .3s cubic-bezier(.16,1,.3,1) both" }}>
        <div className="mx-auto mb-3 grid h-[52px] w-[52px] place-items-center rounded-full
          border border-warning/40 bg-warning/10">
          <Icon name="alert" size={24} className="text-warning-fg" />
        </div>
        <p className="text-[13px] font-medium text-fg">Versión incompatible</p>
        <p className="mt-1.5 text-[10.5px] leading-relaxed text-muted">
          Este cliente ({propia}) no coincide con la versión del servidor ({servidor}).
        </p>
        {errorEnvio && <p className="mt-2 text-[10.5px] text-danger-fg">{errorEnvio}</p>}

        <div className="mt-4 flex flex-col items-stretch gap-2">
          {clienteEsMasNuevo && (
            enviada ? (
              <span className="text-[10.5px] text-subtle">Solicitud enviada al servidor</span>
            ) : (
              <button onClick={pedirActualizacion}
                className="jg-press rounded-lg border border-white/15 px-3.5 py-1.5 text-[11px] text-fg">
                Pedir al servidor que actualice
              </button>
            )
          )}
          <button onClick={() => void dispararActualizacionAVersion(servidor)}
            className="jg-press rounded-lg bg-accent px-3.5 py-1.5 text-[11px] font-medium text-black">
            {clienteEsMasNuevo ? "Descargar versión del servidor" : "Actualizar cliente"}
          </button>
          <button onClick={onClose} className="jg-press rounded-lg px-3.5 py-1.5 text-[10.5px] text-subtle">
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}
