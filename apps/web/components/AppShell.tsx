// apps/web/app/components/AppShell.tsx
import Link from "next/link";

const NAV = [
  { href: "/", label: "Buscar", icon: "M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16z" },
  { href: "/index", label: "Indexar", icon: "M12 2l9 4.5-9 4.5-9-4.5L12 2zM3 12l9 4.5 9-4.5M3 17l9 4.5 9-4.5" },
  { href: "/areas", label: "Áreas", icon: "M3 7l6-3 6 3 6-3v13l-6 3-6-3-6 3V7z" },
];

function RailIcon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className="h-5 w-5">
      <path d={d} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
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
        <div className="flex-1" />
        <Link href="/settings" title="Configuración" className="text-subtle hover:text-fg">
          <RailIcon d="M12 15a3 3 0 100-6 3 3 0 000 6z M19.4 15a7.97 7.97 0 000-6l1.5-2.6-2-3.4-2.9.9a8 8 0 00-5-2.9L10 0H6l-.5 2.9a8 8 0 00-5 2.9L-2.4 5l-2 3.4 1.5 2.6" />
        </Link>
      </nav>
      <main className="relative flex-1 overflow-hidden bg-surface">{children}</main>
    </div>
  );
}