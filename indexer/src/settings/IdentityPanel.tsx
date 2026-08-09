import { useEffect, useState } from "react";

import { api, type CodigoDispositivo, type Sesion } from "../lib/api";

/** El único sitio donde la identidad se toca: la sesión por un lado, la clave
 *  de firma por otro. Van separadas porque son cosas distintas — cerrar sesión
 *  no borra la clave, y rotar la clave no cierra la sesión. */
export function IdentityPanel() {
  const [sesion, setSesion] = useState<Sesion | null>(null);
  const [codigo, setCodigo] = useState<CodigoDispositivo | null>(null);
  const [palabras, setPalabras] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { void api.identidadLeer().then(setSesion); }, []);

  useEffect(() => {
    if (!codigo) return;
    let vivo = true;
    const t = setInterval(() => {
      void api.identidadSondear().then((s) => {
        if (!vivo || !s) return;
        setSesion(s);
        setCodigo(null);
      }, (e) => { if (vivo) setError(String(e)); });
    }, codigo.intervalo * 1000);
    return () => { vivo = false; clearInterval(t); };
  }, [codigo]);

  async function conectar() {
    setError(null);
    try { setCodigo(await api.identidadArrancar("github")); } catch (e) { setError(String(e)); }
  }

  async function cerrar() {
    await api.identidadCerrar();
    setSesion(null);
  }

  return (
    <div className="h-full overflow-auto p-8">
      <div className="mx-auto w-full max-w-3xl">
        <p className="text-sm text-fg">Identidad</p>
        <p className="mt-[5px] text-[11px] leading-relaxed text-muted">
          Sin cuenta la aplicación funciona entera menos publicar. La cuenta dice dónde vive un
          paquete; la clave dice quién lo hizo.
        </p>

        {error && <p className="mt-3 text-[11px] leading-relaxed text-danger-fg">{error}</p>}

        <div className="mt-5 rounded-card border border-border bg-panel p-4">
          {sesion ? (
            <div className="flex items-center gap-3">
              <img src={sesion.avatar} alt="" className="h-8 w-8 rounded-full" />
              <div className="flex-1">
                <p className="text-xs text-fg">{sesion.cuenta}</p>
                <p className="mt-0.5 font-mono text-[10px] text-subtle">
                  {sesion.proveedor} · desde {sesion.desde} · {sesion.permisos.join(" ")}
                </p>
              </div>
              <button onClick={() => void conectar()} className="jg-press rounded-lg border border-border px-3 py-1.5 text-[11px] text-fg">
                Cambiar de cuenta
              </button>
              <button onClick={() => void cerrar()} className="jg-press rounded-lg border border-border px-3 py-1.5 text-[11px] text-subtle">
                Cerrar sesión
              </button>
            </div>
          ) : codigo ? (
            <div>
              <p className="text-[11px] leading-relaxed text-muted">
                Abre <span className="font-mono text-[10.5px] text-fg">{codigo.url}</span> y escribe:
              </p>
              <p className="mt-2 font-mono text-[17px] tracking-[.22em] text-fg">{codigo.codigo}</p>
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <p className="text-[11px] text-muted">Ninguna cuenta conectada.</p>
              <button onClick={() => void conectar()} className="jg-press rounded-lg border border-border px-3.5 py-2 text-[11.5px] text-fg">
                Conectar con GitHub
              </button>
            </div>
          )}
        </div>

        <div className="mt-3 rounded-card border border-border bg-panel p-4">
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <p className="text-xs text-fg">Clave de firma</p>
              <p className="mt-0.5 font-mono text-[10.5px] text-subtle">
                {sesion?.huella || "sin clave todavía"}
              </p>
            </div>
            <button
              onClick={() => void api.identidadRespaldo().then(setPalabras)}
              className="jg-press rounded-lg border border-border px-3 py-1.5 text-[11px] text-fg"
            >
              Ver respaldo
            </button>
            <button
              onClick={() => void api.identidadRotar().then((p) => {
                setPalabras(p);
                void api.identidadLeer().then(setSesion);
              })}
              className="jg-press rounded-lg border border-border px-3 py-1.5 text-[11px] text-subtle"
            >
              Rotar
            </button>
          </div>
          <p className="mt-2.5 text-[11px] leading-relaxed text-muted">
            Lo ya publicado conserva la firma vieja y sigue siendo válido: rotar no invalida nada,
            solo cambia con qué se firma a partir de ahora.
          </p>
          {palabras && (
            <div className="mt-3 grid grid-cols-4 gap-1.5">
              {palabras.map((w, i) => (
                <span key={w + String(i)} className="rounded-md border border-border px-2 py-1 font-mono text-[10.5px] text-fg">
                  <span className="text-subtle">{i + 1}.</span> {w}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
