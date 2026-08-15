import { useEffect, useState } from "react";
import { api, type SecuritySettings } from "../lib/api";
import { Seccion } from "./AdminPanel";

/** Solo los dos interruptores. Las listas globales de IP viven en API Keys —
 *  junto a la tabla de claves que gobiernan, no aquí. */
export function SecurityView({ token }: { token: string }) {
  const [ajustes, setAjustes] = useState<SecuritySettings | null>(null);

  useEffect(() => {
    void api.get<SecuritySettings>("/v1/admin/security", token).then(setAjustes);
  }, [token]);

  async function fijar(patch: Partial<Pick<SecuritySettings, "zero_trust" | "self_service_ip">>) {
    const r = await api.patch<SecuritySettings>("/v1/admin/security", patch, token);
    setAjustes(r);
  }

  if (!ajustes) return <Seccion titulo="Seguridad" grupo="Servidor"><p className="text-[11px] text-muted">cargando</p></Seccion>;

  return (
    <Seccion titulo="Seguridad" grupo="Servidor">
      <p className="text-[11px] text-muted">Quién puede llamar a la API, y desde dónde.</p>

      <div className="mt-4 rounded-card border border-border bg-panel">
        <Fila
          titulo="Modo Zero Trust"
          sub="Solo IPs autorizadas por clave. Bloqueadas siempre ganan."
          on={ajustes.zero_trust}
          onClick={() => void fijar({ zero_trust: !ajustes.zero_trust })}
        />
        <Fila
          titulo="Autoservicio de IP"
          sub={ajustes.zero_trust
            ? (ajustes.self_service_ip ? "Cada usuario gestiona la IP de sus propias claves." : "Solo un admin puede tocarla.")
            : "Se activa junto con Zero Trust."}
          on={ajustes.self_service_ip}
          disabled={!ajustes.zero_trust}
          onClick={() => void fijar({ self_service_ip: !ajustes.self_service_ip })}
        />
      </div>
    </Seccion>
  );
}

function Fila({ titulo, sub, on, disabled, onClick }: {
  titulo: string; sub: string; on: boolean; disabled?: boolean; onClick: () => void;
}) {
  return (
    <div className={`flex items-center gap-3.5 border-b border-border p-[13px_16px] last:border-b-0 ${disabled ? "opacity-45" : ""}`}>
      <button
        onClick={disabled ? undefined : onClick}
        aria-disabled={disabled}
        className={`relative h-[21px] w-9 shrink-0 rounded-full border transition-colors duration-300 ease-expo ${
          on ? "border-white/30 bg-white/[.14]" : "border-border bg-elevated"
        } ${disabled ? "cursor-not-allowed" : "cursor-pointer"}`}
      >
        <span className={`absolute left-[2px] top-[2px] h-[15px] w-[15px] rounded-full transition-transform duration-300 ease-expo ${
          on ? "translate-x-[15px] bg-fg" : "bg-subtle"
        }`} />
      </button>
      <div className="min-w-0">
        <p className="text-[12px] text-fg">{titulo}</p>
        <p className="mt-0.5 text-[10px] text-subtle">{sub}</p>
      </div>
    </div>
  );
}
