"use client";

import { createContext, useContext, useState } from "react";

type EstadoProfundidad = { senal: number; valor: boolean; disparar: (v: boolean) => void };

const Contexto = createContext<EstadoProfundidad | null>(null);

export function ContextoProfundidadProveedor({ children }: { children: React.ReactNode }) {
  const [senal, setSenal] = useState(0);
  const [valor, setValor] = useState(false);

  function disparar(v: boolean) {
    setValor(v);
    setSenal((s) => s + 1);
  }

  return <Contexto.Provider value={{ senal, valor, disparar }}>{children}</Contexto.Provider>;
}

/** Cada <Detalle> se suscribe a `senal`: cuando cambia, se fuerza su estado
 *  a `valor`, pero el usuario puede seguir plegando/desplegando uno suelto
 *  después — la señal es un pulso, no un candado. */
export function useProfundidad(): EstadoProfundidad {
  const ctx = useContext(Contexto);
  if (!ctx) throw new Error("useProfundidad() fuera de ContextoProfundidadProveedor");
  return ctx;
}
