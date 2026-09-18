import Link from "next/link";
import { arbolDocs } from "../../lib/arbolDocs";

export const metadata = {
  title: "Documentación · Lumi Station",
  description: "Cómo se despliega Lumi, cómo funciona por dentro y qué hace exactamente cada pieza.",
};

const DESCRIPCIONES: Record<string, string> = {
  "como-funciona":
    "El viaje completo de una foto: del píxel al vector, del vector a doscientos candidatos, de los candidatos a un veredicto con una confianza que significa algo. Con esquemas que se pueden tocar.",
  tecnologias:
    "Una página por técnica —RoMa, SALAD, Qwen3-VL, Qdrant— con qué problema resuelve, cómo lo resuelve y por qué está aquí y no otra.",
  empezar:
    "Instalar lumid en tu máquina, emparejar el cliente, actualizar y qué mirar cuando algo no arranca.",
  indexar:
    "El Indexer: orígenes de red, presupuesto, sellado de un .lumidx y publicación.",
  repo: "Layout del workspace, qué hace cada crate, el contrato Rust↔Python y cómo compilar cada mitad.",
};

export default function PortadaDocs() {
  return (
    <div>
      <div className="text-[34px] font-medium leading-[1.1] tracking-[-.025em]">Documentación</div>
      <p className="mt-3.5 max-w-[600px] text-[14.5px] leading-relaxed text-muted">
        Cómo se despliega Lumi, cómo funciona por dentro y qué hace exactamente cada pieza. Escrita
        para leerse entera o para consultar un dato suelto.
      </p>
      <div className="mt-11 grid grid-cols-1 gap-3 min-[640px]:grid-cols-2">
        {arbolDocs.map((rama, i) => {
          const escritas = rama.paginas.filter((p) => !p.pendiente).length;
          const total = rama.paginas.length;
          const primeraEscrita = rama.paginas.find((p) => !p.pendiente);
          const href = primeraEscrita ? `/docs/${rama.id}/${primeraEscrita.ruta}` : `/docs`;
          return (
            <Link
              key={rama.id}
              href={href}
              className={`jg-micro rounded-card border border-border bg-panel px-[18px] py-4 hover:border-[#33363b] ${
                i === 0 ? "min-[640px]:col-span-2" : ""
              }`}
            >
              <div className="text-[14px] text-fg">{rama.titulo}</div>
              <div className="mt-[7px] text-[12px] leading-relaxed text-subtle">{DESCRIPCIONES[rama.id]}</div>
              <div className="mt-3 font-mono text-[10px] uppercase tracking-[.07em] text-subtle">
                {escritas === total ? `${total} páginas` : `${total} páginas · pendiente`}
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
