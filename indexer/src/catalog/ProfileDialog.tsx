import { useEffect, useState } from "react";

import { api, type Perfil } from "../lib/api";

/** La ficha de una cuenta. Sin publicaciones no es un error: es una cuenta de
 *  GitHub normal que todavía no ha publicado nada para Lumi. */
export function ProfileDialog({ cuenta, onCerrar }: { cuenta: string; onCerrar: () => void }) {
  const [perfil, setPerfil] = useState<Perfil | null>(null);

  useEffect(() => { void api.catalogoPerfil(cuenta).then(setPerfil); }, [cuenta]);

  return (
    <div className="w-[440px] rounded-card border border-white/[.13] bg-[rgba(16,19,25,.66)] p-[20px_22px] backdrop-blur-xl">
      <p className="font-mono text-sm text-fg">{cuenta}</p>
      {perfil && perfil.publicaciones.length === 0 && (
        <p className="mt-2.5 text-[11px] leading-relaxed text-muted">
          Esta cuenta no ha publicado nada para Lumi.
        </p>
      )}
      {perfil && perfil.publicaciones.length > 0 && (
        <>
          <p className="mt-1.5 font-mono text-[10.5px] text-subtle">
            {perfil.publicaciones.length} índices · {perfil.teselas} teselas
          </p>
          <div className="mt-3 flex flex-col gap-1">
            {perfil.publicaciones.map((p) => (
              <a key={p.paquete} href={p.url} target="_blank" rel="noreferrer"
                className="flex items-center justify-between rounded-lg border border-border px-3 py-1.5 text-[11px] text-fg">
                {p.nombre}
                <span className="font-mono text-[10px] text-subtle">
                  {p.teselas} teselas{p.viva ? "" : " · no disponible"}
                </span>
              </a>
            ))}
          </div>
        </>
      )}
      <div className="mt-4 flex justify-end">
        <button onClick={onCerrar} className="jg-press rounded-lg border border-border px-3.5 py-2 text-[11.5px] text-fg">
          Cerrar
        </button>
      </div>
    </div>
  );
}
