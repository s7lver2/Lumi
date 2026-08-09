import { useEffect, useRef, useState } from "react";

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
  const copiado = useRef(false);

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
      <p className="text-sm text-fg">Tu cuenta, y tu firma</p>
      <p className="mt-[5px] text-[11px] leading-relaxed text-muted">
        La cuenta dice dónde vivirán los índices que publiques. La clave dice quién los hizo, y va
        aparte: un repositorio que cambie de manos no cambia de autor.
      </p>

      {error && <p className="mt-3 text-[11px] leading-relaxed text-danger-fg">{error}</p>}

      {!codigo && !sesion && (
        <div className="mt-4 flex items-center justify-between">
          <button onClick={() => void arrancar()} className="jg-press rounded-lg border border-border px-3.5 py-2 text-[11.5px] text-fg">
            Conectar con GitHub
          </button>
          <button onClick={onSaltar} className="text-[11px] text-subtle hover:text-fg">
            continuar sin cuenta
          </button>
        </div>
      )}

      {codigo && !sesion && (
        <div className="mt-4">
          <p className="text-[11px] leading-relaxed text-muted">
            Abre <span className="font-mono text-[10.5px] text-fg">{codigo.url}</span> y escribe este código:
          </p>
          <p className="mt-2.5 font-mono text-[19px] tracking-[.22em] text-fg">{codigo.codigo}</p>
          <div className="mt-3.5 flex items-center justify-between">
            <span className="text-[11px] text-subtle">Esperando a que termines en el navegador…</span>
            <button
              onClick={() => { copiado.current = true; void navigator.clipboard.writeText(codigo.codigo); }}
              className="jg-press rounded-lg border border-border px-3 py-1.5 text-[11px] text-fg"
            >
              Copiar
            </button>
          </div>
        </div>
      )}

      {sesion && (
        <div className="mt-4">
          <div className="flex items-center gap-2.5 rounded-lg border border-border px-2.5 py-2">
            <Icon name="layers" size={13} className="text-fg" />
            <span className="flex-1 text-xs text-fg">{sesion.cuenta}</span>
            <span className="font-mono text-[10px] text-subtle">{sesion.huella}</span>
          </div>
          <p className="mt-3.5 text-[11px] leading-relaxed text-muted">
            Estas doce palabras son la única copia de tu clave de firma. No hay recuperación: si las
            pierdes, lo que publiques a partir de entonces irá firmado por otra clave.
          </p>
          <div className="mt-2.5 grid grid-cols-3 gap-1.5">
            {palabras.map((w, i) => (
              <span key={w + String(i)} className="rounded-md border border-border px-2 py-1 font-mono text-[10.5px] text-fg">
                <span className="text-subtle">{i + 1}.</span> {w}
              </span>
            ))}
          </div>
          <label className="mt-3.5 flex items-center gap-2 text-[11px] text-fg">
            <input type="checkbox" checked={guardado} onChange={(e) => setGuardado(e.target.checked)} />
            Las he guardado
          </label>
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
    </div>
  );
}
