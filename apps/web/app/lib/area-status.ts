// apps/web/app/lib/area-status.ts
import type { AreaStatus } from "@netryx/shared-types";

export function statusTone(status: AreaStatus): "accent" | "draw" | "warning" | "danger" {
  switch (status) {
    case "indexed":
      return "accent";
    case "indexing":
      return "draw";
    case "failed":
      return "danger";
    default:
      return "warning"; // pending
  }
}