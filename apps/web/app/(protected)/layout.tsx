import { redirect } from "next/navigation";
import { AppShell } from "../components/AppShell";
import { BootGate } from "../components/LoadingScreen";
import { getSettingsRepo } from "../../lib/settings-repo";
import { resolveGateDecision } from "./gate";

// This layout's redirect decision depends on live database state
// (isSetupCompleted()), but nothing here uses a Next.js "dynamic" API
// (cookies()/headers()/searchParams), so the App Router's static analysis
// doesn't see it as dynamic — `next build` prerenders "/" once and caches
// that response for a year (confirmed live: right after a fresh install
// with setup incomplete, the build baked in a redirect to /setup, and it
// kept serving that exact cached redirect long after setup was actually
// completed — `x-nextjs-cache: HIT` on every request). Forcing dynamic
// rendering makes every request re-run this gate for real.
export const dynamic = "force-dynamic";

export default async function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Evaluación de la compuerta de seguridad en el servidor
  const decision = await resolveGateDecision(getSettingsRepo());
  
  if (decision.type === "redirect") {
    redirect(decision.to);
  }

  return (
    <AppShell>
      <BootGate>
        {children}
      </BootGate>
    </AppShell>
  );
}