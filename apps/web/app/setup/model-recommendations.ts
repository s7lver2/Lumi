import { MODEL_BUNDLES, type ModelBundleDefinition } from "@netryx/shared-types";

export const USE_CASES = [
  { id: "image-recognition", label: "Reconocimiento de imágenes", icon: "📷", blurb: "identificar lugares a partir de fotos" },
  { id: "testing", label: "Solo testeo", icon: "🧪", blurb: "probar la app, sin uso serio" },
  { id: "geolocation", label: "Geolocalización", icon: "📍", blurb: "ubicar imágenes en el mapa" },
  { id: "experimentation", label: "Experimentación", icon: "🛠", blurb: "probar herramientas y modelos" },
] as const;

export type UseCaseId = (typeof USE_CASES)[number]["id"];

// Every use case maps to the same bundle today — MODEL_BUNDLES has exactly
// one entry (lumi-preview). Adding a second bundle later means adding rows
// here without touching UsageStep/ModelsStep.
const RECOMMENDATIONS_BY_USE_CASE: Record<UseCaseId, string[]> = {
  "image-recognition": ["lumi-preview"],
  testing: ["lumi-preview"],
  geolocation: ["lumi-preview"],
  experimentation: ["lumi-preview"],
};

export function recommendedBundles(selected: UseCaseId[]): ModelBundleDefinition[] {
  const ids = new Set(selected.flatMap((id) => RECOMMENDATIONS_BY_USE_CASE[id] ?? []));
  return MODEL_BUNDLES.filter((b) => ids.has(b.id));
}
