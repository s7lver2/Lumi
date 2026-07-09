// apps/web/app/components/ProgressMeter.tsx
const BAR = { draw: "bg-draw", accent: "bg-accent" } as const;

export function ProgressMeter({
  label,
  value,
  max,
  tone = "draw",
}: {
  label: string;
  value: number;
  max: number;
  tone?: keyof typeof BAR;
}) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div>
      <div className="mb-1.5 flex justify-between text-xs">
        <span className="text-muted">{label}</span>
        <span className="font-medium text-fg">
          {value.toLocaleString()} / {max.toLocaleString()}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-border">
        <div className={`h-full ${BAR[tone]}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}