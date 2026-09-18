import Link from "next/link";
import indice from "../../lib/indiceDocs.json";
import { siguienteYAnterior } from "../../lib/arbolDocs";

type PaginaIndice = {
  ruta: string;
  procedencia: string[];
  envejecida: boolean;
};

const REPO_GITHUB = "https://github.com/s7lver2/Lumi/blob/main";

export function PiePaginaDocs({ ruta }: { ruta: string }) {
  const entrada = (indice as { paginas: PaginaIndice[] }).paginas.find((p) => p.ruta === ruta);
  const partes = ruta.split("/").filter(Boolean);
  const ramaId = partes[1];
  const paginaRuta = partes[2];
  const { anterior, siguiente } = siguienteYAnterior(ramaId, paginaRuta);

  return (
    <footer className="mt-16 border-t border-border pt-6">
      {entrada && entrada.procedencia.length > 0 && (
        <div className="text-[11px] leading-relaxed text-subtle">
          <span className="uppercase tracking-[.08em]">Escrito contra </span>
          {entrada.procedencia.map((f, i) => (
            <span key={f}>
              {i > 0 && ", "}
              <a href={`${REPO_GITHUB}/${f}`} className="font-mono text-subtle underline decoration-dotted hover:text-muted">
                {f}
              </a>
            </span>
          ))}
          {entrada.envejecida && (
            <div className="mt-1.5 text-warning-fg">
              El código que describe esta página ha cambiado desde la última revisión.
            </div>
          )}
        </div>
      )}
      <div className="mt-6 flex items-stretch gap-3">
        {anterior ? (
          <Link
            href={`/docs/${anterior.ramaId}/${anterior.ruta}`}
            className="jg-micro flex-1 rounded-card border border-border bg-panel px-4 py-3 hover:border-[#33363b]"
          >
            <div className="text-[10px] uppercase tracking-[.08em] text-subtle">Anterior</div>
            <div className="mt-1 text-[13px] text-fg">{anterior.titulo}</div>
          </Link>
        ) : (
          <div className="flex-1" />
        )}
        {siguiente && (
          <Link
            href={`/docs/${siguiente.ramaId}/${siguiente.ruta}`}
            className="jg-micro flex-1 rounded-card border border-border bg-panel px-4 py-3 text-right hover:border-[#33363b]"
          >
            <div className="text-[10px] uppercase tracking-[.08em] text-subtle">Siguiente</div>
            <div className="mt-1 text-[13px] text-fg">{siguiente.titulo}</div>
          </Link>
        )}
      </div>
    </footer>
  );
}
