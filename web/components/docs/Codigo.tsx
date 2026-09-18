"use client";

type Anotacion = { linea: number; texto: string };

export function Codigo({
  titulo,
  codigo,
  anotaciones = [],
}: {
  titulo: string;
  codigo: string;
  anotaciones?: Anotacion[];
}) {
  const lineas = codigo.split("\n");

  function copiar() {
    navigator.clipboard.writeText(codigo).catch(() => {});
  }

  return (
    <div className="mt-[18px] overflow-hidden rounded-[8px] border border-border bg-[#0b0c0e]">
      <div className="flex items-center border-b border-border px-[11px] py-[7px]">
        <span className="font-mono text-[10px] text-subtle">{titulo}</span>
        <button
          type="button"
          onClick={copiar}
          className="jg-micro ml-auto rounded-[5px] border border-border px-[7px] py-[2px] font-mono text-[10px] text-subtle hover:text-muted"
        >
          copiar
        </button>
      </div>
      <pre className="overflow-x-auto px-[13px] py-3 font-mono text-[11.5px] leading-[1.75] text-muted">
        {lineas.map((l, i) => {
          const n = i + 1;
          const nota = anotaciones.find((a) => a.linea === n);
          return (
            <div key={n} className={nota ? "text-fg" : undefined}>
              {l}
              {nota && <span className="ml-2 text-subtle">{"// " + nota.texto}</span>}
            </div>
          );
        })}
      </pre>
    </div>
  );
}
