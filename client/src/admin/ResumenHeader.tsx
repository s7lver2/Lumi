import { useEffect, useState } from "react";
import { api, type NetworkView as NetworkViewData, type ServerProfileSettings } from "../lib/api";
import { lumiUrl } from "../lib/bridge";
import { AvisoEditor } from "./AvisoEditor";

function desdeHace(epoch: number): string {
  const s = Math.max(0, Math.floor(Date.now() / 1000) - epoch);
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600);
  if (d > 0) return `${d} d ${String(h).padStart(2, "0")} h`;
  return `${h} h ${String(Math.floor((s % 3600) / 60)).padStart(2, "0")} min`;
}

/** Cabecera del Resumen: identidad del servidor (perfil) + tarjeta de
 *  servidor copiable en una pastilla superpuesta. Cae al título simple de
 *  siempre si no hay perfil configurado — la tarjeta se sigue mostrando
 *  igual, no depende de que haya perfil.
 *
 *  Deliberadamente NO reutiliza `ServerProfileCard` (pensado para el popup
 *  de "Añadir servidor": banner fijo pequeño, sin overlay de tarjeta):
 *  esta cabecera es de ancho completo y lleva la pastilla superpuesta,
 *  suficiente distinto como para no forzar un único componente con dos
 *  formas. */
export function ResumenHeader({ token, arrancadoEn, perfil }: {
  token: string; arrancadoEn: number; perfil: ServerProfileSettings | null;
}) {
  const [red, setRed] = useState<NetworkViewData | null>(null);
  const [copiado, setCopiado] = useState(false);

  useEffect(() => { api.networkGet(token).then(setRed).catch(() => setRed(null)); }, [token]);

  function copiar() {
    if (!red) return;
    void navigator.clipboard.writeText(red.server_card);
    setCopiado(true);
    setTimeout(() => setCopiado(false), 1500);
  }

  const pill = red && (
    <div className="flex items-center gap-1.5 rounded-lg border border-white/15 bg-black/45 px-2 py-1 backdrop-blur-sm">
      <code className="max-w-[220px] truncate font-mono text-[9.5px] text-subtle">{red.server_card}</code>
      <button onClick={copiar} className="jg-press shrink-0 rounded-md bg-white/10 px-1.5 py-0.5 text-[8.5px] text-fg">
        {copiado ? "Copiada" : "Copiar"}
      </button>
    </div>
  );

  if (!perfil?.title) {
    return (
      <div className="flex items-end gap-3 border-b border-border pb-[11px]">
        <h2 className="text-[21px] font-medium leading-none tracking-[-.025em]">Resumen</h2>
        <span className="ml-auto pb-0.5 font-mono text-[10.5px] text-subtle">
          en marcha desde hace {desdeHace(arrancadoEn)}
        </span>
        {pill}
      </div>
    );
  }

  return (
    <div className="relative h-[92px] overflow-hidden rounded-[11px] border border-border">
      {perfil.has_banner ? (
        <img src={lumiUrl("/v1/server-profile/banner")} alt="" className="absolute inset-0 h-full w-full object-cover" />
      ) : (
        <div className="absolute inset-0 bg-elevated" />
      )}
      <div className="absolute inset-0 bg-gradient-to-r from-black/10 via-black/40 to-black/85" />
      {perfil.has_avatar && (
        <img src={lumiUrl("/v1/server-profile/avatar")} alt=""
          className="absolute bottom-3.5 left-3.5 h-11 w-11 rounded-[10px] border-2 border-bg object-cover" />
      )}
      <div className="absolute bottom-3.5 left-[66px] right-3.5">
        <p className="text-[15px] font-medium text-fg [text-shadow:0_1px_3px_rgba(0,0,0,.6)]">{perfil.title}</p>
        {perfil.description ? (
          <div className="mt-0.5 max-w-[420px] text-[10px] text-white/70 [&_p]:m-0">
            <AvisoEditor contenido={perfil.description} editable={false} compacto />
          </div>
        ) : null}
      </div>
      <div className="absolute right-3 top-3">{pill}</div>
    </div>
  );
}
