import { type ServerProfileSettings } from "../lib/api";
import { lumiUrl } from "../lib/bridge";
import { AvisoEditor } from "../admin/AvisoEditor";

/** Banner + foto + título + descripción + nº de miembros del servidor. Se
 *  repite en los tres momentos en los que alguien sin cuenta todavía lo ve
 *  por primera vez: añadir la tarjeta, solicitar acceso, y crear la cuenta
 *  tras la aprobación — un solo sitio para esa tarjeta, no tres copias. */
export function ServerProfileCard({ perfil }: { perfil: ServerProfileSettings }) {
  return (
    <div className="overflow-hidden rounded-[11px] border border-border">
      <div className="relative h-[86px] bg-elevated">
        {perfil.has_banner && (
          <img src={lumiUrl("/v1/server-profile/banner")} alt=""
            className="absolute inset-0 h-full w-full object-cover" />
        )}
        {perfil.has_avatar && (
          <img src={lumiUrl("/v1/server-profile/avatar")} alt=""
            className="absolute -bottom-5 left-3.5 h-11 w-11 rounded-[10px] border-[3px] border-panel object-cover" />
        )}
      </div>
      <div className="bg-panel p-3 pt-6">
        <p className="text-[13px] text-fg">{perfil.title}</p>
        <p className="mt-0.5 text-[10.5px] text-subtle">{perfil.member_count} miembros</p>
        {perfil.description ? (
          <div className="mt-2 text-[11px]">
            <AvisoEditor contenido={perfil.description} editable={false} />
          </div>
        ) : null}
      </div>
    </div>
  );
}
