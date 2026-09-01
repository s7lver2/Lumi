import { useEffect, useState } from "react";
import { api, type ApiKeyInfo, type IssuedApiKey, type MapConfig, type ProviderTokenState, type SecuritySettings } from "../lib/api";
import { Icon } from "../ui/Icon";
import { IpInput } from "./IpInput";
import { Seccion } from "./AdminPanel";
import type { Seccion as SeccionId } from "./Sidebar";

const CLASES = [
  { id: "navegador", label: "Navegador", icon: "browser" as const },
  { id: "cli", label: "CLI", icon: "cli" as const },
  { id: "servidor", label: "Servidor", icon: "device" as const },
  { id: "movil", label: "Móvil", icon: "mobile" as const },
];

export function ApiKeysView({ token, onIr }: { token: string; onIr: (s: SeccionId) => void }) {
  const [pesos, setPesos] = useState<ProviderTokenState | null>(null);
  const [pesosValor, setPesosValor] = useState("");
  const [mapa, setMapa] = useState<MapConfig | null>(null);
  const [mapaValor, setMapaValor] = useState("");
  const [seguridad, setSeguridad] = useState<SecuritySettings | null>(null);
  const [claves, setClaves] = useState<ApiKeyInfo[] | null>(null);
  const [emitiendo, setEmitiendo] = useState(false);
  const [revelada, setRevelada] = useState<IssuedApiKey | null>(null);

  useEffect(() => { void api.get<ProviderTokenState>("/v1/admin/models/provider-token", token).then(setPesos); }, [token]);
  useEffect(() => { void api.get<MapConfig>("/v1/map/config", token).then(setMapa); }, [token]);
  useEffect(() => { void cargarSeguridad(); }, [token]);
  useEffect(() => { void cargarClaves(); }, [token]);

  function cargarSeguridad() { return api.get<SecuritySettings>("/v1/admin/security", token).then(setSeguridad); }
  function cargarClaves() { return api.get<ApiKeyInfo[]>("/v1/admin/api-keys", token).then(setClaves); }

  async function guardarPesos() {
    if (!pesosValor.trim()) return;
    const r = await api.patch<ProviderTokenState>("/v1/admin/models/provider-token", { token: pesosValor }, token);
    setPesos(r);
    setPesosValor("");
  }

  async function guardarMapa() {
    if (!mapaValor.trim() || !mapa?.theme) return;
    const r = await api.patch<MapConfig>("/v1/admin/map", { theme: mapa.theme, key: mapaValor, engine: null }, token);
    setMapa(r);
    setMapaValor("");
  }

  async function agregarIp(cual: "allowlist" | "denylist", ip: string) {
    if (!ip.trim()) return;
    await api.post<void>(`/v1/admin/security/${cual}`, { ip: ip.trim() }, token);
    void cargarSeguridad();
  }
  async function quitarIp(cual: "allowlist" | "denylist", ip: string) {
    await api.del(`/v1/admin/security/${cual}?ip=${encodeURIComponent(ip)}`, token);
    void cargarSeguridad();
  }

  async function revocar(publicId: string) {
    await api.del(`/v1/api-keys/${publicId}`, token);
    void cargarClaves();
  }

  async function regenerar(publicId: string, password: string) {
    const r = await api.post<IssuedApiKey>(`/v1/api-keys/${publicId}/regenerate`, { password }, token);
    setRevelada(r);
    void cargarClaves();
  }

  return (
    <Seccion titulo="API Keys" grupo="Servidor">
      <p className="text-[11px] text-muted">Credenciales de terceros y claves para llamar a la API.</p>

      <h3 className="mb-1.5 mt-6 text-[12.5px] font-medium">Credenciales de terceros</h3>
      <div className="flex items-center gap-3 rounded-card border border-border p-[11px_14px]">
        <span className="min-w-0 text-[11.5px] text-muted">
          Mapbox
          <small className="ml-2 text-[9.5px] text-subtle">clave del proveedor de mapas</small>
        </span>
        {mapa?.theme ? (
          <>
            <input type="password" value={mapaValor} onChange={(e) => setMapaValor(e.target.value)}
              placeholder={mapa.has_key ? "clave guardada · escribe para sustituirla" : "clave de Mapbox"}
              className="ml-auto min-w-[180px] flex-1 rounded-lg border border-border bg-elevated px-2.5 py-1 font-mono text-[10.5px] text-fg outline-none focus:border-white/40" />
            <button onClick={() => void guardarMapa()}
              className={`shrink-0 overflow-hidden whitespace-nowrap rounded-lg border border-white/15 py-1 text-[10.5px] text-fg transition-[max-width,opacity,padding] duration-[420ms] ease-expo ${
                mapaValor.trim() ? "max-w-[100px] px-2.5 opacity-100" : "pointer-events-none max-w-0 px-0 opacity-0"}`}>
              Guardar
            </button>
          </>
        ) : (
          <span className="ml-auto flex items-center gap-2 text-[10.5px] text-subtle">
            <Icon name="alert" size={12} />
            Elige un tema en Customización primero.
          </span>
        )}
      </div>
      <div className="mt-2.5 flex items-center gap-3 rounded-card border border-border p-[11px_14px]">
        <span className="min-w-0 text-[11.5px] text-muted">
          Proveedor de pesos
          <small className="ml-2 text-[9.5px] text-subtle">para modelos tras la puerta de su proveedor</small>
        </span>
        <input type="password" value={pesosValor} onChange={(e) => setPesosValor(e.target.value)}
          placeholder={pesos?.has_token ? "token guardado · escribe para sustituirlo" : "token del proveedor"}
          className="ml-auto min-w-[180px] flex-1 rounded-lg border border-border bg-elevated px-2.5 py-1 font-mono text-[10.5px] text-fg outline-none focus:border-white/40" />
        <button onClick={() => void guardarPesos()}
          className={`shrink-0 overflow-hidden whitespace-nowrap rounded-lg border border-white/15 py-1 text-[10.5px] text-fg transition-[max-width,opacity,padding] duration-[420ms] ease-expo ${
            pesosValor.trim() ? "max-w-[100px] px-2.5 opacity-100" : "pointer-events-none max-w-0 px-0 opacity-0"}`}>
          Guardar
        </button>
      </div>

      <h3 className="mb-1.5 mt-6 text-[12.5px] font-medium">Listas globales de IP</h3>
      {seguridad?.zero_trust ? (
        <div className="rounded-card border border-border bg-panel">
          <ListaIp titulo="Blanca" sub="siempre permitida" valores={seguridad.allowlist}
            onAgregar={(ip) => void agregarIp("allowlist", ip)} onQuitar={(ip) => void quitarIp("allowlist", ip)} />
          <ListaIp titulo="Negra" sub="siempre bloqueada" valores={seguridad.denylist}
            onAgregar={(ip) => void agregarIp("denylist", ip)} onQuitar={(ip) => void quitarIp("denylist", ip)} />
        </div>
      ) : (
        <p className="flex items-center gap-2 rounded-card border border-border p-[11px_14px] text-[10.5px] text-subtle">
          <Icon name="alert" size={13} />
          Requiere Zero Trust.{" "}
          <button onClick={() => onIr("seguridad" as SeccionId)} className="text-fg underline">Activarlo →</button>
        </p>
      )}

      <div className="mb-2.5 mt-6 flex items-center gap-3">
        <h3 className="text-[12.5px] font-medium">Claves de API</h3>
        <button onClick={() => setEmitiendo(true)} className="ml-auto rounded-lg bg-accent px-3 py-1.5 text-[11px] font-medium text-black">
          + Emitir clave
        </button>
      </div>
      <div className="rounded-card border border-border bg-panel">
        {(claves ?? []).length === 0 && <p className="p-6 text-center text-[11px] text-subtle">Sin claves.</p>}
        {(claves ?? []).map((k) => (
          <FilaClave key={k.public_id} clave={k}
            onRevocar={() => void revocar(k.public_id)}
            onRegenerar={(password) => regenerar(k.public_id, password)} />
        ))}
      </div>

      {emitiendo && (
        <ModalEmitir token={token} soloParaMi={false}
          onCancelar={() => setEmitiendo(false)}
          onCreada={(r) => { setEmitiendo(false); setRevelada(r); void cargarClaves(); }} />
      )}
      {revelada && <ModalRevelada revelada={revelada} onCerrar={() => setRevelada(null)} />}
    </Seccion>
  );
}

