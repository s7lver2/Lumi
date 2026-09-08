const KEY = "lumi.reducir-movimiento";
const KEY_ESCALA = "lumi.escala-interfaz";
const KEY_FONDO = "lumi.fondo-entrada";

/** Porcentajes admitidos para el tamaño de la interfaz. Se probó `zoom` (no
 *  estándar, pero WebView2 lo soporta — es Chromium) primero, pero apilaba un
 *  segundo mecanismo de escala encima del `transform: scale(--ui-scale)` que
 *  ya usa `index.css` para el escalado automático por tamaño de ventana —
 *  dos mecanismos sobre el mismo árbol desalineaban subpíxeles en escalas no
 *  estándar (85%, 140%), visible como overflow en elementos con márgenes
 *  ajustados (p.ej. el toggle de "reducir movimiento"). Ahora este valor solo
 *  escribe `--ui-scale-user`, que `index.css` combina con el factor de
 *  breakpoint (`--ui-scale-base`) en una única variable `--ui-scale` — un
 *  solo `transform: scale`, sin desajuste. */
export const ESCALAS_INTERFAZ = [85, 90, 100, 110, 125, 140] as const;
export type EscalaInterfaz = (typeof ESCALAS_INTERFAZ)[number];

export function aplicarEscalaInterfaz(pct: number) {
  document.documentElement.style.setProperty("--ui-scale-user", String(pct / 100));
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

/** Los dos fondos de las pantallas de entrada (#120). `EntryScreen` elige
 *  entre ellos al montar; "aleatorio" preserva el comportamiento original
 *  (uno distinto por apertura de la app). */
export const FONDOS_ENTRADA = ["aleatorio", "ascii", "olas"] as const;
export type FondoEntrada = (typeof FONDOS_ENTRADA)[number];

export function leerFondoEntrada(): FondoEntrada {
  try {
    const v = localStorage.getItem(KEY_FONDO);
    return (FONDOS_ENTRADA as readonly string[]).includes(v ?? "") ? (v as FondoEntrada) : "aleatorio";
  } catch {
    return "aleatorio";
  }
}

export function setFondoEntrada(v: FondoEntrada) {
  localStorage.setItem(KEY_FONDO, v);
}
