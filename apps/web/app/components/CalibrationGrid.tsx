// apps/web/app/components/CalibrationGrid.tsx
"use client";
import type { SettingDefinition } from "@netryx/shared-types";

const REFERENCE_MAX: Record<string, number> = {
  VERIFICATION_MIN_INLIERS: 50,
  VERIFICATION_INLIER_SATURATION: 5000,
  VERIFICATION_ERROR_SCALE_PX: 20,
  VERIFICATION_MAGSAC_THRESHOLD_PX: 10,
};

function MiniBar({ value, referenceMax }: { value: number; referenceMax: number }) {
  const pct = Math.max(0, Math.min(1, value / referenceMax)) * 100;
  return (
    <div className="h-1 w-full rounded-full bg-white/10">
      <div className="h-1 rounded-full bg-draw" style={{ width: `${pct}%` }} />
    </div>
  );
}

export function CalibrationGrid({
  defs,
  values,
  onChange,
}: {
  defs: SettingDefinition[];
  values: Record<string, string>;
  onChange: (key: string, value: string) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-4">
      {defs.map((def) => {
        const value = values[def.key] ?? def.defaultValue ?? "0";
        const referenceMax = REFERENCE_MAX[def.key] ?? 100;
        return (
          <div key={def.key}>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-xs text-muted">{def.label}</span>
              <span className="text-xs font-medium text-fg">{value}</span>
            </div>
            <input
              type="number"
              step="any"
              value={value}
              onChange={(e) => onChange(def.key, e.target.value)}
              className="mb-1.5 w-full rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-xs text-fg outline-none focus:border-white/25"
            />
            <MiniBar value={Number(value) || 0} referenceMax={referenceMax} />
          </div>
        );
      })}
    </div>
  );
}
