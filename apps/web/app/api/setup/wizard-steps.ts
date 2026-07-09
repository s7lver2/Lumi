// apps/web/app/setup/wizard-steps.ts
export const WIZARD_STEPS = [
  { id: "prereqs", title: "Prerequisitos" },
  { id: "migrate", title: "Base de datos" },
  { id: "credentials", title: "Credenciales" },
  { id: "inference", title: "Dependencias de inferencia" },
  { id: "confirm", title: "Confirmación" },
] as const;
export type StepId = (typeof WIZARD_STEPS)[number]["id"];
export function nextStep(id: StepId): StepId | null {
  const i = WIZARD_STEPS.findIndex((s) => s.id === id);
  return i >= 0 && i < WIZARD_STEPS.length - 1 ? WIZARD_STEPS[i + 1].id : null;
}
export function isComplete(id: StepId): boolean { return id === "confirm"; }