"use client";
import { InfoTooltip } from "../InfoTooltip";

// TODO: sin modelo real todavía; conectar cuando exista un modelo de
// estimación de hora por sombras. Hasta entonces este widget siempre
// llega bloqueado (locked=true) desde su punto de registro en Task 23.

const SUN_ICON = (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
    <path d="M12 3v2M5 5l1.4 1.4M3 12h2M19 12h2M17.6 6.4L19 5M12 19v2" /><circle cx="12" cy="12" r="4" />
  </svg>
);
const LOCK_ICON = (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ animation: "jg-lock-breathe 2.6s ease-in-out infinite" }}>
    <rect x="5" y="11" width="14" height="9" rx="1.5" /><path d="M8 11V7a4 4 0 0 1 8 0v4" />
  </svg>
);

/** Position along the semicircle (0h/24h at the edges, 12h at the apex) and a
 * sun color that warms from yellow (noon) to red/orange (edges). */
function markerFor(hour: number): { x: number; y: number; color: string; isNight: boolean } {
  const cx = 88, cy = 92, r = 80;
  const x = 8 + (hour / 24) * 160;
  const dx = x - cx;
  const y = cy - Math.sqrt(Math.max(r * r - dx * dx, 0));
  const distFromNoon = Math.abs(hour - 12) / 12; // 0 at noon, 1 at the edges
  const color = distFromNoon < 0.5
    ? "#f2c94c"
    : distFromNoon < 0.8 ? "#e8863c" : "#d9432e";
  return { x, y, color, isNight: hour < 5 || hour > 19 };
}

function SunGlyph({ cx, cy, color }: { cx: number; cy: number; color: string }) {
  const angles = [0, 45, 90, 135, 180, 225, 270, 315];
  return (
    <g>
      <circle cx={cx} cy={cy} r={9} fill={color} opacity={0.15} />
      <g fill={color}>
        {angles.map((a) => (
          <rect key={a} x={cx - 0.9} y={cy - 10.2} width={1.8} height={3.2} rx={0.9} transform={`rotate(${a} ${cx} ${cy})`} />
        ))}
      </g>
      <circle cx={cx} cy={cy} r={5} fill={color} />
    </g>
  );
}

function MoonGlyph({ cx, cy }: { cx: number; cy: number }) {
  return (
    <g>
      <circle cx={cx} cy={cy} r={9} fill="#e8e8e6" opacity={0.1} />
      <circle cx={cx} cy={cy} r={6.5} fill="#e8e8e6" />
      <circle cx={cx + 3} cy={cy - 3} r={5.6} fill="#0e0f11" />
    </g>
  );
}

export function EstimatedTimeWidget({
  locked, estimatedHour, onInstall,
}: {
  locked: boolean;
  estimatedHour: number | null;
  onInstall: () => void;
}) {
  const hour = estimatedHour ?? 16.4;
  const marker = markerFor(hour);
  const label = `${String(Math.floor(hour)).padStart(2, "0")}:${String(Math.round((hour % 1) * 60)).padStart(2, "0")}`;

  return (
    <div className="relative overflow-hidden rounded-lg">
      <div className={locked ? "blur-[4px] opacity-50" : undefined}>
        <div className="mb-2 flex items-center gap-1.5">
          {SUN_ICON}
          <span className="flex-1 text-[10.5px] font-medium text-fg">Hora estimada</span>
          <InfoTooltip text="Estimado a partir del largo y dirección de las sombras visibles en la foto" />
        </div>
        <svg
          width="160" height="90" viewBox="0 0 176 100" style={{ display: "block", margin: "0 auto" }}
        >
          <g style={{ transformOrigin: "88px 92px", animation: locked ? undefined : "jg-plane-spin 1.3s cubic-bezier(.2,.85,.35,1) both" }}>
            <path d="M8 92 A80 80 0 0 1 168 92" fill="none" stroke="rgba(255,255,255,.15)" strokeWidth={1.8} />
            {marker.isNight ? <MoonGlyph cx={marker.x} cy={marker.y} /> : <SunGlyph cx={marker.x} cy={marker.y} color={marker.color} />}
          </g>
        </svg>
        <div className="mt-0.5 text-center text-[20px] font-semibold text-fg">{label}</div>
      </div>
      {locked && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[#0e0f11]/35">
          <div className="flex h-[26px] w-[26px] items-center justify-center rounded-full border border-white/35">
            {LOCK_ICON}
          </div>
          <button
            onClick={onInstall}
            className="rounded-lg bg-accent px-2.5 py-1.5 text-[9.5px] font-medium text-black transition-transform hover:scale-105 active:scale-90"
          >
            Instalar Hora estimada
          </button>
        </div>
      )}
    </div>
  );
}