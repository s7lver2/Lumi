// apps/web/app/components/widgets/WeatherEstimateWidget.tsx
"use client";
import { spanishWeatherLabel } from "../../../lib/weather-label";
import { LockedWidgetOverlay } from "./LockedWidgetOverlay";

export const WEATHER_ICON = (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
    <circle cx="9" cy="10" r="4" /><path d="M9 2v1.5M15.5 5l-1 1.3M2 10h1.5M4 5l1 1.3" /><path d="M5 18a4 4 0 0 1 4-4h6a3.5 3.5 0 0 1 0 7H8a3 3 0 0 1-3-3z" />
  </svg>
);

export function WeatherEstimateWidget({
  locked,
  weather,
  onInstall,
}: {
  locked: boolean;
  weather: { label: string; score: number } | null;
  onInstall: () => void;
}) {
  return (
    <div className="relative rounded-lg">
      <div className={locked ? "blur-[4px] opacity-50" : undefined}>
        <div className="text-center text-[18px] font-semibold text-fg">
          {weather ? spanishWeatherLabel(weather.label) : "—"}
        </div>
        {weather && (
          <div className="mt-0.5 text-center text-[9.5px] text-muted">{Math.round(weather.score * 100)}% confianza</div>
        )}
      </div>
      {locked && <LockedWidgetOverlay label="Clima estimado" onInstall={onInstall} />}
    </div>
  );
}
