import { useState } from "react";
import { addrFromCard, api, fingerprintFromCard, isCard, type Hello, type ServerProfileSettings } from "../lib/api";
import { addServer } from "../lib/session";
import { Icon } from "../ui/Icon";
import { ServerProfileCard } from "./ServerProfileCard";

export function AddServerForm({ onAdded, onOwnerKey, onBack }: {
  onAdded: (addr: string) => void; onOwnerKey: (key: string) => void; onBack?: () => void;
}) {
  const [text, setText] = useState("");
  const [label, setLabel] = useState("");
  const [hello, setHello] = useState<Hello | null>(null);
  const [perfil, setPerfil] = useState<ServerProfileSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Una clave lumi1_ pegada aquí no es un error: significa "soy el owner y
  // vengo a aprovisionar". Pero no se salta sola al asistente: espera un
  // clic explícito, igual que guardar un servidor espera "Guardar servidor".
  const ownerKey = isCard(text.trim()) ? null : text.trim() || null;

  async function verify() {
    const s = text.trim();
    if (!s || !isCard(s)) return;
    setBusy(true); setError(null);
    try {
      setHello(await api.pairCard(s));
      // El popup enriquecido solo aparece si hay perfil configurado — sin
      // esto, "Servidor verificado" (la línea de siempre) desaparecería y
      // dejaría un hueco en blanco mientras se decide si hay algo que
      // mostrar.
      try {
        setPerfil(await api.serverProfilePublic());
      } catch {
        setPerfil(null);
      }
    } catch (e) {
      setHello(null);
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  function save() {
    const addr = addrFromCard(text);
    addServer({ addr, fingerprint: fingerprintFromCard(text), label: label.trim() || addr });
    onAdded(addr);
  }

  return (
    <>
      <label className="mb-[7px] block text-[11px] tracking-[.02em] text-muted">Clave del servidor</label>
      <input value={text} onChange={(e) => setText(e.target.value)} onBlur={verify}
        placeholder="lumi1s_192.168.1.40:7717_…"
        className="w-full rounded-lg border border-border bg-[#0d0f12] px-3 py-2.5 font-mono text-[12.5px] text-fg outline-none transition-[border-color,box-shadow] duration-300 ease-expo focus:border-white/40 focus:shadow-[0_0_0_3px_rgba(242,243,245,.055)]" />
      <p className="mt-2.5 max-w-[52ch] text-[11px] text-muted">Te la pasa quien administra el servidor.</p>

      {busy && (
        <div className="mt-3.5 flex items-center gap-2.5 text-xs text-muted">
          <Icon name="spinner" /> Comprobando el servidor
        </div>
      )}

      {ownerKey && (
        <>
          <div className="my-3 h-px bg-border" />
          <div className="flex items-start gap-2.5 text-xs text-warning-fg">
            <Icon name="alert" className="mt-0.5" />
            <span className="text-muted">
              Esta parece una clave de administrador, no una tarjeta de servidor: te
              llevaría al asistente de instalación en vez de a iniciar sesión.
            </span>
          </div>
        </>
      )}

      {hello && perfil?.title && (
        <>
          <div className="my-3 h-px bg-border" />
          <ServerProfileCard perfil={perfil} />
          <div className="my-3 h-px bg-border" />
          <label className="mb-[7px] block text-[11px] tracking-[.02em] text-muted">Nombre (opcional)</label>
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="equipo León"
            className="w-full rounded-lg border border-border bg-[#0d0f12] px-3 py-2.5 text-[12.5px] text-fg outline-none focus:border-white/40" />
        </>
      )}
      {hello && !perfil?.title && (
        <>
          <div className="my-3 h-px bg-border" />
          <div className="flex items-center gap-2.5 text-xs text-muted">
            <Icon name="check" /> <span>Servidor verificado</span>
          </div>
          <div className="mt-2 flex items-center gap-2.5 text-xs text-muted">
            <Icon name="user" />
            <span>{hello.state === "unclaimed" ? "Todavía sin administrador" : "Ya tiene administrador"}</span>
          </div>
          <div className="my-3 h-px bg-border" />
          <label className="mb-[7px] block text-[11px] tracking-[.02em] text-muted">Nombre (opcional)</label>
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="equipo León"
            className="w-full rounded-lg border border-border bg-[#0d0f12] px-3 py-2.5 text-[12.5px] text-fg outline-none focus:border-white/40" />
        </>
      )}

      {error && (
        <>
          <div className="my-3 h-px bg-border" />
          <div className="flex items-start gap-2.5 text-xs text-danger-fg">
            <Icon name="alert" className="mt-0.5" />
            <span className="text-muted">{error}</span>
          </div>
        </>
      )}

      <div className="mt-4 flex items-center justify-between gap-3">
        {/* Sin servidores guardados, no hay login al que volver: "Atrás"
            dejaría un callejón sin salida. */}
        {onBack ? (
          <button onClick={onBack}
            className="rounded-lg border border-white/15 px-4 py-2 text-xs text-fg transition-transform duration-300 ease-expo active:translate-y-px">
            Atrás
          </button>
        ) : <span />}
        {ownerKey ? (
          <button onClick={() => onOwnerKey(ownerKey)}
            className="rounded-lg bg-accent px-5 py-2 text-xs font-medium text-black transition-transform duration-300 ease-expo active:translate-y-px">
            Continuar como administrador
          </button>
        ) : (
          <button onClick={save} disabled={!hello}
            className="rounded-lg bg-accent px-5 py-2 text-xs font-medium text-black transition-transform duration-300 ease-expo active:translate-y-px disabled:opacity-40">
            Guardar servidor
          </button>
        )}
      </div>
    </>
  );
}
