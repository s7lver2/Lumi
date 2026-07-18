// apps/web/app/components/CatalogDetailPanel.tsx
"use client";

/**
 * Shared right-side detail panel (spec: "right-side panel" won over
 * replace-the-list and inline-accordion). `stats` is a small label/value
 * grid — datasets show points/images, models show accuracy/distance/
 * sample-count, using the exact same rendering either way. `extra` is a
 * slot for anything kind-specific (models' backbone list) that doesn't
 * fit the stats grid.
 */
export function CatalogDetailPanel({
  title,
  subtitle,
  stats,
  extra,
  installLabel,
  installDisabled,
  onInstall,
  secondaryAction,
}: {
  title: string;
  subtitle: string;
  stats: { label: string; value: string }[];
  extra?: React.ReactNode;
  installLabel: string;
  installDisabled?: boolean;
  onInstall: () => void;
  secondaryAction?: { label: string; onClick: () => void; disabled?: boolean };
}) {
  return (
    <div className="flex h-full w-full flex-col overflow-y-auto p-5">
      <div className="text-[14px] font-medium text-fg">{title}</div>
      <div className="mt-1 text-[11.5px] text-muted">{subtitle}</div>
      <div className="mt-4 flex gap-6">
        {stats.map((s) => (
          <div key={s.label}>
            <div className="text-[10.5px] uppercase tracking-wide text-subtle">{s.label}</div>
            <div className="mt-0.5 text-[17px] text-fg">{s.value}</div>
          </div>
        ))}
      </div>
      {extra}
      <div className="mt-5 flex items-center gap-2.5">
        <button
          onClick={onInstall}
          disabled={installDisabled}
          className="self-start rounded-md bg-accent px-4 py-2 text-xs font-medium text-black disabled:opacity-50"
        >
          {installLabel}
        </button>
        {secondaryAction && (
          <button
            onClick={secondaryAction.onClick}
            disabled={secondaryAction.disabled}
            className="self-start rounded-md border border-white/[.15] px-4 py-2 text-xs font-medium text-fg hover:bg-white/5 disabled:opacity-50"
          >
            {secondaryAction.label}
          </button>
        )}
      </div>
    </div>
  );
}
