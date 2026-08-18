import { useEffect, useState } from "react";
import { api, type PoliciesSettings } from "../lib/api";
import { AvisoEditor } from "./AvisoEditor";

/** El documento que se muestra al crear una cuenta nueva, si está activo.
 *  Mismo editor que los avisos (`AvisoEditor`) — sin barra de formato propia
 *  que mantener. El interruptor se guarda al instante (es un solo booleano);
 *  título y contenido se acumulan en un borrador local y se guardan juntos
 *  con "Guardar cambios", igual que el compositor de avisos en
 *  `NotificacionesView`. */
export function PolicyRow({ token }: { token: string }) {
  const [cfg, setCfg] = useState<PoliciesSettings | null>(null);
  const [titulo, setTitulo] = useState("");
  const [contenido, setContenido] = useState<unknown>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.policiesGet(token)
      .then((c) => { setCfg(c); setTitulo(c.title); setContenido(c.content); })
      .catch((e) => setError(String(e)));
  }, [token]);

  async function alternar() {
    if (!cfg) return;
    setError(null);
    try {
      setCfg(await api.policiesPatch({ active: !cfg.active }, token));
    } catch (e) {
      setError(String(e));
    }
  }

  async function guardar() {
    setBusy(true); setError(null);
    try {
      const c = await api.policiesPatch({ title: titulo, content: contenido }, token);
      setCfg(c);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!cfg) return null;

  const cambiado = titulo !== cfg.title || JSON.stringify(contenido) !== JSON.stringify(cfg.content);

  return (
    <div className="mt-4 rounded-card border border-border p-3.5">
      <div className="flex items-center gap-3.5">
        <button onClick={() => void alternar()}
          className={`relative h-[21px] w-9 shrink-0 cursor-pointer rounded-full border transition-colors duration-300 ease-expo ${
            cfg.active ? "border-white/30 bg-white/[.14]" : "border-border bg-elevated"}`}>
          <span className={`absolute left-[2px] top-[2px] h-[15px] w-[15px] rounded-full transition-transform duration-300 ease-expo ${
            cfg.active ? "translate-x-[15px] bg-fg" : "bg-subtle"}`} />
        </button>
        <div className="min-w-0">
          <p className="text-[12.5px] text-fg">Políticas de aceptación</p>
          <p className="mt-0.5 text-[10px] text-subtle">
            Quien crea una cuenta nueva tiene que leer y aceptar este documento antes de poder entrar.
          </p>
        </div>
      </div>

      {cfg.active && (
        <div className="mt-3.5 border-t border-border pt-3">
          <label className="mb-1.5 block text-[9.5px] uppercase tracking-[.06em] text-muted">Título</label>
          <input value={titulo} onChange={(e) => setTitulo(e.target.value)}
            placeholder="Términos de uso"
            className="mb-3 w-full rounded-lg border border-border bg-elevated px-2.5 py-2 text-[11.5px] text-fg outline-none focus:border-white/40" />
          <label className="mb-1.5 block text-[9.5px] uppercase tracking-[.06em] text-muted">Contenido</label>
          <AvisoEditor contenido={contenido} onChange={setContenido} />
          <div className="mt-3 flex items-center gap-2">
            <button onClick={guardar} disabled={busy || !cambiado}
              className="jg-press rounded-lg bg-accent px-3.5 py-1.5 text-[11px] font-medium text-black disabled:opacity-40">
              Guardar cambios
            </button>
          </div>
        </div>
      )}
      {error && <p className="mt-2.5 text-[11px] text-danger-fg">{error}</p>}
    </div>
  );
}
