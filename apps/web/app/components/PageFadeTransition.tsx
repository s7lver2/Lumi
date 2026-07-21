// apps/web/app/components/PageFadeTransition.tsx
"use client";
import { usePathname } from "next/navigation";

export function PageFadeTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <div key={pathname} style={{ animation: "jg-page-fade-in 220ms ease-out both" }}>
      {children}
    </div>
  );
}
