import { useEffect, useRef, useState } from "react";
import { api, type Resumen } from "../lib/api";
import type { Seccion } from "./Sidebar";

const KB = 1024;
function tamano(bytes: number): string {
  if (bytes < KB * KB * KB) return `${(bytes / KB / KB).toFixed(0)} MiB`;
  return `${(bytes / KB / KB / KB).toFixed(1)} GiB`;
}

function desdeHace(epoch: number): string {
  const s = Math.max(0, Math.floor(Date.now() / 1000) - epoch);
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600);
  if (d > 0) return `${d} d ${String(h).padStart(2, "0")} h`;
  return `${h} h ${String(Math.floor((s % 3600) / 60)).padStart(2, "0")} min`;
}

/** Cuenta hasta el valor en vez de saltar: un número que salta se lee como un
 *  fallo de render, uno que sube se lee como un dato que cambió. */
function Cifra({ n }: { n: number }) {
  const [v, setV] = useState(0);
  const desde = useRef(0);
  useEffect(() => {
    const d0 = desde.current, t0 = performance.now(), dur = 620;
    let vivo = true;
    const paso = (t: number) => {
      if (!vivo) return;
      const p = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - p, 3);
      setV(Math.round(d0 + (n - d0) * e));
      if (p < 1) requestAnimationFrame(paso);
      else desde.current = n;
    };
    requestAnimationFrame(paso);
    return () => { vivo = false; };
  }, [n]);
  return <>{v}</>;
}

function Chispa({ serie }: { serie: number[] }) {
  const max = Math.max(...serie, 1);
  return (
    <div className="mt-[11px] flex h-[15px] items-end gap-[3px]">
      {serie.map((v, i) => (
        <i key={i} className={`min-h-0.5 max-w-[9px] flex-1 rounded-[1px] transition-[height]
          duration-700 ease-expo ${i === serie.length - 1 ? "bg-subtle" : "bg-border"}`}
          style={{ height: `${Math.max(8, (v / max) * 100)}%` }} />
      ))}
    </div>
  );
}

function Ficha({ k, valor, unidad, sub, serie, i, onClick }: {
  k: string; valor: React.ReactNode; unidad?: string; sub: string;
  serie?: number[]; i: number; onClick?: () => void;
}) {
  return (
    <button onClick={onClick} disabled={!onClick}
      style={{ animation: `jg-fade-rise .58s ${Math.min(i, 8) * 45}ms cubic-bezier(.16,1,.3,1) both` }}
      className="rounded-[11px] border border-border bg-panel p-[13px_14px] text-left
        shadow-[inset_0_1px_0_rgba(255,255,255,.045)] transition-[border-color,transform]
        duration-[450ms] ease-expo enabled:hover:-translate-y-0.5 enabled:hover:border-white/20">
      <span className="block text-[8.5px] uppercase tracking-[.13em] text-subtle">{k}</span>
      <div className="mt-2 text-[25px] font-medium leading-none tracking-[-.035em] tabular-nums">
        {valor}
        {unidad && <small className="ml-[5px] text-[10.5px] font-normal tracking-normal text-subtle">{unidad}</small>}
      </div>
      <div className="mt-1.5 text-[9.5px] text-subtle">{sub}</div>
      {serie && <Chispa serie={serie} />}
    </button>
  );
}

/** Solo al entrar. Cambiar de sección no vuelve a pedir, así que el esqueleto
 *  no reaparece cada vez que miras. */
function Esqueleto() {
  return (
    <div className="px-6 pt-5">
      <div className="h-[21px] w-[186px] animate-pulse rounded-[7px] bg-elevated" />
      <div className="mt-[19px] grid grid-cols-4 gap-3">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-[104px] animate-pulse rounded-[11px] bg-elevated" />
        ))}
      </div>
      <p className="mt-4 font-mono text-[10.5px] text-subtle">pidiendo /v1/admin/resumen</p>
    </div>
  );
}

export function ResumenView({ token, onIr }: { token: string; onIr: (s: Seccion) => void }) {
  const [r, setR] = useState<Resumen | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<Resumen>("/v1/admin/resumen", token).then(setR).catch((e) => setError(String(e)));
  }, [token]);

  if (error) return <p className="px-6 pt-5 text-[11px] text-danger-fg">{error}</p>;
  if (!r) return <Esqueleto />;

  return (
    <div className="px-6 pb-8 pt-5">
      <span className="mb-1.5 block text-[8.5px] uppercase tracking-[.15em] text-subtle">Servidor</span>
      <div className="flex items-end gap-3 border-b border-border pb-[11px]">
        <h2 className="text-[21px] font-medium leading-none tracking-[-.025em]">Resumen</h2>
        <span className="ml-auto pb-0.5 font-mono text-[10.5px] text-subtle">
          en marcha desde hace {desdeHace(r.arrancado_en)}
        </span>
      </div>

      <div className="mt-[19px] grid grid-cols-4 gap-3">
        <Ficha i={0} k="Pendiente de ti" valor={<Cifra n={r.solicitudes_pendientes} />}
          unidad="solicitudes" onClick={() => onIr("solicitudes")}
          sub={r.solicitud_mas_antigua
            ? `la más antigua, hace ${desdeHace(r.solicitud_mas_antigua)}`
            : "nada esperando"} />
        <Ficha i={1} k="Usuarios" valor={<Cifra n={r.usuarios} />}
          sub={`${r.usuarios_conectados} conectados ahora`} onClick={() => onIr("usuarios")} />
        <Ficha i={2} k="Análisis hoy" valor={<Cifra n={r.analisis_hoy} />}
          sub={`${r.analisis_en_cola} en cola`} serie={r.analisis_serie}
          onClick={() => onIr("cola")} />
        <Ficha i={3} k="Índices instalados" valor={<Cifra n={r.indices} />}
          unidad={`· ${tamano(r.indices_bytes)}`} sub={`${r.teselas} teselas cubiertas`}
          onClick={() => onIr("indices")} />
      </div>

      {/* Dependen del gestor de modelos y no se pueden construir todavía. Se
          declaran en punteado, igual que las entradas atenuadas de la barra. */}
      <div className="mt-3 grid max-w-[596px] grid-cols-2 gap-3">
        {[["Niveles listos"], ["Pesos en disco"]].map(([k], i) => (
          <div key={k} className="rounded-[11px] border border-dashed border-border p-[13px_14px] opacity-[.48]"
            style={{ animation: `jg-fade-rise .58s ${(4 + i) * 45}ms cubic-bezier(.16,1,.3,1) both` }}>
            <span className="block text-[8.5px] uppercase tracking-[.13em] text-subtle">{k}</span>
            <div className="mt-2 text-[25px] font-medium leading-none text-muted">—</div>
            <div className="mt-1.5 text-[9.5px] text-subtle">llega con la gestión de modelos</div>
          </div>
        ))}
      </div>
    </div>
  );
}