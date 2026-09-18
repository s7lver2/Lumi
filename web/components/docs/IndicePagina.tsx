"use client";

import { useEffect, useState } from "react";

type Item = { id: string; texto: string; nivel: number };

/** Índice de la página actual (columna derecha, 210px, solo desde
 *  min-[900px] — en 900–1200px puede que ya no sobre sitio, así que en
 *  realidad se reserva desde xl como el resto del sitio de tres columnas
 *  hace con paneles secundarios). Lee los encabezados directamente del DOM
 *  ya renderizado en vez de duplicar esa lista en indiceDocs.json — ver
 *  decisión 4 del plan. */
export function IndicePagina() {
  const [items, setItems] = useState<Item[]>([]);
  const [activo, setActivo] = useState<string | null>(null);

  useEffect(() => {
    const nodos = Array.from(
      document.querySelectorAll<HTMLElement>("#contenido-docs h2, #contenido-docs h3")
    );
    setItems(
      nodos.map((n) => ({
        id: n.id,
        // Solo el texto del título real: el "#" de permalink vive en un
        // <span aria-hidden> hermano dentro del mismo <a> y no debe colarse
        // aquí (ver EncabezadoDocs).
        texto: n.querySelector<HTMLElement>("[data-titulo-encabezado]")?.textContent ?? n.textContent ?? "",
        nivel: n.tagName === "H2" ? 2 : 3,
      }))
    );
    if (nodos.length === 0) return;

    const observador = new IntersectionObserver(
      (entradas) => {
        const visible = entradas.find((e) => e.isIntersecting);
        if (visible) setActivo(visible.target.id);
      },
      { rootMargin: "-88px 0px -70% 0px" }
    );
    nodos.forEach((n) => observador.observe(n));
    return () => observador.disconnect();
  }, []);

  if (items.length === 0) return null;

  return (
    <nav className="hidden w-[210px] shrink-0 pl-[22px] pt-[52px] xl:block">
      <div className="text-[9.5px] uppercase tracking-[.12em] text-subtle">En esta página</div>
      <div className="mt-2.5 flex flex-col gap-1">
        {items.map((it) => (
          <a
            key={it.id}
            href={`#${it.id}`}
            className={`jg-micro border-l text-[11.5px] leading-tight ${it.nivel === 3 ? "pl-[22px]" : "pl-[11px]"} py-1 ${
              activo === it.id ? "border-fg text-fg" : "border-border text-subtle hover:text-muted"
            }`}
          >
            {it.texto}
          </a>
        ))}
      </div>
    </nav>
  );
}
