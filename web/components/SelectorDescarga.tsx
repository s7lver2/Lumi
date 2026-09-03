"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { ProductoDescargable } from "../lib/version";

const NOMBRES: Record<string, string> = {
  cliente: "Cliente",
  indexer: "Indexer",
  lumid: "lumid",
  instalador: "Instalador",
};

const ETIQUETAS_PLATAFORMA: Record<string, string> = {
  "windows-x86_64": "Windows",
  "macos-aarch64": "macOS",
  "macos-x86_64": "macOS",
  "linux-x86_64": "Linux",
};

function formatoMB(bytes: number) {
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

const ICONOS_PLATAFORMA: Record<string, React.ReactNode> = {
  "windows-x86_64": (
    <path d="M4 5h7v7H4zM13 5h7v7h-7zM4 13h7v6H4zM13 13h7v6h-7z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
  ),
  "linux-x86_64": (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="1.5" stroke="currentColor" strokeWidth="1.7" />
      <path d="M7 9l3 3-3 3M13 15h4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
};

const ICONOS_PRODUCTO: Record<string, React.ReactNode> = {
  cliente: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="1.5" stroke="currentColor" strokeWidth="1.7" />
      <path d="M3.5 8.5h17" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="6.3" cy="6.5" r=".5" fill="currentColor" stroke="none" />
      <circle cx="8.3" cy="6.5" r=".5" fill="currentColor" stroke="none" />
    </>
  ),
  indexer: (
    <path
      d="M12 3l8 4-8 4-8-4 8-4zM4 11l8 4 8-4M4 15l8 4 8-4"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  lumid: (
    <>
      <rect x="6" y="6" width="12" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.7" />
      <path
        d="M9 6V3M15 6V3M9 21v-3M15 21v-3M6 9H3M6 15H3M21 9h-3M21 15h-3"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </>
  ),
  instalador: (
    <path
      d="M12 3v12M8 11l4 4 4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
};

/** Una opción del cuestionario: solo el icono, sin caja ni borde ni
 *  etiqueta visible en reposo. El icono vive en `subtle` y pasa a `fg`
 *  (blanco) al pasar el ratón, momento en el que también aparece su
 *  nombre — la selección es el propio gesto de click, no un estado
 *  "elegido" que haya que confirmar aparte. */
function IconoOpcion({ icono, etiqueta, onClick }: { icono: React.ReactNode; etiqueta: string; onClick: () => void }) {
  return (
    <button
      type="button"
      className="group flex flex-col items-center gap-2.5 rounded-card py-5 text-subtle transition-all duration-200 hover:-translate-y-0.5 hover:text-fg"
      style={{ transitionTimingFunction: "cubic-bezier(.22,1,.36,1)" }}
      onClick={onClick}
    >
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
        {icono}
      </svg>
      <span className="text-[12.5px] opacity-0 transition-opacity duration-200 group-hover:opacity-100">{etiqueta}</span>
    </button>
  );
}

/** Botón "Descargar" que abre un cuestionario de dos preguntas —
 *  plataforma, luego producto, ambas solo con iconos — y al final enseña
 *  la descarga real correspondiente. Nunca ofrece una plataforma o un
 *  producto que no se haya publicado de verdad (`productosDescargables()`,
 *  leído de `releases/versiones.json`). */
export function SelectorDescarga({ productos }: { productos: ProductoDescargable[] }) {
  const [abierto, setAbierto] = useState(false);
  const [plataforma, setPlataforma] = useState<string | null>(null);
  const [producto, setProducto] = useState<string | null>(null);
  const [montado, setMontado] = useState(false);

  useEffect(() => {
    setMontado(true);
  }, []);

  useEffect(() => {
    if (!abierto) return;
    function tecla(e: KeyboardEvent) {
      if (e.key === "Escape") setAbierto(false);
    }
    document.addEventListener("keydown", tecla);
    return () => document.removeEventListener("keydown", tecla);
  }, [abierto]);

  function reiniciar() {
    setPlataforma(null);
    setProducto(null);
  }

  function cerrar() {
    setAbierto(false);
    reiniciar();
  }

  if (productos.length === 0) {
    return (
      <a
        className="jg-micro jg-micro-scale rounded-card border border-border px-4 py-2 text-[13px] font-medium text-fg hover:border-subtle hover:bg-elevated"
        href="https://github.com/s7lver2/Lumi/releases/latest"
      >
        Descargar cliente
      </a>
    );
  }

  const plataformas = Array.from(new Set(productos.flatMap((p) => p.artefactos.map((a) => a.plataforma))));
  const productosDeLaPlataforma = plataforma
    ? productos.filter((p) => p.artefactos.some((a) => a.plataforma === plataforma))
    : [];
  const productoElegido = producto ? productos.find((p) => p.producto === producto) ?? null : null;
  const artefactoFinal = productoElegido?.artefactos.find((a) => a.plataforma === plataforma) ?? null;

  return (
    <>
      <button
        type="button"
        className="jg-micro jg-micro-scale rounded-card bg-accent px-4 py-2 text-[13px] font-medium text-bg hover:opacity-90"
        onClick={() => setAbierto(true)}
      >
        Descargar Lumi
      </button>

      {abierto &&
        montado &&
        createPortal(
          <div
            className="fixed inset-0 z-[60] flex items-start justify-center bg-[rgba(5,7,10,.72)] px-5 pt-[14vh] backdrop-blur-md"
            onClick={cerrar}
          >
            <div
              className="jg-reveal-up w-full max-w-[480px] rounded-card border border-border bg-panel text-left shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
                <span className="text-[14px] font-medium">
                  {!plataforma ? "¿Qué sistema usas?" : !producto ? "¿Qué quieres descargar?" : "Listo"}
                </span>
                <button
                  type="button"
                  aria-label="Cerrar"
                  className="jg-micro flex h-6 w-6 items-center justify-center rounded-[6px] text-subtle hover:bg-elevated hover:text-fg"
                  onClick={cerrar}
                >
                  <svg className="h-3 w-3" viewBox="0 0 12 12" fill="none">
                    <path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                  </svg>
                </button>
              </div>

              <div className="p-8">
                {!plataforma && (
                  <div className="grid grid-cols-2 gap-2">
                    {plataformas.map((plat) => (
                      <IconoOpcion
                        key={plat}
                        icono={ICONOS_PLATAFORMA[plat]}
                        etiqueta={ETIQUETAS_PLATAFORMA[plat] ?? plat}
                        onClick={() => setPlataforma(plat)}
                      />
                    ))}
                  </div>
                )}

                {plataforma && !producto && (
                  <div className="grid grid-cols-2 gap-2">
                    {productosDeLaPlataforma.map((p) => (
                      <IconoOpcion
                        key={p.producto}
                        icono={ICONOS_PRODUCTO[p.producto]}
                        etiqueta={NOMBRES[p.producto] ?? p.producto}
                        onClick={() => setProducto(p.producto)}
                      />
                    ))}
                  </div>
                )}

                {plataforma && productoElegido && artefactoFinal && (
                  <div className="flex flex-col items-center gap-4 py-4 text-center">
                    <svg width="34" height="34" viewBox="0 0 24 24" fill="none" className="text-fg">
                      {ICONOS_PRODUCTO[productoElegido.producto]}
                    </svg>
                    <div>
                      <div className="text-[14px] font-medium">
                        {NOMBRES[productoElegido.producto] ?? productoElegido.producto} · {ETIQUETAS_PLATAFORMA[plataforma] ?? plataforma}
                      </div>
                      <div className="mt-1 font-mono text-[11px] text-subtle">
                        v{productoElegido.version} · {formatoMB(artefactoFinal.bytes)}
                      </div>
                    </div>
                    <a
                      href={artefactoFinal.url}
                      className="jg-micro jg-micro-scale w-full rounded-card bg-accent px-4 py-2.5 text-[13px] font-medium text-bg hover:opacity-90"
                    >
                      Descargar
                    </a>
                    <button type="button" className="jg-micro text-[12px] text-subtle hover:text-fg" onClick={reiniciar}>
                      elegir otra vez
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
