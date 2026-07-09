// apps/web/app/(protected)/layout.tsx
import { redirect } from "next/navigation";
import { AppShell } from "../components/AppShell";
import { getSettingsRepo, type SettingsRepo } from "../../lib/settings-repo";

export type GateDecision = { type: "allow" } | { type: "redirect"; to: string };

export async function resolveGateDecision(
  repo: Pick<SettingsRepo, "isSetupCompleted">
): Promise<GateDecision> {
  const completed = await repo.isSetupCompleted();
  return completed ? { type: "allow" } : { type: "redirect", to: "/setup" };
}

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