import { useEffect, useState } from "react";
import { api, type MapConfig, type MapTheme } from "../lib/api";
import { Icon } from "../ui/Icon";

/** PROVISIONAL. El subsistema 3 rehace el panel entero; esto solo tiene que
 *  funcionar y usar los tokens.
 *
 *  Ya no hay campo de URL: un enlace mal copiado de Mapbox Studio (la página
 *  de vista previa, o el esquema `mapbox://` sin traducir) rompió el mapa
 *  tres veces distintas antes de este cambio. El catálogo es cerrado — se
 *  elige un tema, no se pega una dirección. */
export function MapRow({ token }: { token: string }) {
  const [cfg, setCfg] = useState<MapConfig | null>(null);
  const [themes, setThemes] = useState<MapTheme[] | null>(null);
  const [theme, setTheme] = useState<string | null>(null);
  const [key, setKey] = useState("");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      api.get<MapConfig>("/v1/map/config", token),
      api.get<MapTheme[]>("/v1/map/themes", token),
    ]).then(([c, t]) => {
      setCfg(c);
      setTheme(c.theme);
      setThemes(t);
    }).catch((e) => setError(String(e)));
  }, []);

  async function guardar(id: string, engine?: "maplibre" | "mapbox") {
    setTheme(id);
    setError(null);
    try {
      // Clave vacía = no la toques. Así se cambia de tema sin volver a
      // teclearla, que es imposible si se leyera del campo enmascarado.
      const c = await api.patch<MapConfig>(
        "/v1/admin/map", { theme: id, key: key === "" ? null : key, engine: engine ?? null }, token,
      );
      setCfg(c);
      setKey("");
      setSaved(true);
      setTimeout(() => setSaved(false), 1600);
    } catch (e) {
      setError(String(e));
    }
  }
  const pick = (id: string) => guardar(id);

  const needsKey = themes?.find((t) => t.id === theme)?.needs_key ?? false;

  return (
    <div className="rounded-card border border-border p-3.5">
      <p className="text-[12.5px] text-fg">Mapa</p>
      <p className="mb-3 text-[11px] text-muted">
        un tema del catálogo y quién lo dibuja
      </p>

      {themes === null ? (
        <p className="text-[11px] text-subtle">cargando</p>
      ) : (
        <div className="grid grid-cols-3 gap-2">
          {themes.map((t) => (
            <button key={t.id} onClick={() => void pick(t.id)}
              className={`jg-press rounded-lg border p-2.5 text-left transition-colors duration-300 ease-expo ${
                theme === t.id ? "border-white/[.35] bg-white/[.05]" : "border-border hover:border-white/15"
              }`}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11.5px] text-fg">{t.label}</span>
                {theme === t.id && <Icon name="check" size={12} className="shrink-0 text-fg" />}
              </div>
              <span className="mt-0.5 block text-[9.5px] text-subtle">
                {t.needs_key ? "necesita clave de Mapbox" : "gratis · sin clave"}
              </span>
            </button>
          ))}
        </div>
      )}

      {needsKey && (
        <div className="mt-2.5 flex items-center gap-2">
          <input value={key} onChange={(e) => setKey(e.target.value)} type="password"
            placeholder={cfg?.has_key ? "clave guardada · escribe para sustituirla" : "clave de Mapbox"}
            className="min-w-[220px] flex-1 rounded-lg border border-border bg-[#0d0f12] px-3 py-2 text-[12.5px]
              text-fg outline-none transition-[border-color] duration-300 ease-expo focus:border-white/40" />
          <button onClick={() => theme && void pick(theme)}
            className="jg-press rounded-lg border border-white/15 px-4 py-2 text-xs text-fg">
            {saved ? "guardado" : "Guardar clave"}
          </button>
        </div>
      )}

      {/* El motor no es una preferencia estética: es dónde vive la clave.
          Por eso el compromiso va escrito en la propia opción y no en una
          ayuda que nadie abre. */}
      <div className="mt-3.5 border-t border-border pt-3">
        <p className="text-[12.5px] text-fg">Quién dibuja</p>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {([
            {
              id: "maplibre" as const, nombre: "MapLibre · por el servidor",
              nota: "el daemon hace de proxy: la clave no sale de aquí",
              aviso: false,
            },
            {
              id: "mapbox" as const, nombre: "Mapbox · directo",
              nota: "su SDK firma en el navegador: la clave viaja a cada equipo",
              aviso: true,
            },
          ]).map((e) => {
            const on = (cfg?.engine ?? "maplibre") === e.id;
            return (
              <button key={e.id} onClick={() => theme && void guardar(theme, e.id)}
                disabled={!theme}
                className={`jg-press rounded-lg border p-2.5 text-left transition-colors duration-300
                  ease-expo disabled:opacity-40 ${
                    on ? "border-white/[.35] bg-white/[.05]" : "border-border hover:border-white/15"}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11.5px] text-fg">{e.nombre}</span>
                  {on && <Icon name="check" size={12} className="shrink-0 text-fg" />}
                </div>
                <span className={`mt-0.5 block text-[9.5px] ${e.aviso ? "text-warning-fg" : "text-subtle"}`}>
                  {e.nota}
                </span>
              </button>
            );
          })}
        </div>
        {cfg?.engine === "mapbox" && (
          <p className="mt-2 flex items-start gap-1.5 text-[10.5px] leading-snug text-warning-fg">
            <Icon name="alert" size={12} className="mt-px shrink-0" />
            Con este motor la clave de Mapbox se entrega a cualquiera que inicie sesión.
            Quien la extraiga del tráfico gasta tu cuota. A cambio, los estilos salen tal
            cual los diseña Mapbox y el daemon no ve ni una petición del mapa.
          </p>
        )}
      </div>

      {cfg?.reason && <p className="mt-2.5 text-[11px] text-warning-fg">{cfg.reason}</p>}
      {error && <p className="mt-2.5 text-[11px] text-danger-fg">{error}</p>}
    </div>
  );
}
