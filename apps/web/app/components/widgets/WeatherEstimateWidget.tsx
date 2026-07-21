// apps/web/app/components/widgets/WeatherEstimateWidget.tsx
"use client";
import { spanishWeatherLabel } from "../../../lib/weather-label";
import { LockedWidgetOverlay } from "./LockedWidgetOverlay";

export const WEATHER_ICON = (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
    <circle cx="9" cy="10" r="4" /><path d="M9 2v1.5M15.5 5l-1 1.3M2 10h1.5M4 5l1 1.3" /><path d="M5 18a4 4 0 0 1 4-4h6a3.5 3.5 0 0 1 0 7H8a3 3 0 0 1-3-3z" />
  </svg>
);

type WeatherKind = "sun" | "cloud" | "rain" | "snow" | "fog";

/** Wanda's weather facet predicts exactly five fixed labels (see
 * lib/weather-label.ts) — mapped here to which hand-drawn ASCII glyph to
 * animate. An unrecognized future label falls back to the cloud glyph
 * rather than rendering nothing. */
const KIND_BY_LABEL: Record<string, WeatherKind> = {
  "sun/clear": "sun",
  "cloudy/overcast": "cloud",
  "rain/storm": "rain",
  "snow/frosty": "snow",
  "foggy/hazy": "fog",
};

const CLOUD_BODY = `      .--.
   .-(    ).
  (___.__)__)`;

function AsciiWeatherArt({ kind }: { kind: WeatherKind }) {
  switch (kind) {
    case "sun":
      return (
        <pre className="ascii-weather" style={{ color: "#f2c94c", fontSize: 14, animation: "jg-sun-pulse 2.4s ease-in-out infinite" }}>
{`    \\   |   /
  *  \\  |  /  *
     \\ \\|/ /
 -----( * )-----
     / /|\\ \\
  *  /  |  \\  *
    /   |   \\`}
        </pre>
      );
    case "rain":
      return (
        <div className="flex flex-col items-center">
          <pre className="ascii-weather" style={{ color: "#c9cdd3", fontSize: 14 }}>{CLOUD_BODY}</pre>
          <pre className="ascii-weather" style={{ color: "#6fa8dc", fontSize: 14, animation: "jg-rain-fall 0.9s ease-in-out infinite" }}>
{`   / / / / /
  / / / / /`}
          </pre>
        </div>
      );
    case "snow":
      return (
        <div className="flex flex-col items-center">
          <pre className="ascii-weather" style={{ color: "#c9cdd3", fontSize: 14 }}>{CLOUD_BODY}</pre>
          <pre className="ascii-weather" style={{ color: "#e8e8e6", fontSize: 14, animation: "jg-snow-drift 2.6s ease-in-out infinite" }}>
{`   *  *  *  *
    *  *  *`}
          </pre>
        </div>
      );
    case "fog":
      return (
        <div className="flex flex-col items-center gap-0.5">
          <pre className="ascii-weather" style={{ color: "#8a9099", fontSize: 14, animation: "jg-fog-drift 3.6s ease-in-out infinite" }}>{"- - - - - - -"}</pre>
          <pre className="ascii-weather" style={{ color: "#8a9099", fontSize: 14, animation: "jg-fog-drift 3.6s ease-in-out infinite reverse" }}>{" - - - - - - -"}</pre>
          <pre className="ascii-weather" style={{ color: "#8a9099", fontSize: 14, animation: "jg-fog-drift 3.6s ease-in-out infinite" }}>{"- - - - - - - -"}</pre>
        </div>
      );
    case "cloud":
    default:
      return (
        <pre className="ascii-weather" style={{ color: "#c9cdd3", fontSize: 14, animation: "jg-cloud-float 3.2s ease-in-out infinite" }}>{CLOUD_BODY}</pre>
      );
  }
}

export function WeatherEstimateWidget({
  locked,
  weather,
  onInstall,
}: {
  locked: boolean;
  weather: { label: string; score: number } | null;
  onInstall: () => void;
}) {
  const kind = weather ? KIND_BY_LABEL[weather.label] ?? "cloud" : "cloud";

  return (
    <div className="relative rounded-lg">
      <div className={locked ? "blur-[4px] opacity-50" : undefined}>
        <div className="flex flex-col items-center py-1">
          <AsciiWeatherArt kind={kind} />
          <div className="mt-2 text-center text-[18px] font-semibold text-fg">
            {weather ? spanishWeatherLabel(weather.label) : "—"}
          </div>
          {weather && (
            <div className="mt-0.5 text-center text-[9.5px] text-muted">{Math.round(weather.score * 100)}% confianza</div>
          )}
        </div>
      </div>
      {locked && <LockedWidgetOverlay label="Clima estimado" onInstall={onInstall} />}
    </div>
  );
}
