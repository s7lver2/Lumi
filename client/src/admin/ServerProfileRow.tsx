import { useEffect, useState } from "react";
import { api, type ServerProfileSettings } from "../lib/api";
import { lumiUrl, pickImagePath, uploadServerAvatar, uploadServerBanner } from "../lib/bridge";
import { AvisoEditor } from "./AvisoEditor";

/** Foto, banner, título y descripción del servidor — lo que se muestra en el
 *  popup de "Añadir servidor" (ver `AddServerForm.tsx`) antes de que quien
 *  mira tenga cuenta. Mismo patrón de borrador local + "Guardar cambios" que
 *  `PolicyRow`, más dos botones de imagen que suben al instante (no hay
 *  "borrador" posible para un archivo: o se sube, o no). */
export function ServerProfileRow({ token }: { token: string }) {
  const [cfg, setCfg] = useState<ServerProfileSettings | null>(null);
  const [titulo, setTitulo] = useState("");
  const [descripcion, setDescripcion] = useState<unknown>(null);
  const [busyImg, setBusyImg] = useState<"avatar" | "banner" | null>(null);
  const [tick, setTick] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function cargar() {
    return api.serverProfileGet(token)
      .then((c) => { setCfg(c); setTitulo(c.title); setDescripcion(c.description); })
      .catch((e) => setError(String(e)));
  }
  useEffect(() => { void cargar(); }, [token]);

  async function subirAvatar() {
    const path = await pickImagePath();
    if (!path) return;
    setBusyImg("avatar"); setError(null);
    try {
      await uploadServerAvatar(path);
      setTick((t) => t + 1);
      void cargar();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusyImg(null);
    }
  }

  async function subirBanner() {
    const path = await pickImagePath();
    if (!path) return;
    setBusyImg("banner"); setError(null);
    try {
      await uploadServerBanner(path);
      setTick((t) => t + 1);
      void cargar();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusyImg(null);
    }
  }

  async function guardar() {
    setBusy(true); setError(null);
    try {
      const c = await api.serverProfilePatch({ title: titulo, description: descripcion }, token);
      setCfg(c);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!cfg) return null;

  const cambiado = titulo !== cfg.title || JSON.stringify(descripcion) !== JSON.stringify(cfg.description);

  return (
    <div className="mt-4 rounded-card border border-border p-3.5">
      <p className="mb-3 text-[12.5px] text-fg">Perfil del servidor</p>

      <div className="mb-3.5 flex items-center gap-3.5">
        <button key={`banner-${tick}`} onClick={() => void subirBanner()} disabled={busyImg !== null}
          className="jg-press relative h-[70px] w-[130px] shrink-0 overflow-hidden rounded-lg border border-border bg-elevated text-[9.5px] text-subtle disabled:opacity-40">
          {cfg.has_banner ? (
            <img src={lumiUrl(`/v1/server-profile/banner?v=${tick}`)} alt="" className="h-full w-full object-cover" />
          ) : (busyImg === "banner" ? "Subiendo…" : "Banner · subir")}
        </button>
        <button key={`avatar-${tick}`} onClick={() => void subirAvatar()} disabled={busyImg !== null}
          className="jg-press relative h-14 w-14 shrink-0 overflow-hidden rounded-[12px] border border-border bg-elevated text-[9px] text-subtle disabled:opacity-40">
          {cfg.has_avatar ? (
            <img src={lumiUrl(`/v1/server-profile/avatar?v=${tick}`)} alt="" className="h-full w-full object-cover" />
          ) : (busyImg === "avatar" ? "…" : "Foto")}
        </button>
      </div>

      <label className="mb-1.5 block text-[9.5px] uppercase tracking-[.06em] text-muted">Título</label>
      <input value={titulo} onChange={(e) => setTitulo(e.target.value)}
        placeholder="Laboratorio Forense León"
        className="mb-3 w-full rounded-lg border border-border bg-elevated px-2.5 py-2 text-[11.5px] text-fg outline-none focus:border-white/40" />
      <label className="mb-1.5 block text-[9.5px] uppercase tracking-[.06em] text-muted">Descripción</label>
      <AvisoEditor contenido={descripcion} onChange={setDescripcion} />

      <div className="mt-3 flex items-center gap-2">
        <button onClick={guardar} disabled={busy || !cambiado}
          className="jg-press rounded-lg bg-accent px-3.5 py-1.5 text-[11px] font-medium text-black disabled:opacity-40">
          Guardar cambios
        </button>
        <span className="text-[10px] text-subtle">{cfg.member_count} miembros</span>
      </div>
      {error && <p className="mt-2.5 text-[11px] text-danger-fg">{error}</p>}
    </div>
  );
}
