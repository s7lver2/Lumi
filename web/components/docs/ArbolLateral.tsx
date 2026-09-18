"use client";

import Link from "next/link";
import { useState } from "react";
import { arbolDocs } from "../../lib/arbolDocs";
import { GlifoRama } from "./GlifoRama";

function IconoBuscar() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-4.2-4.2" />
    </svg>
  );
}

function IconoRuta() {
  return (
    <svg width="7" height="7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 5l8 7-8 7" />
    </svg>
  );
}

function Contenido({ rutaActual }: { rutaActual: string }) {
  return (
    <>
      <button
        type="button"
        onClick={() => window.dispatchEvent(new Event("docs:abrir-buscador"))}
        className="jg-micro mx-4 mb-[18px] flex items-center gap-2 rounded-[8px] border border-border bg-panel px-2.5 py-[7px] text-left text-subtle hover:border-[#33363b]"
      >
        <IconoBuscar />
        <span className="text-[11.5px]">Buscar</span>
        <span className="ml-auto rounded-[4px] border border-border px-[5px] text-[9.5px] font-mono">⌘K</span>
      </button>
      {arbolDocs.map((rama) => (
        <div key={rama.id} className="mb-5">
          <div className="mb-[7px] flex items-center gap-1.5 px-4 text-[9.5px] uppercase tracking-[.12em] text-subtle">
            <GlifoRama glifo={rama.glifo} className="h-[11px] w-[11px]" />
            {rama.titulo}
          </div>
          {rama.paginas.map((pagina) => {
            const href = `/docs/${rama.id}/${pagina.ruta}`;
            const activa = href === rutaActual;
            if (pagina.pendiente) {
              return (
                <span
                  key={pagina.ruta}
                  title="Pendiente de escribir"
                  className="flex items-baseline gap-[7px] px-4 py-[5px] text-[12.5px] leading-snug text-subtle opacity-60"
                >
                  <span className="h-[4px] w-[4px] shrink-0 translate-y-[-1px] rounded-full border border-subtle" aria-hidden />
                  {pagina.titulo}
                </span>
              );
            }
            return (
              <Link
                key={pagina.ruta}
                href={href}
                className={`jg-micro block border-l-2 px-4 py-[5px] text-[12.5px] leading-snug ${
                  activa ? "border-fg bg-white/[.035] text-fg" : "border-transparent text-muted hover:text-fg"
                }`}
              >
                {pagina.titulo}
              </Link>
            );
          })}
        </div>
      ))}
    </>
  );
}

/** Árbol de navegación de /docs. En escritorio (≥900px) es una columna fija
 *  de 250px; por debajo, una barra de ruta con desplegable (spec §1: "el
 *  árbol pasa a un desplegable bajo una barra de ruta"). */
export function ArbolLateral({ rutaActual, tituloActual }: { rutaActual: string; tituloActual: string }) {
  const [abierto, setAbierto] = useState(false);

  return (
    <>
      <aside className="hidden w-[250px] shrink-0 overflow-y-auto border-r border-border py-[22px] min-[900px]:block">
        <Contenido rutaActual={rutaActual} />
      </aside>

      <div className="border-b border-border min-[900px]:hidden">
        <button
          type="button"
          onClick={() => setAbierto((v) => !v)}
          className="jg-micro flex w-full items-center gap-2 bg-panel px-4 py-[11px] text-left"
        >
          <IconoRuta />
          <span className="text-[11.5px] text-muted">{tituloActual}</span>
        </button>
        {abierto && (
          <div className="max-h-[70vh] overflow-y-auto border-t border-border bg-bg py-[18px]">
            <Contenido rutaActual={rutaActual} />
          </div>
        )}
      </div>
    </>
  );
}
