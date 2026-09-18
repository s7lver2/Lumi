"use client";

import { slugificar } from "../../lib/slug";

function textoPlano(nodo: React.ReactNode): string {
  if (typeof nodo === "string") return nodo;
  if (typeof nodo === "number") return String(nodo);
  if (Array.isArray(nodo)) return nodo.map(textoPlano).join("");
  if (nodo && typeof nodo === "object" && "props" in (nodo as { props?: { children?: React.ReactNode } })) {
    return textoPlano((nodo as { props: { children?: React.ReactNode } }).props.children);
  }
  return "";
}

export function EncabezadoDocs({ nivel, children }: { nivel: 2 | 3; children: React.ReactNode }) {
  const id = slugificar(textoPlano(children));
  const Tag = nivel === 2 ? "h2" : "h3";
  return (
    <Tag id={id} className="group scroll-mt-24 text-[15px] font-medium tracking-[-.01em] text-fg [&:not(:first-child)]:mt-11">
      <a href={`#${id}`} className="no-underline">
        {children}
        <span className="ml-2 text-subtle opacity-0 transition-opacity duration-150 group-hover:opacity-100">#</span>
      </a>
    </Tag>
  );
}
