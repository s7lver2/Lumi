import { save } from "@tauri-apps/plugin-dialog";
import { useEffect, useState } from "react";

import { api, type CodigoDispositivo, type Sesion } from "../lib/api";
import { Icon } from "../ui/Icon";

/** El paso de identidad del asistente. Saltable a propósito: sin cuenta la
 *  aplicación funciona entera menos publicar, y bloquear el arranque por un
 *  inicio de sesión que quizá no se necesita hoy sería un mal cambio. */
export function IdentityStep({ onHecho, onSaltar }: { onHecho: () => void; onSaltar: () => void }) {
  const [codigo, setCodigo] = useState<CodigoDispositivo | null>(null);
  const [sesion, setSesion] = useState<Sesion | null>(null);
  const [palabras, setPalabras] = useState<string[]>([]);
  const [guardado, setGuardado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);

  // El sondeo vive mientras haya un código en vuelo y no haya sesión. Mismo
  // patrón que `LegacyImportDialog`: un intervalo, y se limpia al salir.
  useEffect(() => {
    if (!codigo || sesion) return;
    let vivo = true;
    const t = setInterval(() => {
      void api.identidadSondear().then(
        (r) => {
          if (!vivo) return;
          // GitHub pide ir más despacio: sumar 5 s y reiniciar el intervalo
          // desde ese valor es parte del protocolo, no un reintento cualquiera
          // — ignorarlo deja esta pantalla esperando para siempre.
          if (r.mas_despacio) { setCodigo((c) => (c ? { ...c, intervalo: c.intervalo + 5 } : c)); return; }
          if (!r.sesion) return;
          setSesion(r.sesion);
          void api.identidadRespaldo().then(setPalabras);
        },
        (e) => { if (vivo) { setError(String(e)); setCodigo(null); } },
      );
    }, codigo.intervalo * 1000);
    return () => { vivo = false; clearInterval(t); };
  }, [codigo, sesion]);

  useEffect(() => {
    if (!copiado) return;
    const t = setTimeout(() => setCopiado(false), 1600);
    return () => clearTimeout(t);
  }, [copiado]);

  async function guardarRespaldo() {
    const ruta = await save({ defaultPath: "recovery.txt", filters: [{ name: "Texto", extensions: ["txt"] }] });
    if (ruta) await api.identidadRespaldoGuardar(ruta, palabras);
  }

  async function arrancar() {
    setError(null);
    try {
      setCodigo(await api.identidadArrancar("github"));
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <div className="rounded-card border border-white/[.13] bg-[rgba(16,19,25,.66)] p-[20px_22px] backdrop-blur-xl">
      {!codigo && !sesion && !error && (
        <div className="py-2 text-center" style={{ animation: "jg-fade-rise .3s cubic-bezier(.16,1,.3,1) both" }}>
          <div className="mx-auto grid h-11 w-11 place-items-center rounded-full bg-white/[.05]">
            <Icon name="github" size={20} className="text-fg" />
          </div>
          <p className="mt-3 text-sm text-fg">Conecta tu cuenta</p>
          <p className="mx-auto mt-1.5 max-w-[380px] text-[11px] leading-relaxed text-muted">
            Hace falta para publicar índices y para que otros sepan quién los firmó. Buscar, descargar
            e indexar funcionan igual sin ella.
          </p>
          <button onClick={() => void arrancar()}
            className="jg-press mx-auto mt-4 flex items-center justify-center gap-2 rounded-lg border border-border px-4 py-2 text-[11.5px] text-fg hover:bg-white/[.04]">
            <Icon name="github" size={14} />
            Conectar con GitHub
          </button>
          <button onClick={onSaltar} className="mt-3 text-[10.5px] text-subtle underline underline-offset-2 hover:text-fg">
            continuar sin cuenta
          </button>
        </div>
      )}

      {codigo && !sesion && (
        <div className="py-1 text-center" style={{ animation: "jg-fade-rise .3s cubic-bezier(.16,1,.3,1) both" }}>
          <p className="text-[10px] uppercase tracking-[.1em] text-subtle">paso 1 de 2</p>
          <p className="mt-2 text-sm text-fg">Escribe este código en GitHub</p>
          <div className="mx-auto mt-3.5 w-fit rounded-lg border border-border bg-[#0b0d0f] px-6 py-3.5">
            <p className="font-mono text-[22px] tracking-[.22em] text-fg">{codigo.codigo}</p>
          </div>
          <div className="mx-auto mt-2.5 flex max-w-[360px] items-center gap-1.5">
            <span className="flex-1 truncate rounded-lg border border-border bg-panel px-2.5 py-1.5 text-left font-mono text-[10px] text-subtle">
              {codigo.url}
            </span>
            <button
              onClick={() => { setCopiado(true); void navigator.clipboard.writeText(codigo.codigo); }}
              className="jg-press shrink-0 rounded-lg border border-border px-2.5 py-1.5 text-[10.5px] text-fg"
            >
              {copiado ? "Copiado" : "Copiar"}
            </button>
          </div>
          <div className="mt-4 flex items-center justify-center gap-2">
            <Icon name="spinner" size={12} className="animate-spin text-subtle" />
            <span className="text-[11px] text-muted">Esperando a que lo autorices…</span>
          </div>
          <button onClick={() => setCodigo(null)} className="mt-4 text-[10.5px] text-subtle underline underline-offset-2 hover:text-fg">
            cancelar
          </button>
        </div>
      )}

      {sesion && (
        <div style={{ animation: "jg-fade-rise .3s cubic-bezier(.16,1,.3,1) both" }}>
          <div className="flex items-center gap-3">
            {sesion.avatar
              ? <img src={sesion.avatar} alt="" className="h-10 w-10 rounded-full" />
              : <div className="grid h-10 w-10 place-items-center rounded-full bg-white/[.05]">
                  <Icon name="github" size={16} className="text-fg" />
                </div>}
            <div className="flex-1">
              <p className="text-[13px] text-fg">{sesion.cuenta}</p>
              <p className="mt-0.5 font-mono text-[10px] text-subtle">{sesion.proveedor}</p>
            </div>
            <span className="flex items-center gap-1.5 rounded-full border border-border px-2 py-px text-[9px] text-fg">
              <Icon name="check" size={9} /> conectado
            </span>
          </div>

          <div className="mt-3.5 rounded-lg border border-border bg-panel p-3.5">
            <p className="text-[11px] text-fg">Tu clave de firma</p>
            <p className="mt-1.5 text-[10.5px] leading-relaxed text-muted">
              Firma cada cosa que publiques. Vive cifrada en este equipo y <b className="font-medium text-fg">no se
              puede recuperar</b>: si pierdes el respaldo, hay que empezar con una clave nueva.
            </p>
            <div className="mt-2.5 rounded-lg border border-border bg-[#0b0d0f] px-3 py-2.5">
              <p className="text-[8.5px] uppercase tracking-[.1em] text-subtle">huella pública</p>
              <p className="mt-1 font-mono text-[11px] text-fg">{sesion.huella}</p>
              <div className="my-3 h-px bg-border" />
              <p className="text-[8.5px] uppercase tracking-[.1em] text-subtle">frase de respaldo · 12 palabras</p>
              <div className="mt-2 grid grid-cols-3 gap-1.5">
                {palabras.map((w, i) => (
                  <span key={w + String(i)} className="rounded-md border border-border px-2 py-1 font-mono text-[10.5px] text-fg">
                    <span className="text-subtle">{i + 1}.</span> {w}
                  </span>
                ))}
              </div>
            </div>
            <div className="mt-2.5 flex items-center justify-between">
              <label className="flex items-center gap-2 text-[11px] text-fg">
                <input type="checkbox" checked={guardado} onChange={(e) => setGuardado(e.target.checked)} />
                Las he guardado
              </label>
              <button onClick={() => void guardarRespaldo()} className="jg-press rounded-lg border border-border px-2.5 py-1 text-[10.5px] text-fg">
                Guardar en un fichero
              </button>
            </div>
          </div>

          <div className="mt-[17px] flex justify-end">
            <button
              onClick={onHecho}
              disabled={!guardado}
              className="jg-press rounded-lg bg-accent px-4 py-2 text-[11.5px] font-medium text-black disabled:opacity-40"
            >
              Continuar
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="py-2 text-center" style={{ animation: "jg-fade-rise .3s cubic-bezier(.16,1,.3,1) both" }}>
          <div className="mx-auto grid h-11 w-11 place-items-center rounded-full bg-danger/[.10]">
            <Icon name="alert" size={20} className="text-danger-fg" />
          </div>
          <p className="mt-3 text-sm text-fg">No se pudo hablar con GitHub</p>
          <p className="mx-auto mt-2 max-w-[380px] rounded-lg border border-border bg-[#0b0d0f] px-3 py-2 text-left font-mono text-[10px] leading-relaxed text-danger-fg">
            {error}
          </p>
          <p className="mx-auto mt-2.5 max-w-[360px] text-[10.5px] leading-relaxed text-subtle">
            El resto de la aplicación no necesita conexión con GitHub. Puedes seguir y conectar la cuenta
            más tarde desde Ajustes.
          </p>
          <div className="mt-4 flex justify-center gap-2.5">
            <button onClick={() => { setError(null); void arrancar(); }}
              className="jg-press rounded-lg border border-border px-3.5 py-2 text-[11.5px] text-fg">
              Reintentar
            </button>
            <button onClick={onSaltar}
              className="jg-press rounded-lg bg-accent px-3.5 py-2 text-[11.5px] font-medium text-black">
              Continuar sin cuenta
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
