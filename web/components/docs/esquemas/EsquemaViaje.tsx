"use client";

import Link from "next/link";
import { useState } from "react";
import { Esquema } from "../Esquema";

type Etapa = {
  id: string;
  nombre: string;
  sub: string;
  href: string;
  detalle: string;
};

const ETAPAS: Etapa[] = [
  {
    id: "foto",
    nombre: "La foto",
    sub: "→ vector",
    href: "/docs/como-funciona/el-viaje-de-una-foto",
    detalle:
      "Una fotografía se convierte en un vector de alta dimensión con el modelo de recuperación activo — por defecto SALAD.",
  },
  {
    id: "indice",
    nombre: "El índice",
    sub: "200 candidatos",
    href: "/docs/como-funciona/recuperacion",
    detalle:
      "El vector de tu foto se compara contra millones de vectores de calles ya indexadas. Qdrant mantiene un grafo navegable que llega a los vecinos más próximos visitando una fracción diminuta del total.",
  },
  {
    id: "verificar",
    nombre: "Verificar",
    sub: "geometría",
    href: "/docs/como-funciona/verificacion",
    detalle:
      "Cada candidato se pone a prueba emparejando píxel a píxel con RoMa u otro verificador geométrico. Un candidato que solo se parecía en el color se cae aquí.",
  },
  {
    id: "agentes",
    nombre: "Agentes",
    sub: "qué se ve",
    href: "/docs/como-funciona/agentes",
    detalle:
      "Modelos de visión-lenguaje leen la foto en busca de indicios — idioma, señalética, vegetación— y penalizan las hipótesis que los contradicen.",
  },
  {
    id: "veredicto",
    nombre: "Veredicto",
    sub: "hipótesis",
    href: "/docs/como-funciona/veredicto",
    detalle: "Las hipótesis supervivientes se ordenan por confianza. Ningún agente descarta del todo: solo penaliza.",
  },
];

export function EsquemaViaje({ rutaActual, dimensionesTexto }: { rutaActual: string; dimensionesTexto?: string }) {
  const inicial = Math.max(
    0,
    ETAPAS.findIndex((e) => e.href === rutaActual)
  );
  const [activa, setActiva] = useState(inicial);
  const actual = ETAPAS[activa];

  return (
    <Esquema etiqueta="esquema · el pulso recorre las cinco etapas">
      <div className="flex items-stretch gap-0">
        {ETAPAS.map((etapa, i) => (
          <div key={etapa.id} className="flex flex-1 items-stretch">
            <div className="flex flex-1 flex-col items-center gap-[9px]">
              {etapa.href === rutaActual ? (
                <button
                  type="button"
                  onClick={() => setActiva(i)}
                  className={`flex h-[62px] w-full flex-col items-center justify-center gap-1 rounded-[9px] border bg-elevated transition-colors duration-200 ${
                    i === activa ? "border-white/[.34]" : "border-border"
                  }`}
                >
                  <div className="text-center text-[11.5px] leading-tight text-fg">{etapa.nombre}</div>
                  <div className="font-mono text-[9.5px] text-subtle">{etapa.sub}</div>
                </button>
              ) : (
                <Link
                  href={etapa.href}
                  className="flex h-[62px] w-full flex-col items-center justify-center gap-1 rounded-[9px] border border-border bg-elevated transition-colors duration-200 hover:border-white/[.34]"
                >
                  <div className="text-center text-[11.5px] leading-tight text-fg">{etapa.nombre}</div>
                  <div className="font-mono text-[9.5px] text-subtle">{etapa.sub}</div>
                </Link>
              )}
              <div className="font-mono text-[10px] text-subtle">{i + 1}</div>
            </div>
            {i < ETAPAS.length - 1 && (
              <div className="relative flex w-[34px] shrink-0 items-center justify-center pb-5">
                <div className="h-px w-full bg-border" />
                <div className="jg-viaje-pulso absolute top-[calc(50%-12px)] left-0 h-[5px] w-[5px] rounded-full bg-fg" />
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="mt-4 border-t border-border pt-[14px]">
        <p className="text-[12.5px] leading-relaxed text-muted">
          <b className="font-normal text-fg">
            Etapa {activa + 1} · {actual.nombre}.
          </b>{" "}
          {actual.detalle}
        </p>
        {activa === 0 && dimensionesTexto && (
          <div className="mt-[11px] flex gap-[26px]">
            <div>
              <div className="font-mono text-[15px] text-fg">{dimensionesTexto}</div>
              <div className="mt-[3px] font-mono text-[9.5px] uppercase tracking-[.1em] text-subtle">dimensiones</div>
            </div>
          </div>
        )}
        {activa === 1 && (
          <div className="mt-[11px] flex gap-[26px]">
            <div>
              <div className="font-mono text-[15px] text-fg">200</div>
              <div className="mt-[3px] font-mono text-[9.5px] uppercase tracking-[.1em] text-subtle">candidatos</div>
            </div>
            <div>
              <div className="font-mono text-[15px] text-fg">z14</div>
              <div className="mt-[3px] font-mono text-[9.5px] uppercase tracking-[.1em] text-subtle">tesela</div>
            </div>
          </div>
        )}
      </div>
    </Esquema>
  );
}
