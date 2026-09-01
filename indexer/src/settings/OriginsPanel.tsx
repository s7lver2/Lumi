import { useEffect, useState } from "react";

import { api } from "../lib/api";
import { COMPARTE_CLAVE, LIMITES, ORDEN, SIN_CLAVE, color, nombre } from "../lib/origenes";

const eur = (n: number) => `${n.toFixed(2).replace(".", ",")} €`;
const PRECIO: Record<string, string> = { google: "7,00 $/1000", "mapbox-satelite": "0,75 $/1000" };

export function OriginsPanel() {
  const [hay, setHay] = useState<Record<string, boolean>>({});
  const [hayMapa, setHayMapa] = useState(false);
  const [editando, setEditando] = useState<string | null>(null);
  const [valor, setValor] = useState("");
  const [tope, setTope] = useState(0);
  const [topeTexto, setTopeTexto] = useState("");
  const [gastado, setGastado] = useState(0);
  const [error, setError] = useState<string | null>(null);

  async function refrescar() {
    const pares = await Promise.all(
      ORDEN.filter((o) => !SIN_CLAVE.has(o)).map(async (o) => [o, await api.claveHay(o)] as const),
    );
    setHay(Object.fromEntries(pares));
    setHayMapa(!!(await api.mapboxClave()));
    const t = await api.topeLeer();
    setTope(t);
    setTopeTexto(String(t));
    const [total] = await api.gastoMes();
    setGastado(total);
  }

  useEffect(() => { void refrescar(); }, []);

  async function guardar(o: string) {
    setError(null);
    try {
      await api.claveGuardar(o, valor.trim());
      setEditando(null);
      setValor("");
      await refrescar();
    } catch (e) { setError(String(e)); }
  }

  async function guardarMapa() {
    setError(null);
    try {
      await api.mapboxClaveGuardar(valor.trim());
      setEditando(null);
      setValor("");
      await refrescar();
    } catch (e) { setError(String(e)); }
  }

  async function guardarTope() {
    setError(null);
    const n = Number(topeTexto.replace(",", "."));
    if (!Number.isFinite(n)) { setError("el tope tiene que ser un número"); return; }
    try { await api.topeFijar(n); await refrescar(); } catch (e) { setError(String(e)); }
  }

  return (
    <div className="h-full overflow-y-auto p-8">
      <div className="mx-auto max-w-3xl">
        <p className="text-sm text-fg">Orígenes de red</p>
        <p className="mt-[5px] text-[11px] leading-relaxed text-muted">
          Tus claves, en tu máquina, cifradas con la clave maestra local. Nunca salen de aquí ni
          viajan dentro de ningún paquete.
        </p>

        <p className="mt-6 text-[8px] uppercase tracking-[.11em] text-subtle">Mapa base</p>
        <div className={`mt-2 flex items-center gap-3 rounded-lg border border-border px-3 py-2.5
          ${hayMapa ? "" : "opacity-90"}`}>
          <span className="h-[9px] w-[9px] shrink-0 rounded-full bg-[#85b7eb]" />
          <span className="w-[150px] shrink-0 text-[11.5px] text-fg">Mapbox (mapa)</span>
          {editando === "__mapa" ? (
            <input
              type="password"
              autoComplete="off"
              autoFocus
              value={valor}
              onChange={(e) => setValor(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void guardarMapa(); }}
              placeholder="pega la clave y pulsa Intro"
              className="flex-1 rounded border border-border bg-black/30 px-2 py-1
                font-mono text-[10.5px] text-fg outline-none focus:border-white/30"
            />
          ) : (
            <span className={`flex-1 rounded border px-1.5 py-px text-[8.5px] ${
              hayMapa ? "border-white/[.28] text-fg" : "border-warning/40 text-warning-fg"}`}>
              {hayMapa ? "configurada" : "sin configurar — el mapa no puede dibujarse sin ella"}
            </span>
          )}
          {editando !== "__mapa" && (
            <button
              onClick={() => { setEditando("__mapa"); setValor(""); }}
              className="jg-press shrink-0 rounded-lg border border-white/15 px-[11px] py-[5px] text-[10.5px] text-fg"
            >
              {hayMapa ? "Cambiar" : "Añadir"}
            </button>
          )}
        </div>
        <p className="mt-1.5 text-[10.5px] leading-relaxed text-subtle">
          Esta es la clave del mapa que se dibuja para elegir territorio. Es una cuenta
          distinta de <b className="font-normal text-fg">Mapbox Satellite</b>, listado abajo entre
          los orígenes de red — pueden ser la misma clave de Mapbox o dos separadas.
        </p>

        <p className="mt-6 text-[8px] uppercase tracking-[.11em] text-subtle">Orígenes de indexado</p>
        <table className="mt-2 w-full border-collapse text-[11.5px]">
          <thead>
            <tr className="text-[8px] uppercase tracking-[.11em] text-subtle">
              <th className="w-[30%] pb-2 text-left font-normal">Origen</th>
              <th className="pb-2 text-left font-normal">Clave</th>
              <th className="pb-2 text-left font-normal">Límite</th>
              <th className="pb-2 text-right font-normal">Coste</th>
              <th className="w-[16%] pb-2" />
            </tr>
          </thead>
          <tbody>
            {ORDEN.map((o) => {
              const sinClave = SIN_CLAVE.has(o);
              const compartida = COMPARTE_CLAVE.has(o);
              const puesta = sinClave || hay[o];
              return (
                <tr key={o} className={`border-t border-border ${puesta ? "" : "opacity-55"}`}>
                  <td className="py-2">
                    <span className="flex items-center gap-2.5">
                      <span className="h-[9px] w-[9px] rounded-full" style={{ background: color(o) }} />
                      {nombre(o)}
                    </span>
                    {o === "flickr" && (
                      <span className="mt-1 block max-w-[220px] text-[9.5px] leading-snug text-warning-fg">
                        Flickr desactivó su API para cuentas gratuitas: hace falta una cuenta
                        Pro para que esta clave funcione.
                      </span>
                    )}
                  </td>
                  <td className="py-2">
                    {editando === o ? (
                      <input
                        type="password"
                        autoComplete="off"
                        autoFocus
                        value={valor}
                        onChange={(e) => setValor(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") void guardar(o); }}
                        placeholder="pega la clave y pulsa Intro"
                        className="w-full rounded border border-border bg-black/30 px-2 py-1
                          font-mono text-[10.5px] text-fg outline-none focus:border-white/30"
                      />
                    ) : sinClave ? (
                      <span className="rounded border border-border px-1.5 py-px text-[8.5px] text-subtle">
                        no necesita
                      </span>
                    ) : compartida ? (
                      <span className="rounded border border-white/[.28] px-1.5 py-px text-[8.5px] text-fg">
                        compartida con el mapa
                      </span>
                    ) : hay[o] ? (
                      <span className="rounded border border-white/[.28] px-1.5 py-px text-[8.5px] text-fg">
                        configurada
                      </span>
                    ) : (
                      <span className="rounded border border-warning/40 px-1.5 py-px text-[8.5px] text-warning-fg">
                        sin configurar
                      </span>
                    )}
                  </td>
                  <td className="py-2 font-mono text-[10.5px] text-muted">
                    {puesta ? LIMITES[o] : "—"}
                  </td>
                  <td className={`py-2 text-right font-mono text-[10.5px] ${PRECIO[o] ? "text-warning-fg" : "text-subtle"}`}>
                    {PRECIO[o] ?? "gratis"}
                  </td>
                  <td className="py-2 text-right">
                    {!sinClave && editando !== o && (
                      <button
                        onClick={() => { setEditando(o); setValor(""); }}
                        className="jg-press rounded-lg border border-white/15 px-[11px] py-[5px] text-[10.5px] text-fg"
                      >
                        {hay[o] || compartida ? "Cambiar" : "Añadir"}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {ORDEN.some((o) => !SIN_CLAVE.has(o) && !hay[o]) && (
          <p className="mt-[11px] text-[10.5px] leading-relaxed text-warning-fg">
            Lo que está sin clave <b className="font-normal">no aparece</b> en la capa de
            disponibilidad ni en la estimación. Mejor ausente que presente y reventando después de
            confirmar el gasto.
          </p>
        )}

        {error && <p className="mt-2.5 text-[11px] text-danger-fg">{error}</p>}

        <div className="mt-6">
          <div className="rounded-[10px] border border-border p-[15px_16px]">
            <div className="flex items-center">
              <span className="flex-1 text-[8.5px] uppercase tracking-[.13em] text-subtle">
                Tope mensual
              </span>
              <span className="font-mono text-[11px] text-fg">{eur(tope)}</span>
            </div>
            <div className="mt-[11px] h-1.5 overflow-hidden rounded-[3px] bg-elevated">
              <i className="block h-full bg-fg transition-[width] duration-500 ease-expo"
                style={{ width: `${tope ? Math.min(100, (gastado / tope) * 100) : 0}%` }} />
            </div>
            <div className="mt-2 flex">
              <span className="flex-1 text-[10.5px] text-subtle">gastado este mes</span>
              <span className="font-mono text-[11px] text-muted">{eur(gastado)}</span>
            </div>
            <p className="mt-[11px] text-[10.5px] leading-relaxed text-subtle">
              Solo cuenta lo que el proveedor <b className="font-normal text-fg">sirvió</b>. Una
              petición fallida no se cobra ni se apunta. Una fila por día y origen, y nada se borra.
            </p>
            <div className="mt-3 flex gap-2">
              <input
                value={topeTexto}
                onChange={(e) => setTopeTexto(e.target.value)}
                inputMode="decimal"
                aria-label="Tope mensual en euros"
                className="w-24 rounded border border-border bg-black/30 px-2 py-1
                  font-mono text-[10.5px] text-fg outline-none focus:border-white/30"
              />
              <button onClick={() => void guardarTope()}
                className="jg-press rounded-lg border border-white/15 px-[13px] py-[6px] text-[10.5px] text-fg">
                Cambiar el tope
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
