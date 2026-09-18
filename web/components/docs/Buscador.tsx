"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import indice from "../../lib/indiceDocs.json";

type Encabezado = { id: string; texto: string; nivel: number; parrafo: string };
type PaginaIndice = { ruta: string; ramaTitulo: string; titulo: string; frase: string; encabezados: Encabezado[] };

type Resultado = { ruta: string; ramaTitulo: string; titulo: string; contexto: string };

function buscar(consulta: string): Resultado[] {
  const q = consulta.trim().toLowerCase();
  if (q.length === 0) return [];
  const paginas = (indice as { paginas: PaginaIndice[] }).paginas;
  const resultados: Resultado[] = [];
  for (const p of paginas) {
    if (p.titulo.toLowerCase().includes(q) || p.frase.toLowerCase().includes(q)) {
      resultados.push({ ruta: p.ruta, ramaTitulo: p.ramaTitulo, titulo: p.titulo, contexto: p.frase });
    }
    for (const h of p.encabezados) {
      if (h.texto.toLowerCase().includes(q) || h.parrafo.toLowerCase().includes(q)) {
        resultados.push({ ruta: `${p.ruta}#${h.id}`, ramaTitulo: p.ramaTitulo, titulo: `${p.titulo} · ${h.texto}`, contexto: h.parrafo });
      }
    }
  }
  return resultados.slice(0, 24);
}

export function Buscador() {
  const [abierto, setAbierto] = useState(false);
  const [consulta, setConsulta] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const resultados = useMemo(() => buscar(consulta), [consulta]);
  const grupos = useMemo(() => {
    const mapa = new Map<string, Resultado[]>();
    for (const r of resultados) {
      const lista = mapa.get(r.ramaTitulo) ?? [];
      lista.push(r);
      mapa.set(r.ramaTitulo, lista);
    }
    return Array.from(mapa.entries());
  }, [resultados]);

  useEffect(() => {
    function alTeclado(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setAbierto((v) => !v);
      }
      if (e.key === "Escape") setAbierto(false);
    }
    function alEvento() {
      setAbierto(true);
    }
    window.addEventListener("keydown", alTeclado);
    window.addEventListener("docs:abrir-buscador", alEvento);
    return () => {
      window.removeEventListener("keydown", alTeclado);
      window.removeEventListener("docs:abrir-buscador", alEvento);
    };
  }, []);

  useEffect(() => {
    if (abierto) {
      setConsulta("");
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [abierto]);

  if (!abierto) return null;

  function ir(ruta: string) {
    setAbierto(false);
    router.push(ruta);
  }

  return (
    <div className="fixed inset-0 z-40 flex justify-center" onClick={() => setAbierto(false)}>
      <div className="absolute inset-0 bg-[rgba(6,7,9,.72)] backdrop-blur-[3px]" />
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative z-10 mt-24 h-fit max-h-[70vh] w-[600px] max-w-[92vw] overflow-hidden rounded-card border border-white/[.13] bg-[rgba(16,19,25,.94)] shadow-2xl backdrop-blur-xl"
      >
        <div className="flex items-center gap-[11px] border-b border-border px-4 py-[14px]">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#6a6c70" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-4.2-4.2" />
          </svg>
          <input
            ref={inputRef}
            value={consulta}
            onChange={(e) => setConsulta(e.target.value)}
            placeholder="Buscar en la documentación"
            className="flex-1 bg-transparent text-[14px] text-fg outline-none placeholder:text-subtle"
          />
        </div>
        <div className="max-h-[52vh] overflow-y-auto py-2">
          {grupos.map(([rama, items]) => (
            <div key={rama}>
              <div className="px-4 py-[6px] text-[9px] uppercase tracking-[.12em] text-subtle">{rama}</div>
              {items.map((r) => (
                <button
                  key={r.ruta}
                  onClick={() => ir(r.ruta)}
                  className="jg-micro flex w-full items-baseline gap-[10px] px-4 py-2 text-left hover:bg-white/[.055]"
                >
                  <span className="whitespace-nowrap text-[12.5px] text-fg">{r.titulo}</span>
                  <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-[11px] text-subtle">{r.contexto}</span>
                </button>
              ))}
            </div>
          ))}
          {consulta.trim().length > 0 && resultados.length === 0 && (
            <div className="px-4 py-6 text-center text-[12px] text-subtle">Sin resultados.</div>
          )}
        </div>
      </div>
    </div>
  );
}
