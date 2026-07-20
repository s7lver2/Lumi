// apps/web/lib/street-view-image-dir.test.ts
import { describe, it, expect } from "vitest";
import { captureImagePath } from "./street-view-image-dir";

describe("captureImagePath", () => {
  it("builds a path for a normal panoId", () => {
    const path = captureImagePath("CAoSLEFGMVFpcE1fbG1v", 90);
    expect(path.endsWith("CAoSLEFGMVFpcE1fbG1v_90.jpg")).toBe(true);
  });

  it("rejects a panoId with path traversal sequences", () => {
    expect(() => captureImagePath("../../etc/passwd", 0)).toThrow();
  });

  it("rejects a panoId with a path separator", () => {
    expect(() => captureImagePath("foo/bar", 0)).toThrow();
  });

  it("accepts a real Google pano_id ending in a single dot", () => {
    const path = captureImagePath("CAoSFkNJSE0wb2dLRUlDQWdJQ3N6SXI5QkE.", 0);
    expect(path.endsWith("CAoSFkNJSE0wb2dLRUlDQWdJQ3N6SXI5QkE._0.jpg")).toBe(true);
  });

  it("still rejects two consecutive dots even with the single-dot allowance", () => {
    expect(() => captureImagePath("foo..bar", 0)).toThrow();
  });
});
