import { useEffect, useState } from "react";
import { api, type ProviderTokenState } from "../lib/api";
import { MapRow } from "./MapRow";
import { Seccion } from "./AdminPanel";

/** Todas las credenciales de terceros DEL SERVIDOR. `MapRow` se muda aquí tal
 *  cual: es la configuración del proveedor de mapas, y su sitio es este. */
export function KeysView({ token }: { token: string }) {
  const [estado, setEstado] = useState<ProviderTokenState | null>(null);
  const [valor, setValor] = useState("");

  useEffect(() => {
    api.get<ProviderTokenState>("/v1/admin/models/provider-token", token).then(setEstado).catch(() => {});
  }, [token]);

  async function guardar() {
    const r = await api.patch<ProviderTokenState>("/v1/admin/models/provider-token", { token: valor }, token);
    setEstado(r);
    setValor("");
  }

  return (
    <Seccion titulo="API Keys" grupo="Servidor">
      <p className="text-[11px] leading-[1.72] text-subtle">
        Ninguna se muestra entera, ni después de guardarla.
      </p>

      <div className="mt-4">
        <MapRow token={token} />
      </div>

      <div className="mt-3 flex items-center gap-3 rounded-[11px] border border-border p-[11px_14px]">
        <span className="min-w-0 text-[11.5px] text-muted">
          Proveedor de pesos
          <small className="ml-2 text-[9.5px] text-subtle">
            para modelos tras la puerta de su proveedor
          </small>
        </span>
        <input type="password" value={valor} onChange={(e) => setValor(e.target.value)}
          placeholder={estado?.has_token ? "token guardado · escribe para sustituirlo" : "token del proveedor"}
          className="ml-auto min-w-[180px] rounded-lg border border-border bg-elevated px-2.5 py-1 font-mono text-[10.5px] text-fg outline-none focus:border-white/40" />
        <button onClick={guardar} className="rounded-lg border border-white/15 px-2.5 py-1 text-[10.5px] text-fg">
          Guardar
        </button>
      </div>

      <p className="mt-4 text-[11px] leading-[1.72] text-subtle">
        Las de los orígenes de red —Mapillary, Flickr, Google— viven en el Lumi Indexer.
      </p>
    </Seccion>
  );
}
