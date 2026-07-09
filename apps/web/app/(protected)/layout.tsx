import { redirect } from "next/navigation";
import { AppShell } from "../components/AppShell";
import { BootGate } from "../components/BootGate";
import { getSettingsRepo } from "../../lib/settings-repo";
import { resolveGateDecision } from "./gate";

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