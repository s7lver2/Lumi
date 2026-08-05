import { useEffect, useMemo, useState } from "react";

/** El orden a mano es una preferencia de quien mira, no un dato del caso: el
 *  servidor no guarda ninguna columna de orden y no se la inventa aquí. Se
 *  recuerda en este equipo, con una clave por lista, y se reconcilia con lo que
 *  el servidor devuelva — lo nuevo va al final y lo que ya no existe se cae. */
function leer(key: string): number[] {
  try {
    const raw = localStorage.getItem(`lumi.orden.${key}`);
    const v = raw ? JSON.parse(raw) : null;
    return Array.isArray(v) ? v.filter((x) => typeof x === "number") : [];
  } catch {
    return [];
  }
}

function escribir(key: string, ids: number[]) {
  try {
    localStorage.setItem(`lumi.orden.${key}`, JSON.stringify(ids));
  } catch { /* sin almacenamiento: el orden dura lo que la sesión */ }
}

export interface Reorder<T> {
  /** La lista ya colocada. Es la que hay que pintar. */
  items: T[];
  /** Props para cada elemento arrastrable. */
  drag: (id: number) => {
    draggable: true;
    onDragStart: (e: React.DragEvent) => void;
    onDragEnd: () => void;
    onDragOver: (e: React.DragEvent) => void;
    onDrop: (e: React.DragEvent) => void;
    "data-dragging": boolean | undefined;
  };
  /** `true` mientras se arrastra: sirve para que el clic de soltar no abra lo
   *  que acabas de colocar. */
  dragging: boolean;
}

/** Reordenar arrastrando, con el orden guardado en este equipo.
 *
 *  `axis` es cómo se lee el gesto: `x` para una tira o una rejilla (donde lo
 *  que decide es a qué lado de la tarjeta sueltas), `y` para una lista. */
export function useReorder<T extends { id: number }>(
  key: string, source: T[], axis: "x" | "y" = "y",
): Reorder<T> {
  const [orden, setOrden] = useState<number[]>(() => leer(key));
  const [drag, setDrag] = useState<number | null>(null);
  // El clic de soltar llega DESPUÉS de `dragend`; sin esta tregua, recolocar
  // una tarjeta acabaría abriéndola.
  const [recien, setRecien] = useState(false);

  useEffect(() => { setOrden(leer(key)); }, [key]);

  const items = useMemo(() => {
    const pos = new Map(orden.map((id, i) => [id, i]));
    return [...source].sort((a, b) => {
      const ia = pos.get(a.id), ib = pos.get(b.id);
      if (ia === undefined && ib === undefined) return 0;
      if (ia === undefined) return 1;
      if (ib === undefined) return -1;
      return ia - ib;
    });
  }, [source, orden]);

  function mover(from: number, to: number) {
    const ids = items.map((i) => i.id);
    const i = ids.indexOf(from);
    const j = ids.indexOf(to);
    if (i < 0 || j < 0 || i === j) return;
    ids.splice(j, 0, ...ids.splice(i, 1));
    setOrden(ids);
    escribir(key, ids);
  }

  return {
    items,
    dragging: recien,
    drag: (id: number) => ({
      draggable: true as const,
      onDragStart: (e: React.DragEvent) => {
        setDrag(id);
        setRecien(true);
        e.dataTransfer.effectAllowed = "move";
        // Firefox no arranca el arrastre si no se le ponen datos.
        e.dataTransfer.setData("text/plain", String(id));
      },
      onDragEnd: () => {
        setDrag(null);
        setTimeout(() => setRecien(false), 60);
      },
      onDragOver: (e: React.DragEvent) => {
        if (drag === null || drag === id) return;
        e.preventDefault();
        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const pasado = axis === "x"
          ? e.clientX > r.left + r.width / 2
          : e.clientY > r.top + r.height / 2;
        const ids = items.map((i) => i.id);
        const haciaDelante = ids.indexOf(drag) < ids.indexOf(id);
        // Solo se mueve cuando el cursor ha cruzado el centro del vecino: si no,
        // el elemento vibraría entre dos posiciones dentro del mismo hueco.
        if (pasado === haciaDelante) mover(drag, id);
      },
      onDrop: (e: React.DragEvent) => e.preventDefault(),
      "data-dragging": drag === id ? true : undefined,
    }),
  };
}
