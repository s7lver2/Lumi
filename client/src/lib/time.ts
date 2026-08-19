/** Formato compacto de "hace cuánto": "ahora", "12 min", "3 h", "2 d". Vive
 *  aquí porque ya lo necesitan dos sitios (la campana de notificaciones y
 *  el feed de actividad del Resumen) — una tercera copia habría sido la
 *  señal de que ya tocaba compartirlo. */
export function ago(ts: number): string {
  const s = Math.max(0, Math.floor(Date.now() / 1000) - ts);
  if (s < 60) return "ahora";
  if (s < 3600) return `${Math.floor(s / 60)} min`;
  if (s < 86400) return `${Math.floor(s / 3600)} h`;
  return `${Math.floor(s / 86400)} d`;
}
