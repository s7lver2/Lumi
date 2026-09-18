"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import indice from "../../lib/indiceDocs.json";

type PaginaIndice = { ruta: string; ramaTitulo: string; titulo: string; frase: string };

export function EnlacePrevio({ ruta, children }: { ruta: string; children: React.ReactNode }) {
  const [abierta, setAbierta] = useState(false);
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pagina = (indice as { paginas: PaginaIndice[] }).paginas.find((p) => p.ruta === ruta);

  function entrar() {
    temporizador.current = setTimeout(() => setAbierta(true), 350);
  }
  function salir() {
    if (temporizador.current) clearTimeout(temporizador.current);
    setAbierta(false);
  }

  return (
    <span className="relative inline-block" onMouseEnter={entrar} onMouseLeave={salir}>
      <Link href={ruta} className="border-b border-dotted border-subtle pb-px text-fg no-underline hover:border-fg">
        {children}
      </Link>
      {abierta && pagina && (
        <span className="pointer-events-none absolute left-0 top-full z-30 mt-2 block w-64 rounded-card border border-border bg-panel p-3 text-left shadow-xl">
          <span className="block font-mono text-[10px] uppercase tracking-[.1em] text-subtle">{pagina.ramaTitulo}</span>
          <span className="mt-1 block text-[13px] text-fg">{pagina.titulo}</span>
          <span className="mt-1 block text-[11.5px] leading-relaxed text-subtle">{pagina.frase}</span>
        </span>
      )}
    </span>
  );
}
