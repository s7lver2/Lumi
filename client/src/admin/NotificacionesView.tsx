import { useEffect, useState } from "react";
import { api, type AvisoInfo, type UserSummary } from "../lib/api";
import { Icon, type IconName } from "../ui/Icon";
import { AvisoEditor } from "./AvisoEditor";
import { Seccion } from "./AdminPanel";

const ICONOS: IconName[] = ["bell", "alert", "wrench", "boxes", "cloud", "shield", "globe", "layers"];
const DOC_VACIO = { type: "doc", content: [{ type: "paragraph" }] };

function ago(ts: number): string {
  const s = Math.max(0, Math.floor(Date.now() / 1000) - ts);
  if (s < 60) return "ahora";
  if (s < 3600) return `${Math.floor(s / 60)} min`;
  if (s < 86400) return `${Math.floor(s / 3600)} h`;
  return `${Math.floor(s / 86400)} d`;
}

export function NotificacionesView({ token }: { token: string }) {
  const [avisos, setAvisos] = useState<AvisoInfo[] | null>(null);
  const [contenido, setContenido] = useState<unknown>(DOC_VACIO);
  const [icono, setIcono] = useState<IconName>("bell");
  const [prioridad, setPrioridad] = useState<"normal" | "urgente">("normal");
  const [destino, setDestino] = useState<"todos" | "admins" | "personas">("todos");
  const [usuarios, setUsuarios] = useState<string[]>([]);
  const [busca, setBusca] = useState("");
  const [sugerencias, setSugerencias] = useState<UserSummary[]>([]);

  function cargar() { return api.get<AvisoInfo[]>("/v1/admin/avisos", token).then(setAvisos); }
  useEffect(() => { void cargar(); }, [token]);

  useEffect(() => {
    const t = setTimeout(() => {
      if (!busca.trim()) { setSugerencias([]); return; }
      api.get<UserSummary[]>(`/v1/users/search?q=${encodeURIComponent(busca.trim())}`, token)
        .then((all) => setSugerencias(all.filter((u) => !usuarios.includes(u.username))))
        .catch(() => setSugerencias([]));
    }, 200);
    return () => clearTimeout(t);
  }, [busca, token, usuarios]);

  async function publicar() {
    const body = { contenido, icono, prioridad, destino, usuarios: destino === "personas" ? usuarios : [] };
    await api.post<AvisoInfo>("/v1/admin/avisos", body, token);
    setContenido(DOC_VACIO);
    setUsuarios([]);
    void cargar();
  }

  async function borrar(id: number) {
    await api.del(`/v1/avisos/${id}`, token);
    void cargar();
  }

  return (
    <Seccion titulo="Notificaciones" grupo="Operación">
      <p className="text-[11px] text-muted">Avisos escritos por ti para quien esté conectado.</p>

      <div className="mt-4">
        <AvisoEditor contenido={contenido} onChange={setContenido} />

        <div className="mt-2.5 flex flex-wrap items-center gap-4 rounded-card border border-border bg-panel p-3">
          <div className="flex items-center gap-1.5">
            <span className="text-[9px] uppercase tracking-[.06em] text-muted">Icono</span>
            {ICONOS.map((i) => (
              <button key={i} onClick={() => setIcono(i)}
                className={`grid h-6 w-6 place-items-center rounded-md border ${
                  icono === i ? "border-white/35 bg-white/[.07] text-fg" : "border-border text-muted"}`}>
                <Icon name={i} size={12} />
              </button>
            ))}
          </div>
          <div className="flex overflow-hidden rounded-lg border border-border">
            <button onClick={() => setPrioridad("normal")}
              className={`px-2.5 py-1 text-[10px] ${
                prioridad === "normal" ? "bg-draw/[.15] text-draw-fg" : "bg-elevated text-muted"}`}>Normal</button>
            <button onClick={() => setPrioridad("urgente")}
              className={`px-2.5 py-1 text-[10px] ${
                prioridad === "urgente" ? "bg-danger/[.18] text-danger-fg" : "bg-elevated text-muted"}`}>Urgente</button>
          </div>
        </div>

        <div className="mt-2.5 rounded-card border border-border bg-panel p-3">
          <div className="mb-2 flex gap-1.5">
            {(["todos", "admins", "personas"] as const).map((d) => (
              <button key={d} onClick={() => setDestino(d)}
                className={`rounded-lg border px-2.5 py-1 text-[10px] ${
                  destino === d ? "border-white/35 bg-white/[.07] text-fg" : "border-border text-muted"}`}>
                {d === "todos" ? "Todos" : d === "admins" ? "Administradores" : "Personas concretas"}
              </button>
            ))}
          </div>
          {destino === "personas" && (
            <div className="relative">
              <div className="mb-1.5 flex flex-wrap gap-1.5">
                {usuarios.map((u) => (
                  <span key={u} className="flex items-center gap-1.5 rounded-full border border-border
                    bg-elevated py-1 pl-2.5 pr-1 text-[10.5px] text-fg">
                    {u}
                    <button onClick={() => setUsuarios((us) => us.filter((x) => x !== u))}
                      className="text-subtle hover:text-danger-fg"><Icon name="x" size={9} /></button>
                  </span>
                ))}
              </div>
              <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="buscar usuario…"
                className="w-full rounded-lg border border-border bg-elevated px-2.5 py-1.5 text-[11px]
                  text-fg outline-none focus:border-white/40" />
              {sugerencias.length > 0 && (
                <div className="absolute inset-x-0 top-[calc(100%+4px)] z-10 max-h-[150px] overflow-y-auto
                  rounded-lg border border-white/10 bg-[rgba(20,22,26,.98)] p-1 shadow-lg shadow-black/50">
                  {sugerencias.map((u) => (
                    <button key={u.id}
                      onMouseDown={() => { setUsuarios((us) => [...us, u.username]); setBusca(""); setSugerencias([]); }}
                      className="flex w-full items-center gap-2 rounded-md p-1.5 text-left text-[11px]
                        text-fg hover:bg-white/[.05]">{u.username}</button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="mt-2.5 flex items-center gap-3">
          <p className="text-[9.5px] text-subtle">Llega a quien corresponda en cuanto se publica, sin recargar.</p>
          <button onClick={() => void publicar()}
            className="ml-auto rounded-lg bg-accent px-3 py-1.5 text-[11px] font-medium text-black">Publicar</button>
        </div>
      </div>

      <h3 className="mb-1.5 mt-6 text-[12.5px] font-medium">Avisos activos</h3>
      <div className="rounded-card border border-border bg-panel">
        {(avisos ?? []).length === 0 && <p className="p-6 text-center text-[11px] text-subtle">Sin avisos.</p>}
        {(avisos ?? []).map((a) => (
          <div key={a.id} className={`flex items-start gap-3 border-b border-border p-[12px_16px] last:border-b-0 ${
            a.prioridad === "urgente" ? "bg-danger/[.04]" : ""}`}>
            <span className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full ${
              a.prioridad === "urgente" ? "bg-danger/[.15] text-danger-fg" : "bg-draw/[.12] text-draw-fg"}`}>
              <Icon name={a.icono as IconName} size={12} />
            </span>
            <div className="min-w-0 flex-1">
              <AvisoEditor contenido={a.contenido} editable={false} />
              <p className="mt-1.5 flex items-center gap-2 text-[10px] text-subtle">
                {a.creado_por} · hace {ago(a.created_at)}
                {a.prioridad === "urgente" && (
                  <span className="rounded bg-danger/[.18] px-1.5 py-px text-[8.5px] uppercase text-danger-fg">urgente</span>
                )}
                <span className="rounded border border-border bg-elevated px-1.5 py-px text-[8.5px] text-subtle">{a.destino}</span>
              </p>
            </div>
            <button onClick={() => void borrar(a.id)}
              className="shrink-0 rounded-lg border border-danger/40 px-2.5 py-1 text-[9.5px] text-danger-fg">Eliminar</button>
          </div>
        ))}
      </div>
    </Seccion>
  );
}
