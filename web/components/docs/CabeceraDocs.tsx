import { ramaDeRuta, paginaDeRuta } from "../../lib/arbolDocs";
import { GlifoRama } from "./GlifoRama";

type Props = {
  /** Ruta completa, ej. "/docs/como-funciona/el-viaje-de-una-foto". */
  ruta: string;
  frase: string;
  /** Solo para la rama "tecnologías": tipo de la pieza (spec §2, "para
   *  tecnologías también el tipo"). */
  tipo?: string;
};

export function CabeceraDocs({ ruta, frase, tipo }: Props) {
  const partes = ruta.split("/").filter(Boolean); // ["docs", ramaId, paginaRuta]
  const ramaId = partes[1];
  const paginaRuta = partes[2];
  const rama = ramaDeRuta(ramaId);
  const pagina = paginaDeRuta(ramaId, paginaRuta);

  return (
    <header className="relative">
      {rama && (
        <GlifoRama
          glifo={rama.glifo}
          className="pointer-events-none absolute -right-2 -top-6 h-[104px] w-[104px] text-fg opacity-[.05]"
        />
      )}
      <div className="font-mono text-[10px] uppercase tracking-[.11em] text-subtle">
        {rama?.titulo}
        {tipo ? ` · ${tipo}` : ""}
      </div>
      <h1 className="mt-[6px] text-[27px] font-medium leading-[1.2] tracking-[-.02em] text-fg">
        {pagina?.titulo}
      </h1>
      <p className="mt-3.5 text-[15px] leading-relaxed text-muted">{frase}</p>
    </header>
  );
}
