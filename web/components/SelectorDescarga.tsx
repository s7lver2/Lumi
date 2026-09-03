"use client";

import { useEffect, useState } from "react";

type Artefacto = { plataforma: string; url: string; bytes: number; sha256: string };

const ETIQUETAS: Record<string, string> = {
  "windows-x86_64": "Windows",
  "macos-aarch64": "macOS (Apple Silicon)",
  "macos-x86_64": "macOS (Intel)",
  "linux-x86_64": "Linux",
};

function detectarPlataforma(): string | null {
  if (typeof navigator === "undefined") return null;
  const ua = navigator.userAgent;
  if (/Windows/.test(ua)) return "windows-x86_64";
  if (/Mac/.test(ua)) return /Intel/.test(ua) ? "macos-x86_64" : "macos-aarch64";
  if (/Linux/.test(ua)) return "linux-x86_64";
  return null;
}

function formatoMB(bytes: number) {
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

/** Selector real de descarga del cliente: lee los artefactos que de verdad
 *  publicó `releases/versiones.json` — nunca ofrece una plataforma que no
 *  se haya publicado (hoy solo windows-x86_64). Preselecciona la
 *  plataforma del visitante cuando coincide con alguna publicada. */
export function SelectorDescarga({ artefactos }: { artefactos: Artefacto[] }) {
  const [elegido, setElegido] = useState(0);
  const [abierto, setAbierto] = useState(false);

  useEffect(() => {
    const detectada = detectarPlataforma();
    if (!detectada) return;
    const idx = artefactos.findIndex((a) => a.plataforma === detectada);
    if (idx >= 0) setElegido(idx);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (artefactos.length === 0) {
    return (
      <a
        className="jg-micro jg-micro-scale rounded-card border border-border px-4 py-2 text-[13px] font-medium text-fg hover:border-subtle hover:bg-elevated"
        href="https://github.com/s7lver2/Lumi/releases/latest"
      >
        Descargar cliente
      </a>
    );
  }

  const actual = artefactos[elegido];

  return (
    <div className="relative inline-flex">
      <a
        className="jg-micro flex items-center gap-2 rounded-l-card bg-accent px-4 py-2 text-[13px] font-medium text-bg hover:opacity-90"
        href={actual.url}
      >
        Descargar para {ETIQUETAS[actual.plataforma] ?? actual.plataforma}
        <span className="font-mono text-[11px] text-bg/60">{formatoMB(actual.bytes)}</span>
      </a>
      {artefactos.length > 1 && (
        <>
          <button
            type="button"
            className="jg-micro rounded-r-card border-l border-bg/20 bg-accent px-2.5 text-bg hover:opacity-90"
            aria-expanded={abierto}
            onClick={() => setAbierto((v) => !v)}
          >
            <svg className={`h-2.5 w-2.5 transition-transform duration-200 ${abierto ? "rotate-180" : ""}`} viewBox="0 0 8 8" fill="none">
              <path d="M1.5 2.5L4 5.5L6.5 2.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          {abierto && (
            <div className="absolute left-0 top-full z-20 mt-2 w-[240px] rounded-card border border-border bg-panel p-1.5 text-left shadow-xl">
              {artefactos.map((a, i) => (
                <button
                  key={a.plataforma}
                  type="button"
                  className="jg-micro flex w-full items-center justify-between rounded-[8px] px-3 py-2 text-[13px] hover:bg-elevated"
                  onClick={() => {
                    setElegido(i);
                    setAbierto(false);
                  }}
                >
                  <span className={i === elegido ? "text-fg" : "text-muted"}>{ETIQUETAS[a.plataforma] ?? a.plataforma}</span>
                  <span className="font-mono text-[10.5px] text-subtle">{formatoMB(a.bytes)}</span>
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
