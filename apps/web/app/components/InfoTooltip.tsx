// apps/web/app/components/InfoTooltip.tsx
"use client";

const INFO_ICON = (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
    <circle cx="12" cy="12" r="9" /><line x1="12" y1="11" x2="12" y2="16.5" /><circle cx="12" cy="7.5" r=".6" fill="currentColor" stroke="none" />
  </svg>
);

export function InfoTooltip({ text }: { text: string }) {
  return (
    <span className="group relative inline-flex shrink-0 cursor-help text-subtle">
      {INFO_ICON}
      <span className="pointer-events-none absolute bottom-[135%] left-1/2 z-10 w-max max-w-[170px] -translate-x-1/2 rounded-lg border border-white/[.15] bg-panel px-2 py-1.5 text-[9px] leading-[1.4] text-fg opacity-0 shadow-lg shadow-black/45 transition-opacity group-hover:opacity-100">
        {text}
      </span>
    </span>
  );
}