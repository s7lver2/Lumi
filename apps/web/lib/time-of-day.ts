// apps/web/lib/time-of-day.ts

/** Wanda's time_of_day facet (services/inference's CLIP zero-shot classifier,
 * manifest prompts confirmed live in installed_classification_models) is a
 * coarse 4-bucket classifier, not a continuous hour estimator — this maps
 * each bucket to a representative hour so EstimatedTimeWidget's existing
 * sun-arc visual (built for a hypothetical shadow-based hour model) can
 * still show something meaningful. An unrecognized label (a future model
 * with different prompt wording) returns null rather than guessing. */
const LABEL_TO_HOUR: Record<string, number> = {
  "foto tomada al amanecer": 6,
  "foto tomada al mediodía": 12.5,
  "foto tomada al atardecer": 19,
  "foto tomada de noche": 0,
};

export function hourForLabel(label: string): number | null {
  return LABEL_TO_HOUR[label] ?? null;
}