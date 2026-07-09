// apps/web/app/lib/area-status.test.ts
import { describe, it, expect } from "vitest";
import { statusTone } from "./area-status";

describe("statusTone", () => {
  it("maps each area status to a badge tone", () => {
    expect(statusTone("indexed")).toBe("accent");
    expect(statusTone("indexing")).toBe("draw");
    expect(statusTone("pending")).toBe("warning");
    expect(statusTone("failed")).toBe("danger");
  });
});