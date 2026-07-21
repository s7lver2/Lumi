// apps/web/app/components/widgets/WeatherEstimateWidget.tsx
"use client";
import { InfoTooltip } from "../InfoTooltip";
import { spanishWeatherLabel } from "../../../lib/weather-label";

const WEATHER_ICON = (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
    <circle cx="9" cy="10" r="4" /><path d="M9 2v1.5M15.5 5l-1 1.3M2 10h1.5M4 5l1 1.3" /><path d="M5 18a4 4 0 0 1 4-4h6a3.5 3.5 0 0 1 0 7H8a3 3 0 0 1-3-3z" />
  </svg>
);
const LOCK_ICON = (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ animation: "jg-lock-breathe 2.6s ease-in-out infinite" }}>
    <rect x="5" y="11" width="14" height="9" rx="1.5" /><path d="M8 11V7a4 4 0 0 1 8 0v4" />
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
    <div className="relative overflow-hidden rounded-lg">
      <div className={locked ? "blur-[4px] opacity-50" : undefined}>
        <div className="mb-2.5 flex items-center gap-1.5">
          {WEATHER_ICON}
          <span className="flex-1 text-[10.5px] font-medium text-fg">Clima estimado</span>
          <InfoTooltip text="Clasificado a partir de la imagen (Wanda)" />
        </div>
        <div className="text-center text-[18px] font-semibold text-fg">
          {weather ? spanishWeatherLabel(weather.label) : "—"}
        </div>
        {weather && (
          <div className="mt-0.5 text-center text-[9.5px] text-muted">{Math.round(weather.score * 100)}% confianza</div>
        )}
      </div>
      {locked && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[#0e0f11]/35">
          <div className="flex h-[26px] w-[26px] items-center justify-center rounded-full border border-white/35">{LOCK_ICON}</div>
          <button
            onClick={onInstall}
            className="rounded-lg bg-accent px-2.5 py-1.5 text-[9.5px] font-medium text-black transition-transform hover:scale-105 active:scale-90"
          >
            Instalar Clima estimado
          </button>
        </div>
      )}
    </div>
  );
}
