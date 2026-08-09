import { api, type ProgresoPublicacion } from "../lib/api";

export interface EstadoPublicacion {
  indiceId: number;
  nombre: string;
  progreso: ProgresoPublicacion;
}

type Oyente = (e: EstadoPublicacion | null) => void;

/** Sigue una publicación de fondo con independencia de qué pantalla esté
 *  abierta: el trabajo ya vive suelto en el backend (un `spawn` que sigue
 *  corriendo aunque el diálogo se cierre), así que cerrar la ventana que lo
 *  arrancó no debería significar dejar de saber cómo va. Solo puede haber una
 *  publicación a la vez —el backend guarda un único hueco en `Estado`—, así
 *  que un singleton aquí es el reflejo exacto de eso, no una limitación de
 *  esta capa. */
let actual: EstadoPublicacion | null = null;
let intervalo: ReturnType<typeof setInterval> | null = null;
const oyentes = new Set<Oyente>();

function emitir() {
  oyentes.forEach((f) => f(actual));
}

export function estadoActual(): EstadoPublicacion | null {
  return actual;
}

export function suscribir(f: Oyente): () => void {
  oyentes.add(f);
  return () => oyentes.delete(f);
}

const VACIO: ProgresoPublicacion = {
  asset: "", hechos: 0, total: 0, bytes_hechos: 0, bytes_total: 0, terminado: false, error: null, registro: [],
};

export function iniciar(indiceId: number, nombre: string) {
  if (intervalo) clearInterval(intervalo);
  actual = { indiceId, nombre, progreso: VACIO };
  emitir();
  intervalo = setInterval(() => {
    void api.publicarProgreso().then((p) => {
      if (!actual) return;
      actual = { ...actual, progreso: p };
      emitir();
      if (p.terminado && intervalo) { clearInterval(intervalo); intervalo = null; }
    });
  }, 600);
}

export function descartar() {
  if (intervalo) { clearInterval(intervalo); intervalo = null; }
  actual = null;
  emitir();
}
