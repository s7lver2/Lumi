const KEY = "lumi.reducir-movimiento";
const KEY_ESCALA = "lumi.escala-interfaz";

/** Porcentajes admitidos para el tamaño de la interfaz. `zoom` (no
 *  estándar, pero WebView2 lo soporta bien — es Chromium) en vez de
 *  reescalar `rem`: casi todo el tamaño en este código está en `px`
 *  literales (`text-[11.5px]`, `p-[13px_16px]`), no en unidades relativas,
 *  así que tocar `font-size` en `:root` no habría movido nada. */
export const ESCALAS_INTERFAZ = [85, 90, 100, 110, 125, 140] as const;
export type EscalaInterfaz = (typeof ESCALAS_INTERFAZ)[number];

export function aplicarEscalaInterfaz(pct: number) {
  (document.documentElement.style as unknown as { zoom: string }).zoom = `${pct}%`;
}

export function leerEscalaInterfaz(): EscalaInterfaz {
  try {
    const v = Number(localStorage.getItem(KEY_ESCALA));
    return (ESCALAS_INTERFAZ as readonly number[]).includes(v) ? (v as EscalaInterfaz) : 100;
  } catch {
    return 100;
  }
}

export function setEscalaInterfaz(pct: EscalaInterfaz) {
  localStorage.setItem(KEY_ESCALA, String(pct));
  aplicarEscalaInterfaz(pct);
}

/** Aplica/quita la clase que la regla CSS de `index.css` usa para apagar
 *  animaciones y transiciones de golpe — separada de `setReducirMovimiento`
 *  para poder aplicarla en `main.tsx` sin escribir en `localStorage` otra
 *  vez cada vez que arranca la app. */
export function aplicarReducirMovimiento(activo: boolean) {
  document.documentElement.classList.toggle("jg-reduce-motion", activo);
}

export function leerReducirMovimiento(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function setReducirMovimiento(activo: boolean) {
  localStorage.setItem(KEY, activo ? "1" : "0");
  aplicarReducirMovimiento(activo);
}
