// apps/web/app/components/Badge.tsx
const TONES = {
  accent: "bg-accent/15 text-accent-fg",
  draw: "bg-draw/15 text-draw-fg",
  warning: "bg-warning/15 text-warning-fg",
  danger: "bg-danger/20 text-danger-fg",
  muted: "bg-white/5 text-muted",
} as const;

export function Badge({
  tone = "muted",
  children,
}: {
  tone?: keyof typeof TONES;
  children: React.ReactNode;
}) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs ${TONES[tone]}`}>
      {children}
    </span>
  );
}