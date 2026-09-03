"use client";

import { useEffect, useRef, useState } from "react";
import { ultimaVersion } from "../lib/version";

/** Nav superior: marca, desplegable de Modelos con los tres anillos que
 *  identifican a cada nivel, indicador de la versión publicada (nunca una
 *  flota inventada) y barra de progreso de scroll. Porta el nav del
 *  concepto (líneas 612-646 de `2026-09-02-concepto-landing-v6.html`). */
export function Nav() {
  const [scrolled, setScrolled] = useState(false);
  const [progreso, setProgreso] = useState(0);
  const [abierto, setAbierto] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const version = ultimaVersion();

  useEffect(() => {
    function onScroll() {
      setScrolled(window.scrollY > 8);
      const total = document.documentElement.scrollHeight - window.innerHeight;
      setProgreso(total > 0 ? Math.min(100, (window.scrollY / total) * 100) : 0);
    }
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    function fuera(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setAbierto(false);
    }
    document.addEventListener("click", fuera);
    return () => document.removeEventListener("click", fuera);
  }, []);

  return (
    <nav
      className={`fixed inset-x-0 top-0 z-50 flex h-14 items-center gap-5 border-b px-6 backdrop-blur transition-colors duration-300 ${
        scrolled ? "border-border bg-bg/85 shadow-[0_1px_24px_rgba(0,0,0,.35)]" : "border-border/35 bg-bg/30"
      }`}
    >
      <div className="absolute inset-x-0 top-0 h-px bg-fg" style={{ width: `${progreso}%`, transition: "width .1s linear" }} />

      <a href="/" className="flex items-center gap-2 text-[13px] font-medium tracking-tight">
        <span className="text-accent">✦</span> Lumi Station
      </a>
      <div className="h-4 w-px bg-border" />

      <div className="flex items-center gap-5 text-[13px] text-muted">
        <div ref={wrapRef} className="relative">
          <button
            type="button"
            className="jg-micro flex items-center gap-1 hover:text-fg"
            aria-expanded={abierto}
            onClick={(e) => {
              e.stopPropagation();
              setAbierto((v) => !v);
            }}
          >
            Modelos
            <svg className={`h-2 w-2 transition-transform duration-200 ${abierto ? "rotate-180" : ""}`} viewBox="0 0 8 8" fill="none">
              <path d="M1.5 2.5L4 5.5L6.5 2.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          {abierto && (
            <div className="absolute left-0 top-full mt-3 w-[280px] rounded-card border border-border bg-panel p-1.5 shadow-xl">
              <a className="jg-micro flex items-center gap-3 rounded-[8px] px-3 py-2.5 hover:bg-elevated" href="/meetmini">
                <svg className="h-[26px] w-[26px] shrink-0" viewBox="0 0 26 26">
                  <circle cx="13" cy="13" r="10.5" fill="none" stroke="rgb(55,138,221)" strokeWidth="1.6" />
                </svg>
                <div className="flex-1">
                  <div className="text-[13px] text-fg">Lumi Mini</div>
                  <div className="text-[11px] text-subtle">un verificador · coste bajo</div>
                </div>
              </a>
              <a className="jg-micro flex items-center gap-3 rounded-[8px] px-3 py-2.5 hover:bg-elevated" href="/meetpro">
                <svg className="h-[26px] w-[26px] shrink-0" viewBox="0 0 26 26">
                  <circle cx="13" cy="13" r="10.5" fill="none" stroke="rgb(239,185,104)" strokeWidth="1.6" />
                  <circle cx="13" cy="13" r="7" fill="none" stroke="rgb(239,185,104)" strokeWidth="1.2" opacity=".55" />
                </svg>
                <div className="flex-1">
                  <div className="text-[13px] text-fg">Lumi Pro</div>
                  <div className="text-[11px] text-subtle">varios en cadena · coste medio</div>
                </div>
              </a>
              <a className="jg-micro flex items-center gap-3 rounded-[8px] px-3 py-2.5 hover:bg-elevated" href="/meetvision">
                <svg className="h-[26px] w-[26px] shrink-0" viewBox="0 0 26 26">
                  <circle cx="13" cy="13" r="10.5" fill="none" stroke="rgb(242,243,245)" strokeWidth="1.6" />
                  <circle cx="13" cy="13" r="7" fill="none" stroke="rgb(242,243,245)" strokeWidth="1.2" opacity=".55" />
                  <circle cx="13" cy="13" r="3.5" fill="none" stroke="rgb(242,243,245)" strokeWidth="1" opacity=".4" />
                </svg>
                <div className="flex-1">
                  <div className="text-[13px] text-fg">Lumi Vision</div>
                  <div className="text-[11px] text-subtle">competencia entre varios · coste alto</div>
                </div>
              </a>
            </div>
          )}
        </div>
        <a className="jg-micro hover:text-fg" href="/index">Indexado</a>
        <a className="jg-micro hover:text-fg" href="/aboutme">Sobre mí</a>
      </div>

      <div className="flex-1" />

      {version && (
        <span className="font-mono text-[11px] text-subtle">
          v{version.version} · publicada
        </span>
      )}
      <a
        className="jg-micro rounded-card bg-accent px-3.5 py-1.5 text-[13px] font-medium text-bg hover:scale-[1.03] hover:opacity-90"
        href="https://github.com/s7lver2/Lumi/releases/latest"
      >
        Descargar cliente
      </a>
    </nav>
  );
}
