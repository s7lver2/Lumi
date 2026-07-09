// apps/web/app/(protected)/gate.ts
//
// Pure setup-gate decision logic, kept out of layout.tsx on purpose: Next.js
// App Router layout modules may only export `default` plus a fixed set of
// config names (metadata, viewport, ...), so `next build`'s type check
// rejects any other export from layout.tsx.
import type { SettingsRepo } from "../../lib/settings-repo";

export type GateDecision = { type: "allow" } | { type: "redirect"; to: string };

export async function resolveGateDecision(
  repo: Pick<SettingsRepo, "isSetupCompleted">
): Promise<GateDecision> {
  const completed = await repo.isSetupCompleted();
  return completed ? { type: "allow" } : { type: "redirect", to: "/setup" };
}
