// apps/web/app/components/AppShell.tsx
"use client";
import { useState } from "react";
import Link from "next/link";
import { CatalogBrowser } from "./CatalogBrowser";

const NAV = [
  { href: "/", label: "Uso", icon: "M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16z" },
  { href: "/index", label: "Entrenamiento", icon: "M12 2l9 4.5-9 4.5-9-4.5L12 2zM3 12l9 4.5 9-4.5M3 17l9 4.5 9-4.5" },
];

function RailIcon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className="h-5 w-5">
      <path d={d} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const [catalogOpen, setCatalogOpen] = useState(false);

  return (
    <div className="flex h-screen w-screen overflow-hidden">
      <nav className="flex w-12 flex-col items-center gap-5 border-r border-border bg-[#141517] py-4">
        <span className="text-accent-fg">
          <RailIcon d="M12 2l9 4.5-9 4.5-9-4.5L12 2z" />
        </span>
        {NAV.map((n) => (
          <Link key={n.href} href={n.href} title={n.label} className="text-subtle hover:text-fg">
            <RailIcon d={n.icon} />
          </Link>
        ))}
        <button onClick={() => setCatalogOpen(true)} title="Tienda" className="text-subtle hover:text-fg">
          <RailIcon d="M6 6h12l1 4H5l1-4Z M5 10h14v9a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-9Z M9 10v3a3 3 0 0 0 6 0v-3" />
        </button>
        <div className="flex-1" />
        <Link href="/settings" title="Configuración" className="text-subtle hover:text-fg">
          <RailIcon d="M12 9a3 3 0 100 6 3 3 0 000-6z M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
        </Link>
      </nav>
      <main className="relative flex-1 overflow-hidden bg-surface">{children}</main>
      {catalogOpen && <CatalogBrowser onClose={() => setCatalogOpen(false)} />}
    </div>
  );
}