function ListaIp({ titulo, sub, valores, onAgregar, onQuitar }: {
  titulo: string; sub: string; valores: string[]; onAgregar: (ip: string) => void; onQuitar: (ip: string) => void;
}) {
  return (
    <div className="border-b border-border p-[13px_16px] last:border-b-0">
      <p className="mb-2 text-[11px] text-fg">{titulo} <span className="text-[9px] text-subtle">— {sub}</span></p>
      <div className="mb-2 flex flex-wrap gap-1.5">
        {valores.map((ip) => (
          <span key={ip} className="flex items-center gap-1.5 rounded-lg border border-border bg-elevated py-1 pl-2.5 pr-1 font-mono text-[10.5px] text-fg">
            {ip}
            <button onClick={() => onQuitar(ip)} className="rounded p-0.5 text-subtle hover:text-danger-fg"><Icon name="x" size={9} /></button>
          </span>
        ))}
        {valores.length === 0 && <span className="text-[10px] italic text-subtle">vacía</span>}
      </div>
      <IpInput onAgregar={onAgregar} />
    </div>
  );
}

function FilaClave({ clave, onRevocar, onRegenerar }: {
  clave: ApiKeyInfo; onRevocar: () => void; onRegenerar: (password: string) => Promise<unknown>;
}) {
  const [confirmando, setConfirmando] = useState(false);
  const [regenerando, setRegenerando] = useState(false);
  return (
    <div className="grid grid-cols-[auto_1.3fr_1fr_auto_auto_auto] items-center gap-3 border-b border-border p-[11px_16px] last:border-b-0">
      <div className={`grid h-6 w-6 place-items-center rounded-lg border text-[9.5px] text-muted ${clave.owner_is_service ? "border-dashed" : "border-border bg-elevated"}`}>
        {clave.owner_is_service ? <Icon name="boxes" size={12} /> : clave.owner_username.slice(0, 2).toUpperCase()}
      </div>
      <div><p className="text-[11.5px] text-fg">{clave.label}</p><p className="mt-0.5 font-mono text-[10px] text-subtle">{clave.prefix}</p></div>
      <div className="text-[11px] text-fg">{clave.owner_username}</div>
      <div className="flex gap-1">
        {CLASES.map((c) => (
          <span key={c.id} title={c.label}
            className={`grid h-[22px] w-[22px] place-items-center rounded-md border ${clave.devices.includes(c.id) ? "border-white/30 text-fg" : "border-border text-subtle"}`}>
            <Icon name={c.icon} size={11} />
          </span>
        ))}
      </div>
      <button onClick={() => setRegenerando(true)} className="rounded-lg border border-white/15 px-2.5 py-1 text-[9.5px] text-fg">
        Regenerar
      </button>
      {confirmando ? (
        <div className="flex items-center gap-2 text-[10.5px]">
          <span className="text-warning-fg">¿Seguro?</span>
          <button onClick={() => setConfirmando(false)} className="text-subtle">No</button>
          <button onClick={onRevocar} className="rounded-lg border border-danger/40 px-2 py-1 text-danger-fg">Sí</button>
        </div>
      ) : (
        <button onClick={() => setConfirmando(true)} className="rounded-lg border border-danger/40 px-2.5 py-1 text-[9.5px] text-danger-fg">Revocar</button>
      )}
      {regenerando && (
        <ModalRegenerar onCancelar={() => setRegenerando(false)}
          onConfirmar={async (password) => { await onRegenerar(password); setRegenerando(false); }} />
      )}
    </div>
  );
}

