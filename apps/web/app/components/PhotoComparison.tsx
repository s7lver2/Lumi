// apps/web/app/components/PhotoComparison.tsx
"use client";

export function PhotoComparison({
  queryImageUrl,
  candidateImageUrl,
}: {
  queryImageUrl: string;
  candidateImageUrl: string;
}) {
  return (
    <div className="mt-3 flex gap-1.5">
      <div className="min-w-0 flex-1">
        <img
          src={queryImageUrl}
          alt="Tu foto"
          className="aspect-[4/3] w-full rounded-md border border-border object-cover"
        />
        <div className="mt-1 text-[10px] text-subtle">Tu foto</div>
      </div>
      <div className="min-w-0 flex-1">
        <img
          src={candidateImageUrl}
          alt="Street View"
          className="aspect-[4/3] w-full rounded-md border border-accent-fg/40 object-cover"
        />
        <div className="mt-1 text-[10px] text-accent-fg">Street View</div>
      </div>
    </div>
  );
}
