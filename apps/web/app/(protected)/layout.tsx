// apps/web/app/(protected)/layout.tsx
import { redirect } from "next/navigation";
import { AppShell } from "../components/AppShell";
import { getSettingsRepo } from "../../lib/settings-repo";
import { resolveGateDecision } from "./gate";

export default async function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const decision = await resolveGateDecision(getSettingsRepo());
  if (decision.type === "redirect") {
    redirect(decision.to);
  }
  return <AppShell>{children}</AppShell>;
}