/** La clave ya no se puede volver a enseñar (se guarda como hash, ver
 *  `regenerate` en `crates/lumid/src/routes/api_keys.rs`) — regenerar la
 *  sustituye por una nueva sin tocar caducidad/IPs/dispositivos, y pide la
 *  contraseña de quien lo hace antes de sustituir un secreto vivo. */
function ModalRegenerar({ onCancelar, onConfirmar }: {
  onCancelar: () => void; onConfirmar: (password: string) => Promise<void>;
}) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function confirmar() {
    setEnviando(true); setError(null);
    try {
      await onConfirmar(password);
    } catch (e) {
      setError(String(e));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6" onClick={(e) => { if (e.target === e.currentTarget) onCancelar(); }}>
      <div className="w-full max-w-[380px] rounded-2xl border border-white/[.13] bg-[rgba(16,19,25,.92)] p-[20px_22px] backdrop-blur-xl">
        <h3 className="mb-2 text-[14px] font-medium">Regenerar clave</h3>
        <p className="mb-3 text-[11px] text-muted">
          La clave actual deja de funcionar de inmediato. Confirma tu contraseña para sustituirla por una nueva.
        </p>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && password) void confirmar(); }}
          placeholder="tu contraseña" autoFocus
          className="mb-1 w-full rounded-lg border border-border bg-elevated px-2.5 py-2 text-[11.5px] text-fg outline-none focus:border-white/40" />
        {error && <p className="mt-1.5 text-[10px] text-danger-fg">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onCancelar} className="rounded-lg px-3 py-1.5 text-[10.5px] text-subtle">Cancelar</button>
          <button onClick={() => void confirmar()} disabled={!password || enviando}
            className="rounded-lg bg-accent px-3 py-1.5 text-[10.5px] font-medium text-black disabled:opacity-40">
            {enviando ? "Regenerando…" : "Regenerar"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function ModalEmitir({ token, soloParaMi, onCancelar, onCreada }: {
  token: string; soloParaMi: boolean; onCancelar: () => void; onCreada: (r: IssuedApiKey) => void;
}) {
  const [label, setLabel] = useState("");
  const [expiry, setExpiry] = useState<"90" | "365" | "never">("90");
  const [devices, setDevices] = useState<string[]>([]);

  async function crear() {
    const body = {
      label: label.trim() || "sin etiqueta",
      user_id: null, service_name: null,
      expires_in_days: expiry === "never" ? null : Number(expiry),
      devices, ips: [] as string[],
    };
    const r = await api.post<IssuedApiKey>("/v1/api-keys", body, token);
    onCreada(r);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6" onClick={(e) => { if (e.target === e.currentTarget) onCancelar(); }}>
      <div className="w-full max-w-[440px] rounded-2xl border border-white/[.13] bg-[rgba(16,19,25,.92)] p-[20px_22px] backdrop-blur-xl">
        <h3 className="mb-4 text-[14px] font-medium">Emitir clave de API</h3>
        <label className="mb-1.5 block text-[9.5px] uppercase tracking-[.06em] text-muted">Etiqueta</label>
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={soloParaMi ? "p.ej. CLI de campo" : "p.ej. automatización nocturna"}
          className="mb-3.5 w-full rounded-lg border border-border bg-elevated px-2.5 py-2 text-[11.5px] text-fg outline-none focus:border-white/40" />
        <label className="mb-1.5 block text-[9.5px] uppercase tracking-[.06em] text-muted">Caduca</label>
        <div className="mb-3.5 flex gap-1.5">
          {(["90", "365", "never"] as const).map((e) => (
            <button key={e} onClick={() => setExpiry(e)}
              className={`flex-1 rounded-lg border py-1.5 text-[10.5px] ${expiry === e ? "border-white/40 bg-white/[.06] text-fg" : "border-border text-muted"}`}>
              {e === "90" ? "90 días" : e === "365" ? "1 año" : "Nunca"}
            </button>
          ))}
        </div>
        <label className="mb-1.5 block text-[9.5px] uppercase tracking-[.06em] text-muted">Dispositivos</label>
        <div className="mb-1.5 flex flex-wrap gap-1.5">
          {CLASES.map((c) => (
            <button key={c.id} onClick={() => setDevices((d) => d.includes(c.id) ? d.filter((x) => x !== c.id) : [...d, c.id])}
              className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[10.5px] ${devices.includes(c.id) ? "border-white/40 bg-white/[.06] text-fg" : "border-border text-muted"}`}>
              <Icon name={c.icon} size={11} />{c.label}
            </button>
          ))}
        </div>
        <p className="mb-4 text-[9px] text-subtle">Se comprueba por cabeceras, no es criptográfico.</p>
        <div className="flex justify-end gap-2">
          <button onClick={onCancelar} className="rounded-lg px-3 py-1.5 text-[10.5px] text-subtle">Cancelar</button>
          <button onClick={() => void crear()} className="rounded-lg bg-accent px-3 py-1.5 text-[10.5px] font-medium text-black">Crear</button>
        </div>
      </div>
    </div>
  );
}

export function ModalRevelada({ revelada, onCerrar }: { revelada: IssuedApiKey; onCerrar: () => void }) {
  const [copiado, setCopiado] = useState(false);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6">
      <div className="w-full max-w-[440px] rounded-2xl border border-white/[.13] bg-[rgba(16,19,25,.92)] p-[20px_22px] backdrop-blur-xl">
        <h3 className="mb-2 text-[14px] font-medium">Guarda esta clave ahora</h3>
        <p className="mb-3 flex items-center gap-2 text-[10px] text-warning-fg"><Icon name="alert" size={12} />Solo se muestra una vez.</p>
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-border bg-elevated p-[12px_14px]">
          <span className="flex-1 break-all font-mono text-[11.5px] text-fg">{revelada.key}</span>
          <button onClick={() => { void navigator.clipboard.writeText(revelada.key); setCopiado(true); setTimeout(() => setCopiado(false), 1400); }}
            className="rounded-lg border border-border px-2 py-1 text-[10px] text-fg">
            {copiado ? "Copiada" : "Copiar"}
          </button>
        </div>
        <div className="flex justify-end">
          <button onClick={onCerrar} className="rounded-lg bg-accent px-3 py-1.5 text-[10.5px] font-medium text-black">Listo</button>
        </div>
      </div>
    </div>
  );
}
