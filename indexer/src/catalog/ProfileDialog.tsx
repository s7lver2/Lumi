import { useEffect, useState } from "react";

import { api, type Perfil, type PerfilGithub } from "../lib/api";
import { SourceBar } from "./SourceBar";

/** La ficha de una cuenta, con la misma forma que un perfil de GitHub: foto,
 *  nombre y bio salen de ahí porque ahí es donde vive esa información — Lumi
 *  no pide a nadie que la repita. Lo propio de Lumi son los índices debajo,
 *  cada uno con su barra de fuentes, igual que en la lista local. */
export function ProfileDialog({ cuenta, onCerrar }: { cuenta: string; onCerrar: () => void }) {
  const [perfil, setPerfil] = useState<Perfil | null>(null);
  const [github, setGithub] = useState<PerfilGithub | null>(null);

  useEffect(() => { void api.catalogoPerfil(cuenta).then(setPerfil); }, [cuenta]);
  useEffect(() => { void api.catalogoPerfilGithub(cuenta).then(setGithub, () => {}); }, [cuenta]);

  return (
    <div className="w-[440px] rounded-card border border-white/[.13] bg-[rgba(16,19,25,.66)] p-[20px_22px] backdrop-blur-xl">
      <div className="flex items-center gap-3">
        {github
          ? <img src={github.avatar_url} alt="" className="h-14 w-14 rounded-full border border-border" />
          : <div className="h-14 w-14 rounded-full border border-border bg-elevated" />}
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] text-fg">{github?.nombre || cuenta}</p>
          <a href={github?.url ?? `https://github.com/${cuenta}`} target="_blank" rel="noreferrer"
            className="truncate font-mono text-[11px] text-subtle hover:text-fg">
            @{cuenta}
          </a>
        </div>
      </div>

      {github?.bio && <p className="mt-3 text-[11px] leading-relaxed text-muted">{github.bio}</p>}

      {github && (
        <p className="mt-2.5 font-mono text-[10.5px] text-subtle">
          {github.seguidores} seguidores
        </p>
      )}

      <div className="mt-4 border-t border-border pt-3.5">
        {perfil && perfil.publicaciones.length === 0 && (
          <p className="text-[11px] leading-relaxed text-muted">
            Esta cuenta no ha publicado nada para Lumi.
          </p>
        )}
        {perfil && perfil.publicaciones.length > 0 && (
          <>
            <p className="font-mono text-[10.5px] text-subtle">
              {perfil.publicaciones.length} índices · {perfil.teselas} teselas
            </p>
            <div className="mt-2.5 flex flex-col gap-1.5">
              {perfil.publicaciones.map((p) => (
                <a key={p.paquete} href={p.url} target="_blank" rel="noreferrer"
                  className="rounded-lg border border-border px-3 py-2 text-[11px] text-fg hover:border-white/[.16]">
                  <div className="flex items-center justify-between">
                    {p.nombre}
                    <span className="font-mono text-[10px] text-subtle">
                      {p.teselas} teselas{p.viva ? "" : " · no disponible"}
                    </span>
                  </div>
                  <div className="mt-2">
                    <SourceBar fuentes={p.por_fuente} />
                  </div>
                </a>
              ))}
            </div>
          </>
        )}
      </div>

      <div className="mt-4 flex justify-end">
        <button onClick={onCerrar} className="jg-press rounded-lg border border-border px-3.5 py-2 text-[11.5px] text-fg">
          Cerrar
        </button>
      </div>
    </div>
  );
}
