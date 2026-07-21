// apps/web/app/components/widgets/WeatherEstimateWidget.tsx
"use client";
import { useEffect, useState } from "react";
import { spanishWeatherLabel } from "../../../lib/weather-label";
import { LockedWidgetOverlay } from "./LockedWidgetOverlay";

/** Ring around the icon fills from 0 to `value` on mount (CSS transition on
 * strokeDashoffset, kicked off a frame after mount so the browser paints
 * the empty ring first instead of jumping straight to the final fill). */
function ConfidenceRing({ value, size }: { value: number; size: number }) {
  const [filled, setFilled] = useState(0);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setFilled(value));
    return () => cancelAnimationFrame(frame);
  }, [value]);
  const r = size / 2 - 3;
  const c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="absolute inset-0">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#2c2d30" strokeWidth="3" />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="#5dcaa5"
        strokeWidth="3"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - filled)}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: "stroke-dashoffset 1.1s cubic-bezier(.2,.85,.35,1)" }}
      />
    </svg>
  );
}

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
          <div className="relative flex items-center justify-center" style={{ width: 96, height: 96 }}>
            {weather && <ConfidenceRing value={weather.score} size={96} />}
            <AsciiWeatherArt kind={kind} />
          </div>
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
