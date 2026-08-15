import { useEffect, useState } from "react";
import { api, type SecuritySettings } from "../lib/api";
import { Seccion } from "./AdminPanel";

const SERVICIOS: { id: string; label: string }[] = [
  { id: "modelos", label: "Modelos" },
  { id: "indices", label: "Índices" },
  { id: "mapa", label: "Customización" },
  { id: "cola", label: "Cola" },
  { id: "proyectos", label: "Proyectos y casos" },
  { id: "personas", label: "Personas" },
  { id: "claves", label: "API Keys" },
];

/** El interruptor de Zero Trust y sus opciones dependientes, y el de modo
 *  mantenimiento con las suyas — mismo patrón de despliegue para ambos: el
 *  interruptor de arriba muestra u oculta lo que solo tiene sentido con él
 *  activado, en vez de dejarlo ahí atenuado todo el tiempo. Las listas
 *  globales de IP viven en API Keys — junto a la tabla de claves que
 *  gobiernan, no aquí. */
export function SecurityView({ token }: { token: string }) {
  const [ajustes, setAjustes] = useState<SecuritySettings | null>(null);
  const [mensaje, setMensaje] = useState("");

  useEffect(() => {
    void api.get<SecuritySettings>("/v1/admin/security", token).then(setAjustes);
  }, [token]);

  useEffect(() => {
    if (ajustes) setMensaje(ajustes.maintenance_message);
  }, [ajustes?.maintenance_message]);

  async function fijar(patch: Partial<Pick<SecuritySettings,
    "zero_trust" | "self_service_ip" | "maintenance" | "maintenance_message"
    | "maintenance_block_login" | "maintenance_services"
  >>) {
    const r = await api.patch<SecuritySettings>("/v1/admin/security", patch, token);
    setAjustes(r);
  }

  async function alternarServicio(id: string, estaActivo: boolean) {
    if (!ajustes) return;
    const next = estaActivo
      ? ajustes.maintenance_services.filter((s) => s !== id)
      : [...ajustes.maintenance_services, id];
    await fijar({ maintenance_services: next });
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
        {/* `grid-template-rows: 0fr → 1fr` anima el alto sin conocerlo de
            antemano — hace falta para un contenido que va a crecer según se
            añadan más opciones aquí dentro. */}
        <div className="grid transition-[grid-template-rows] duration-[420ms] ease-expo"
          style={{ gridTemplateRows: ajustes.zero_trust ? "1fr" : "0fr" }}>
          <div className="overflow-hidden">
            <div className="border-t border-border bg-black/15 pl-6">
              <SubFila
                titulo="Autoservicio de IP"
                sub={ajustes.self_service_ip ? "Cada usuario gestiona la IP de sus propias claves." : "Solo un admin puede tocarla."}
                on={ajustes.self_service_ip}
                onClick={() => void fijar({ self_service_ip: !ajustes.self_service_ip })}
              />
              {/* Próximas opciones de Zero Trust (clases de dispositivo por
                  defecto, expiración forzada de claves, etc.) van aquí, no en
                  una fila hermana nueva — este es el hueco pensado para eso. */}
            </div>
          </div>
        </div>
      </div>

      <div className="mt-4 rounded-card border border-border bg-panel">
        <Fila
          titulo="Modo mantenimiento"
          sub="Bloquea la API salvo lo que actives abajo. Los administradores nunca se quedan fuera."
          on={ajustes.maintenance}
          onClick={() => void fijar({ maintenance: !ajustes.maintenance })}
        />
        <div className="grid transition-[grid-template-rows] duration-[420ms] ease-expo"
          style={{ gridTemplateRows: ajustes.maintenance ? "1fr" : "0fr" }}>
          <div className="overflow-hidden">
            <div className="border-t border-border bg-black/15 p-[13px_16px_16px]">
              <label className="mb-1.5 block text-[9.5px] uppercase tracking-[.06em] text-muted">
                Mensaje de la tira de aviso
              </label>
              <textarea
                value={mensaje}
                onChange={(e) => setMensaje(e.target.value)}
                onBlur={() => { if (mensaje !== ajustes.maintenance_message) void fijar({ maintenance_message: mensaje }); }}
                placeholder="Servidor en mantenimiento."
                rows={2}
                className="mb-3 w-full resize-y rounded-lg border border-border bg-elevated px-2.5 py-2
                  text-[11px] text-fg outline-none focus:border-white/40"
              />
              <SubFila
                titulo="Bloquear login de usuarios"
                sub="Los administradores siempre pueden entrar, esté esto activo o no."
                on={ajustes.maintenance_block_login}
                onClick={() => void fijar({ maintenance_block_login: !ajustes.maintenance_block_login })}
              />
              <p className="mb-2 mt-3.5 text-[9.5px] uppercase tracking-[.06em] text-muted">
                Servicios habilitados durante el mantenimiento
              </p>
              <div className="grid grid-cols-2 gap-1.5">
                {SERVICIOS.map((s) => {
                  const on = ajustes.maintenance_services.includes(s.id);
                  return (
                    <button key={s.id} onClick={() => void alternarServicio(s.id, on)}
                      className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-[10.5px]
                        transition-colors duration-200 ${on ? "border-white/30 bg-white/[.06] text-fg" : "border-border text-muted"}`}>
                      <span className={`h-[6px] w-[6px] rounded-full ${on ? "bg-fg" : "bg-subtle"}`} />
                      {s.label}
                    </button>
                  );
                })}
              </div>
              <p className="mt-3 text-[9px] leading-relaxed text-subtle">
                Todo lo demás queda en 503 con el mensaje de arriba. Nada se bloquea en silencio.
              </p>
            </div>
          </div>
        </div>
      </div>
    </Seccion>
  );
}

/** Como `Fila`, pero para una opción que vive DENTRO de otro interruptor:
 *  algo más compacta y sin el atenuado por `disabled` — si se ve, ya está
 *  disponible, el propio despliegue es la condición. */
function SubFila({ titulo, sub, on, onClick }: {
  titulo: string; sub: string; on: boolean; onClick: () => void;
}) {
  return (
    <div className="flex items-center gap-3.5 border-t border-border/60 p-[11px_16px] first:border-t-0">
      <button
        onClick={onClick}
        className={`relative h-[19px] w-8 shrink-0 cursor-pointer rounded-full border transition-colors duration-300 ease-expo ${
          on ? "border-white/30 bg-white/[.14]" : "border-border bg-elevated"
        }`}
      >
        <span className={`absolute left-[2px] top-[2px] h-[13px] w-[13px] rounded-full transition-transform duration-300 ease-expo ${
          on ? "translate-x-[13px] bg-fg" : "bg-subtle"
        }`} />
      </button>
      <div className="min-w-0">
        <p className="text-[11.5px] text-fg">{titulo}</p>
        <p className="mt-0.5 text-[9.5px] text-subtle">{sub}</p>
      </div>
    </div>
  );
}

function Fila({ titulo, sub, on, onClick }: {
  titulo: string; sub: string; on: boolean; onClick: () => void;
}) {
  return (
    <div className="flex items-center gap-3.5 border-b border-border p-[13px_16px] last:border-b-0">
      <button
        onClick={onClick}
        className={`relative h-[21px] w-9 shrink-0 cursor-pointer rounded-full border transition-colors duration-300 ease-expo ${
          on ? "border-white/30 bg-white/[.14]" : "border-border bg-elevated"
        }`}
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
