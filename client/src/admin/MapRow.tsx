import { useEffect, useState } from "react";
import { api, type MapConfig } from "../lib/api";

/** PROVISIONAL. El subsistema 3 rehace el panel entero; esto solo tiene que
 *  funcionar y usar los tokens. */
export function MapRow({ token }: { token: string }) {
  const [cfg, setCfg] = useState<MapConfig | null>(null);
  const [provider, setProvider] = useState("none");
  const [style, setStyle] = useState("");
  const [key, setKey] = useState("");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<MapConfig>("/v1/map/config", token).then((c) => {
      setCfg(c);
      setProvider(c.provider);
      setStyle(c.style_url);
    }).catch((e) => setError(String(e)));
  }, []);

  async function save() {
    setError(null);
    try {
      // Clave vacía = no la toques. Así se cambia de estilo sin volver a
      // teclearla, que es imposible si se leyera del campo enmascarado.
      const c = await api.patch<MapConfig>(
        "/v1/admin/map",
        { provider, style_url: style, key: key === "" ? null : key },
        token,
      );
      setCfg(c);
      setKey("");
      setSaved(true);
      setTimeout(() => setSaved(false), 1600);
    } catch (e) {
      setError(String(e));
    }
  }

  const input =
    "rounded-lg border border-border bg-[#0d0f12] px-3 py-2 text-[12.5px] text-fg outline-none transition-[border-color] duration-300 ease-expo focus:border-white/40";

  return (
    <div className="rounded-card border border-border p-3.5">
      <p className="text-[12.5px] text-fg">Mapa</p>
      <p className="mb-3 text-[11px] text-muted">
        el servidor pide las teselas por ti: la clave no sale de aquí
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <select value={provider} onChange={(e) => setProvider(e.target.value)} className={input}>
          <option value="none">sin mapa</option>
          <option value="osm">OpenStreetMap</option>
          <option value="mapbox">Mapbox</option>
        </select>
        <input value={style} onChange={(e) => setStyle(e.target.value)}
          placeholder="URL del estilo" className={`${input} min-w-[220px] flex-1`} />
        <input value={key} onChange={(e) => setKey(e.target.value)} type="password"
          placeholder={cfg?.has_key ? "clave guardada · escribe para sustituirla" : "clave del proveedor"}
          className={`${input} min-w-[180px]`} />
        <button onClick={save}
          className="rounded-lg border border-white/15 px-4 py-2 text-xs text-fg active:translate-y-px">
          {saved ? "guardado" : "Guardar"}
        </button>
      </div>

      {cfg?.reason && <p className="mt-2.5 text-[11px] text-warning-fg">{cfg.reason}</p>}
      {error && <p className="mt-2.5 text-[11px] text-danger-fg">{error}</p>}
    </div>
  );
}
