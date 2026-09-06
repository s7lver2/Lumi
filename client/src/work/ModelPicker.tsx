import { useState } from "react";
import { Icon } from "../ui/Icon";

/** Los tres niveles, descritos por lo que llevan dentro — que es lo que el
 *  investigador está eligiendo cuando elige. Antes solo se conocía `mini` y
 *  para `pro` y `vision` se enseñaba «modelo habilitado por el servidor»: era
 *  honesto cuando no había ficha, y deja de serlo ahora que sí la hay. Un id
 *  desconocido sigue pasando tal cual: inventarle una ficha sería peor. */
const CONOCIDOS: Record<string, { name: string; note: string }> = {
  mini: {
    name: "Lumi Mini",
    note: "1 recuperador · 1 verificador · rápido, aproximado, corre en un escritorio",
  },
  pro: {
    name: "Lumi Pro",
    note: "4 recuperadores · 2 verificadores · dos familias mezcladas, coste medio",
  },
  vision: {
    name: "Lumi Vision",
    note: "8 recuperadores · 4 verificadores · lo más preciso, y lo más caro de correr",
  },
};

const ficha = (id: string) =>
  CONOCIDOS[id] ?? { name: id, note: "modelo habilitado por el servidor" };

export function ModelPicker({ models, value, onChange }: {
  models: string[]; value: string; onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const actual = ficha(value);

  if (models.length === 0) {
    return (
      <div className="mt-3.5 flex items-start gap-2.5 rounded-lg border border-white/[.07] bg-white/[.02] p-2.5">
        <Icon name="alert" size={13} className="mt-px text-warning-fg" />
        <p className="text-[10.5px] leading-relaxed text-muted">
          Tu cuenta no tiene ningún modelo habilitado. Habla con el administrador:
          hasta entonces no hay con qué analizar.
        </p>
      </div>
    );
  }

  // Con un solo modelo no hay nada que elegir, y un desplegable de un elemento
  // es un clic que no decide nada. Se enseña cuál es y por qué es el único.
  if (models.length === 1 || !open) {
    return (
      <button onClick={() => models.length > 1 && setOpen(true)}
        disabled={models.length === 1}
        className={`mt-3.5 flex w-full items-center gap-2.5 rounded-lg bg-white/[.04] p-2.5 text-left
          ${models.length > 1 ? "jg-press" : ""}`}>
        <span className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-lg bg-white/[.06] text-fg">
          <Icon name="globe" size={15} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[11.5px] font-medium text-fg">{actual.name}</span>
          <span className="block truncate text-[9.5px] text-muted">{actual.note}</span>
        </span>
        {models.length > 1 ? (
          <span className="flex shrink-0 items-center gap-0.5 text-[10px] text-muted">
            Cambiar <Icon name="chevron" size={9} />
          </span>
        ) : (
          <span className="shrink-0 text-[9.5px] text-subtle">único habilitado</span>
        )}
      </button>
    );
  }

  return (
    <div className="mt-3.5 rounded-lg bg-white/[.02] p-1">
      {models.map((id) => {
        const f = ficha(id);
        const on = id === value;
        return (
          <button key={id} onClick={() => { onChange(id); setOpen(false); }}
            className={`flex w-full items-center gap-2.5 rounded-lg p-2.5 text-left
              transition-colors duration-300 ease-expo ${on ? "bg-white/[.06]" : "hover:bg-white/[.03]"}`}>
            <span className={`grid h-[30px] w-[30px] shrink-0 place-items-center rounded-lg
              ${on ? "bg-white/[.08] text-fg" : "bg-white/[.04] text-muted"}`}>
              <Icon name="globe" size={15} />
            </span>
            <span className="min-w-0 flex-1">
              <span className={`block text-[11.5px] font-medium ${on ? "text-fg" : "text-muted"}`}>{f.name}</span>
              <span className="block truncate text-[9.5px] text-subtle">{f.note}</span>
            </span>
            {on && <Icon name="check" size={14} className="shrink-0 text-fg" />}
          </button>
        );
      })}
    </div>
  );
}
