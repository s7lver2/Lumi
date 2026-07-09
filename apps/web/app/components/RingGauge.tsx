// apps/web/app/components/RingGauge.tsx
const TONE = { accent: "#5dcaa5", warning: "#efb968", muted: "#6a6c70" } as const;

export function RingGauge({
  value,
  size = 20,
  tone = "accent",
}: {
  value: number; // 0..1
  size?: number;
  tone?: keyof typeof TONE;
}) {
  const r = size / 2 - 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(1, value));
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0" role="img" aria-label={`${Math.round(pct * 100)}%`}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#2c2d30" strokeWidth="2" />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={TONE[tone]}
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - pct)}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
    </svg>
  );
}