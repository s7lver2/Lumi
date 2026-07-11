// apps/web/app/components/SliderRow.tsx
"use client";
import type { SettingDefinition } from "@netryx/shared-types";

export function SliderRow({
  def,
  value,
  onChange,
}: {
  def: SettingDefinition;
  value: string;
  onChange: (value: string) => void;
}) {
  const min = def.min ?? 1;
  const max = def.max ?? 10;
  const step = def.step ?? 1;
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-xs text-muted">{def.label}</span>
        <span className="text-xs font-medium text-fg">{value}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full accent-accent"
      />
      <div className="mt-1 flex justify-between text-[11px] text-subtle">
        <span>{min}</span>
        <span>{max}</span>
      </div>
    </div>
  );
}
