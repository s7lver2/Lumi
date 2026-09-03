"use client";

import { useState } from "react";
import { HeroOrbita } from "../components/HeroOrbita";

const COMANDO = "curl -fsSL lumi.s7lver.xyz/install | sh";

export default function Home() {
  const [copiado, setCopiado] = useState(false);

  async function copiar() {
    try {
      await navigator.clipboard.writeText(COMANDO);
    } catch {
      // clipboard no disponible (contexto no seguro, permisos…): sin fallback,
      // el usuario puede seleccionar el comando a mano.
    }
    setCopiado(true);
    setTimeout(() => setCopiado(false), 1800);
  }

  return (
    <main>
      <section className="relative flex min-h-[92vh] items-center overflow-hidden">
        <div className="absolute inset-0">
          <HeroOrbita />
        </div>
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-bg to-transparent" />

        <div className="relative z-10 mx-auto max-w-[640px] px-7">
          <h1 className="jg-fade-rise text-[clamp(34px,5.6vw,58px)] font-semibold leading-[1.05] tracking-tight">
            La foto dice dónde. <em className="italic text-muted">Nosotros la escuchamos.</em>
          </h1>
          <p className="jg-fade-rise mt-5 max-w-[52ch] leading-relaxed text-muted" style={{ animationDelay: ".1s" }}>
            Lumi encadena varios verificadores geométricos que compiten por acercarse
            más al punto real — no es un modelo mejor, es la competencia entre varios.
            Autoalojado: tus imágenes y tus GPUs no salen de tu servidor.
          </p>

          <div className="jg-fade-rise mt-7 flex flex-wrap gap-3" style={{ animationDelay: ".16s" }}>
            <a className="rounded-card bg-accent px-4 py-2 text-[13px] font-medium text-bg" href="#cobertura">
              Ver el mapa de cobertura
            </a>
            <a className="rounded-card border border-border px-4 py-2 text-[13px] font-medium text-fg hover:bg-elevated" href="#modelos">
              Conocer los modelos
            </a>
          </div>

          <div className="jg-fade-rise mt-8 max-w-[440px] rounded-card border border-border bg-panel/80 backdrop-blur" style={{ animationDelay: ".22s" }}>
            <div className="flex items-center gap-2 border-b border-border px-3.5 py-2 font-mono text-[10.5px] text-subtle">
              <span className="h-1.5 w-1.5 rounded-full bg-draw" />
              instalación · un solo comando
            </div>
            <div className="flex items-center gap-2 px-3.5 py-3">
              <span className="font-mono text-[13px] text-subtle">$</span>
              <code className="flex-1 truncate font-mono text-[13px]">
                curl -fsSL lumi.s7lver.xyz/install<span className="text-subtle"> | sh</span>
              </code>
              <button
                type="button"
                onClick={copiar}
                className="rounded-[6px] border border-border px-2 py-1 font-mono text-[11px] text-muted hover:text-fg"
              >
                {copiado ? "copiado" : "copiar"}
              </button>
            </div>
          </div>
          <p className="mt-3 font-mono text-[11px] text-subtle">
            se autoaloja en tu propio servidor — sin cuentas, sin nube de terceros
          </p>
        </div>
      </section>
    </main>
  );
}
