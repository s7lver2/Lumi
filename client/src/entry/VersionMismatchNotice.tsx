import { useState } from "react";
import { api, versionMayor } from "../lib/api";
import { dispararActualizacionAVersion } from "../lib/actualizaciones";
import { Icon } from "../ui/Icon";

/** Se muestra en el sitio del error genérico de conexión (mismo hueco en
 *  `LoginForm`, `AddServerForm` y `PairStep`) cuando `pair`/`reconnect`/
 *  `pair_card` fallan por desajuste de versión — ver `connect()` en
 *  `client/src-tauri/src/main.rs` y la spec de compatibilidad de versión.
 *  Cliente más nuevo: dos caminos (pedir al servidor que actualice, o
 *  descargar la versión del servidor). Servidor más nuevo: uno solo
 *  (actualizar el cliente). */
export function VersionMismatchNotice({ propia, servidor }: { propia: string; servidor: string }) {
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
    <>
      <div className="my-3 h-px bg-border" />
      <div className="flex items-start gap-2.5 text-xs text-warning-fg">
        <Icon name="alert" className="mt-0.5" />
        <span className="text-muted">
          Este cliente ({propia}) no coincide con la versión del servidor ({servidor}).
        </span>
      </div>
      {errorEnvio && <p className="mt-2 text-[11px] text-danger-fg">{errorEnvio}</p>}
      <div className="mt-3 flex items-center justify-end gap-2">
        {clienteEsMasNuevo && (
          enviada ? (
            <span className="text-[11px] text-subtle">Solicitud enviada al servidor</span>
          ) : (
            <button onClick={pedirActualizacion}
              className="rounded-lg border border-white/15 px-3 py-1.5 text-[11px] text-fg active:translate-y-px">
              Pedir al servidor que actualice
            </button>
          )
        )}
        <button onClick={() => void dispararActualizacionAVersion(servidor)}
          className="rounded-lg bg-accent px-3 py-1.5 text-[11px] font-medium text-black active:translate-y-px">
          {clienteEsMasNuevo ? "Descargar versión del servidor" : "Actualizar cliente"}
        </button>
      </div>
    </>
  );
}
