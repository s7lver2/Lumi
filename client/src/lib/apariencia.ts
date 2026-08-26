const KEY = "lumi.reducir-movimiento";

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
