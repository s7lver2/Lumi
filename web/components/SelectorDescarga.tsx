"use client";

import { useEffect, useState } from "react";
import type { ProductoDescargable } from "../lib/version";

const NOMBRES: Record<string, string> = {
  cliente: "Cliente Lumi",
  indexer: "Lumi Indexer",
  lumid: "lumid (servidor)",
  instalador: "Instalador guiado",
};

const DESCRIPCIONES: Record<string, string> = {
  cliente: "La app de escritorio para investigadores: proyectos, análisis y mapa.",
  indexer: "Herramienta aparte, de un solo operador, para construir el catálogo de imágenes georreferenciadas.",
  lumid: "El daemon que se instala en tu propio servidor con GPU — es el que hace la inferencia.",
  instalador: "Deja lumid preparado en un servidor Windows, paso a paso, sin usar la terminal.",
};

const ETIQUETAS_PLATAFORMA: Record<string, string> = {
  "windows-x86_64": "Windows",
  "macos-aarch64": "macOS (Apple Silicon)",
  "macos-x86_64": "macOS (Intel)",
  "linux-x86_64": "Linux",
};

function formatoMB(bytes: number) {
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

/** Botón "Descargar" que abre un selector real de productos — lee
 *  `productosDescargables()` (releases/versiones.json), así que nunca
 *  ofrece un producto o una plataforma que no se haya publicado de
 *  verdad. Sustituye a la caja de instalación como CTA principal. */
export function SelectorDescarga({ productos }: { productos: ProductoDescargable[] }) {
  const [abierto, setAbierto] = useState(false);

  useEffect(() => {
    if (!abierto) return;
    function tecla(e: KeyboardEvent) {
      if (e.key === "Escape") setAbierto(false);
    }
    document.addEventListener("keydown", tecla);
    return () => document.removeEventListener("keydown", tecla);
  }, [abierto]);

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

  return (
    <>
      <button
        type="button"
        className="jg-micro jg-micro-scale rounded-card bg-accent px-4 py-2 text-[13px] font-medium text-bg hover:opacity-90"
        onClick={() => setAbierto(true)}
      >
        Descargar Lumi
      </button>

      {abierto && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-[rgba(5,7,10,.6)] px-5 backdrop-blur-sm"
          onClick={() => setAbierto(false)}
        >
          <div
            className="jg-reveal-up w-full max-w-[560px] rounded-card border border-border bg-panel text-left shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
              <span className="text-[14px] font-medium">Descargar Lumi</span>
              <button
                type="button"
                aria-label="Cerrar"
                className="jg-micro flex h-6 w-6 items-center justify-center rounded-[6px] text-subtle hover:bg-elevated hover:text-fg"
                onClick={() => setAbierto(false)}
              >
                <svg className="h-3 w-3" viewBox="0 0 12 12" fill="none">
                  <path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                </svg>
              </button>
            </div>

            <div className="max-h-[70vh] overflow-y-auto p-2.5">
              {productos.map((p) => (
                <div key={p.producto} className="flex items-start justify-between gap-4 rounded-[8px] px-3 py-3 hover:bg-elevated">
                  <div className="min-w-0">
                    <div className="flex items-baseline gap-2">
                      <span className="text-[13.5px] font-medium text-fg">{NOMBRES[p.producto] ?? p.producto}</span>
                      <span className="font-mono text-[10.5px] text-subtle">v{p.version}</span>
                    </div>
                    <p className="mt-1 max-w-[340px] text-[12.5px] leading-relaxed text-muted">
                      {DESCRIPCIONES[p.producto] ?? ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1.5 pt-0.5">
                    {p.artefactos.map((a) => (
                      <a
                        key={a.plataforma}
                        href={a.url}
                        className="jg-micro flex items-center gap-2 whitespace-nowrap rounded-[7px] border border-border px-2.5 py-1.5 text-[12px] text-fg hover:border-subtle hover:bg-panel"
                      >
                        {ETIQUETAS_PLATAFORMA[a.plataforma] ?? a.plataforma}
                        <span className="font-mono text-[10.5px] text-subtle">{formatoMB(a.bytes)}</span>
                      </a>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <div className="border-t border-border px-5 py-3 font-mono text-[10.5px] text-subtle">
              cada binario se publica directamente desde el repositorio — sin cuentas, sin cliente de terceros
            </div>
          </div>
        </div>
      )}
    </>
  );
}
