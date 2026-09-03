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

// Cliente e Indexer se instalan mediante el Instalador — el archivo que se
// ofrece al final para estos dos productos es el suyo, no un build suelto.
const PRODUCTOS_VIA_INSTALADOR = new Set(["cliente", "indexer"]);

const ICONOS_PLATAFORMA: Record<string, React.ReactNode> = {
  "windows-x86_64": (
    <svg width="30" height="30" viewBox="0 0 24 24" fill="none">
      <path d="M4 5h7v7H4zM13 5h7v7h-7zM4 13h7v6H4zM13 13h7v6h-7z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
    </svg>
  ),
  "linux-x86_64": (
    <svg width="30" height="30" viewBox="0 0 24 24" fill="none">
      <rect x="3.5" y="4.5" width="17" height="15" rx="1.5" stroke="currentColor" strokeWidth="1.7" />
      <path d="M7 9l3 3-3 3M13 15h4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
};

// Logotipos oficiales de cada app — la MISMA estrella de cuatro puntas de
// client/src-tauri/icons/app-icon.svg (y sus variantes de
// indexer/instalador), no un pictograma inventado para este selector: es
// la marca real de cada producto, recortada tal cual del icon.svg fuente.
// lumid no tiene app-icon propio (corre sin ventana ni instalador Tauri),
// así que sigue la misma técnica de recorte en negativo sobre la estrella
// en vez de inventar una marca sin fuente que la respalde.
const ICONOS_PRODUCTO: Record<string, React.ReactNode> = {
  cliente: (
    <svg width="34" height="34" viewBox="0 0 1024 1024">
      <rect width="1024" height="1024" rx="224" fill="#0e0f11" />
      <path
        d="M512 176c30 188 116 274 300 300-184 26-270 112-300 300-30-188-116-274-300-300 184-26 270-112 300-300z"
        fill="#e8e8e6"
      />
    </svg>
  ),
  indexer: (
    <svg width="34" height="34" viewBox="0 0 1024 1024">
      <rect width="1024" height="1024" rx="224" fill="#0e0f11" />
      <path
        d="M512 176c30 188 116 274 300 300-184 26-270 112-300 300-30-188-116-274-300-300 184-26 270-112 300-300z"
        fill="#e8e8e6"
      />
      <g fill="#0e0f11">
        <circle cx="382" cy="486" r="86" />
        <circle cx="642" cy="486" r="86" />
        <rect x="466" y="462" width="92" height="48" rx="24" />
      </g>
    </svg>
  ),
  lumid: (
    <svg width="34" height="34" viewBox="0 0 1024 1024">
      <rect width="1024" height="1024" rx="224" fill="#0e0f11" />
      <path
        d="M512 176c30 188 116 274 300 300-184 26-270 112-300 300-30-188-116-274-300-300 184-26 270-112 300-300z"
        fill="#e8e8e6"
      />
      <circle cx="512" cy="486" r="46" fill="#0e0f11" />
    </svg>
  ),
  instalador: (
    <svg width="34" height="34" viewBox="0 0 1024 1024">
      <rect width="1024" height="1024" rx="224" fill="#0e0f11" />
      <path
        d="M512 176c30 188 116 274 300 300-184 26-270 112-300 300-30-188-116-274-300-300 184-26 270-112 300-300z"
        fill="#e8e8e6"
      />
      <g fill="#0e0f11">
        <rect x="472" y="322" width="80" height="230" rx="18" />
        <path d="M400 486 L624 486 L512 648 Z" />
        <rect x="382" y="676" width="260" height="56" rx="28" />
      </g>
    </svg>
  ),
};

/** Una opción del cuestionario: solo el icono, sin caja ni borde ni
 *  etiqueta visible en reposo. El icono vive en `subtle` y pasa a `fg`
 *  (blanco) al pasar el ratón para los iconos de trazo (plataforma);
 *  los logotipos de producto ya llevan su propio color fijo. El nombre
 *  aparece al pasar el ratón — la selección es el propio gesto de click,
 *  no un estado "elegido" que haya que confirmar aparte. */
function IconoOpcion({ icono, etiqueta, onClick }: { icono: React.ReactNode; etiqueta: string; onClick: () => void }) {
  return (
    <button
      type="button"
      className="group flex flex-col items-center gap-1.5 rounded-card py-2.5 text-subtle transition-all duration-200 hover:-translate-y-0.5 hover:text-fg"
      style={{ transitionTimingFunction: "cubic-bezier(.22,1,.36,1)" }}
      onClick={onClick}
    >
      {icono}
      <span className="text-[12.5px] opacity-0 transition-opacity duration-200 group-hover:opacity-100">{etiqueta}</span>
    </button>
  );
}

/** Botón "Descargar" que abre un cuestionario de dos preguntas —
 *  producto, luego plataforma, ambas solo con iconos — y al final enseña
 *  la descarga real correspondiente. Nunca ofrece un producto o una
 *  plataforma que no se haya publicado de verdad (`productosDescargables()`,
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

  // Cliente e Indexer no se descargan sueltos: se instalan a través del
  // Instalador, así que no aparece como una quinta opción en el
  // cuestionario — es el propio archivo que se ofrece para esos dos.
  const productosSeleccionables = productos.filter((p) => p.producto !== "instalador");
  const instaladorEntry = productos.find((p) => p.producto === "instalador") ?? null;

  const productoElegido = producto ? productos.find((p) => p.producto === producto) ?? null : null;
  const viaInstalador = productoElegido != null && PRODUCTOS_VIA_INSTALADOR.has(productoElegido.producto) && instaladorEntry != null;
  const fuenteDescarga = viaInstalador ? instaladorEntry : productoElegido;
  const plataformasDelProducto = fuenteDescarga
    ? Array.from(new Set(fuenteDescarga.artefactos.map((a) => a.plataforma)))
    : [];
  const artefactoFinal = fuenteDescarga?.artefactos.find((a) => a.plataforma === plataforma) ?? null;

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
            className="fixed inset-0 z-[60] flex items-center justify-center bg-[rgba(5,7,10,.72)] px-5 backdrop-blur-md"
            onClick={cerrar}
          >
            <div
              className="jg-reveal-up w-full max-w-[480px] rounded-card border border-border bg-panel text-left shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
                <span className="text-[14px] font-medium">
                  {!producto ? "¿Qué quieres descargar?" : !plataforma ? "¿Qué sistema usas?" : "Listo"}
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

              <div className="p-6">
                {!producto && (
                  <div className="grid grid-cols-4 gap-1">
                    {productosSeleccionables.map((p) => (
                      <IconoOpcion
                        key={p.producto}
                        icono={ICONOS_PRODUCTO[p.producto]}
                        etiqueta={NOMBRES[p.producto] ?? p.producto}
                        onClick={() => setProducto(p.producto)}
                      />
                    ))}
                  </div>
                )}

                {producto && !plataforma && (
                  <div className="flex justify-center gap-1">
                    {plataformasDelProducto.map((plat) => (
                      <IconoOpcion
                        key={plat}
                        icono={ICONOS_PLATAFORMA[plat]}
                        etiqueta={ETIQUETAS_PLATAFORMA[plat] ?? plat}
                        onClick={() => setPlataforma(plat)}
                      />
                    ))}
                  </div>
                )}

                {producto && productoElegido && plataforma && fuenteDescarga && artefactoFinal && (
                  <div className="flex flex-col items-center gap-4 py-4 text-center">
                    {ICONOS_PRODUCTO[productoElegido.producto]}
                    <div>
                      <div className="text-[14px] font-medium">
                        {NOMBRES[productoElegido.producto] ?? productoElegido.producto} · {ETIQUETAS_PLATAFORMA[plataforma] ?? plataforma}
                      </div>
                      <div className="mt-1 font-mono text-[11px] text-subtle">
                        v{fuenteDescarga.version} · {formatoMB(artefactoFinal.bytes)}
                      </div>
                      {viaInstalador && (
                        <div className="mt-1 text-[11px] text-subtle">se instala con el instalador de Lumi</div>
                      )}
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
