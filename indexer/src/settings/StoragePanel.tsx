import { open } from "@tauri-apps/plugin-dialog";
import { useEffect, useState } from "react";

import { api, type ProgresoMigracion } from "../lib/api";

function formatoBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const unidades = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < unidades.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v >= 10 ? 0 : 1)} ${unidades[i]}`;
}

/** Elegir dónde vive todo — imágenes, índice, paquetes, pesos de modelo —
 *  y mudarlo si ya había algo en el sitio de antes. Qdrant y Redis quedan
 *  fuera: en Windows viven dentro de WSL, en un disco aparte que un
 *  selector de carpeta de Windows no puede alcanzar. */
export function StoragePanel() {
  const [actual, setActual] = useState<string | null>(null);
  const [porDefecto, setPorDefecto] = useState<string | null>(null);
  const [elegida, setElegida] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progreso, setProgreso] = useState<ProgresoMigracion | null>(null);

  function cargarActual() {
    void api.ubicacionLeer().then(setActual);
  }
  useEffect(() => {
    cargarActual();
    void api.ubicacionPorDefecto().then(setPorDefecto);
    void api.ubicacionMigracionProgreso().then(setProgreso);
  }, []);

  // Mientras haya una migración trabajando, se sondea — incluida una que ya
  // estuviera en marcha antes de entrar a esta pantalla (el hilo sigue vivo
  // en el proceso aunque se haya salido y vuelto a Ajustes).
  useEffect(() => {
    if (!progreso?.trabajando) return;
    const t = setInterval(() => {
      void api.ubicacionMigracionProgreso().then((p) => {
        setProgreso(p);
        if (p && !p.trabajando) cargarActual();
      });
    }, 500);
    return () => clearInterval(t);
  }, [progreso?.trabajando]);

  async function elegir() {
    const r = await open({ directory: true, multiple: false });
    if (typeof r !== "string") return;
    setError(null);
    setElegida(r);
  }

  async function migrar() {
    if (!elegida) return;
    setError(null);
    try {
      await api.ubicacionMigrar(elegida);
      setElegida(null);
      setProgreso(await api.ubicacionMigracionProgreso());
    } catch (e) {
      setError(String(e));
    }
  }

  const enCurso = progreso?.trabajando ?? false;
  const pct = progreso && progreso.bytes_total > 0
    ? Math.min(100, Math.round((progreso.bytes_copiados / progreso.bytes_total) * 100))
    : 0;

  return (
    <div className="mx-auto max-w-2xl p-8">
      <p className="text-sm text-fg">Almacenamiento</p>
      <p className="mt-[5px] text-[11px] leading-relaxed text-muted">
        Dónde viven las imágenes, el índice, los paquetes instalados y los pesos de modelo — lo que
        de verdad ocupa espacio. Qdrant y Redis no están aquí: en Windows corren dentro de WSL, en un
        disco aparte que esta carpeta no alcanza.
      </p>

      <div className="mt-5 rounded-lg border border-border px-3.5 py-3">
        <p className="text-[9px] uppercase tracking-[.11em] text-subtle">Carpeta actual</p>
        <p className="mt-1.5 break-all font-mono text-[11px] text-fg">{actual ?? "cargando…"}</p>
        {actual && porDefecto && actual !== porDefecto && (
          <p className="mt-1 text-[10px] text-subtle">por defecto sería: {porDefecto}</p>
        )}
      </div>

      {!enCurso && (
        <button onClick={() => void elegir()}
          className="jg-press mt-3 rounded-lg border border-border px-3.5 py-2 text-[11.5px] text-fg">
          Elegir otra carpeta…
        </button>
      )}

      {!enCurso && elegida && elegida !== actual && (
        <div className="mt-3 rounded-lg border border-warning/40 bg-warning/[.06] px-3.5 py-3">
          <p className="text-[11.5px] text-fg">Mudar todo a:</p>
          <p className="mt-1 break-all font-mono text-[11px] text-fg">{elegida}</p>
          <p className="mt-2 text-[10.5px] leading-relaxed text-muted">
            Se copia todo primero; el origen no se toca hasta que la copia entera esté verificada.
            No cierres la aplicación mientras dure. Hace falta que no haya ninguna descarga,
            sellado o embebido en curso.
          </p>
          <div className="mt-3 flex justify-end gap-2">
            <button onClick={() => setElegida(null)} className="jg-press rounded-lg px-3 py-1.5 text-[10.5px] text-subtle">
              Cancelar
            </button>
            <button onClick={() => void migrar()}
              className="jg-press rounded-lg bg-accent px-3.5 py-1.5 text-[11px] font-medium text-black">
              Empezar a mudar
            </button>
          </div>
        </div>
      )}

      {enCurso && progreso && (
        <div className="mt-3 rounded-lg border border-border px-3.5 py-3">
          <div className="flex items-center justify-between">
            <p className="text-[11.5px] text-fg">Migrando…</p>
            <p className="font-mono text-[10.5px] text-muted">
              {formatoBytes(progreso.bytes_copiados)} / {formatoBytes(progreso.bytes_total)}
            </p>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[.08]">
            <div className="h-full rounded-full bg-accent transition-[width] duration-300" style={{ width: `${pct}%` }} />
          </div>
          <p className="mt-2 truncate font-mono text-[10px] text-subtle">{progreso.archivo_actual}</p>
        </div>
      )}

      {progreso?.terminado && (
        <p className="mt-3 rounded-lg border border-border bg-white/[.03] px-3.5 py-3 text-[11.5px] text-fg">
          Migración completa — "Carpeta actual" ya refleja la nueva ubicación. Cierra y vuelve a
          abrir la aplicación para que el resto (imágenes, paquetes, pesos de modelo) también lea
          desde ahí.
        </p>
      )}

      {(error || progreso?.error) && (
        <p className="mt-3 text-[11px] leading-relaxed text-danger-fg">{error ?? progreso?.error}</p>
      )}
    </div>
  );
}
