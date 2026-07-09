// apps/web/app/components/FloatingCard.tsx
export function FloatingCard({
  className = "",
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  // Translucent + blur is intentional (design preference): panels read as glass
  // over the map, matching the Raven references — never fully opaque.
  return (
    <div
      className={`rounded-card border border-white/10 bg-panel/80 backdrop-blur-md shadow-lg shadow-black/40 ${className}`}
    >
      {children}
    </div>
  );
}