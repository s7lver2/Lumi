// apps/web/lib/weather-label.ts

/** Wanda's weather facet (prithivMLmods/Weather-Image-Classification, an
 * HF image-classification pipeline) predicts exactly five fixed English
 * labels (confirmed via the model card) — this translates them for
 * display in an otherwise-Spanish UI. Unlike time_of_day's label→hour
 * mapping, there's no representative value to synthesize here (a weather
 * category doesn't reduce to a single number), so this is translation
 * only — an unrecognized label (a future model version) falls back to
 * showing itself rather than guessing or hiding the result. */
const WEATHER_LABEL_ES: Record<string, string> = {
  "cloudy/overcast": "Nublado",
  "foggy/hazy": "Niebla",
  "rain/storm": "Lluvia",
  "snow/frosty": "Nieve",
  "sun/clear": "Despejado",
};

export function spanishWeatherLabel(label: string): string {
  return WEATHER_LABEL_ES[label] ?? label;
}
