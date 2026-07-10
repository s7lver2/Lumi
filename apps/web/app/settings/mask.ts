// apps/web/app/settings/mask.ts
const DOTS = "•".repeat(12);
/** Muestra los primeros 4 caracteres del secreto; el resto se enmascara. */
export function maskSecret(value: string): string {
  if (!value) return "";
  return value.slice(0, 4) + DOTS;
}