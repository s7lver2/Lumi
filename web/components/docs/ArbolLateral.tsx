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

function IconoDespliega({ abierta }: { abierta: boolean }) {
  return (
    <svg
      width="7"
      height="7"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`ml-auto shrink-0 transition-transform duration-150 ${abierta ? "rotate-90" : ""}`}
    >
      <path d="M9 5l8 7-8 7" />
    </svg>
  );
}

/** El árbol completo, plano, es 44 filas del mismo peso — imposible ver de
 *  un vistazo en qué rama estás. Por eso es un acordeón: solo la rama que
 *  contiene la página actual empieza abierta, y su título lleva el acento
 *  (`text-fg` en vez de `text-subtle`) aunque luego se cierre o se abra
 *  otra para mirar — ese acento es "dónde estoy", no "qué está abierto". */
function Contenido({ rutaActual }: { rutaActual: string }) {
  const idRamaActiva = arbolDocs.find((r) => rutaActual.startsWith(`/docs/${r.id}/`))?.id;
  const [abiertas, setAbiertas] = useState<Set<string>>(() => new Set(idRamaActiva ? [idRamaActiva] : []));

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
      {arbolDocs.map((rama, i) => {
        const ramaActiva = rama.id === idRamaActiva;
        const abierta = abiertas.has(rama.id);
        return (
          <div key={rama.id} className={`pb-2 ${i > 0 ? "mt-2 border-t border-border pt-3" : ""}`}>
            <button
              type="button"
              onClick={() =>
                setAbiertas((prev) => {
                  const siguiente = new Set(prev);
                  if (siguiente.has(rama.id)) siguiente.delete(rama.id);
                  else siguiente.add(rama.id);
                  return siguiente;
                })
              }
              className={`jg-micro mb-[3px] flex w-full items-center gap-[7px] px-4 py-1 text-[10.5px] uppercase tracking-[.1em] ${
                ramaActiva ? "text-fg" : "text-subtle hover:text-muted"
              }`}
            >
              <GlifoRama glifo={rama.glifo} className="h-[12px] w-[12px] shrink-0" />
              {rama.titulo}
              <IconoDespliega abierta={abierta} />
            </button>
            {abierta &&
              rama.paginas.map((pagina) => {
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
        );
      })}
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
