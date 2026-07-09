// apps/web/app/stores/useMapStore.test.ts
import { describe, it, expect } from "vitest";
import { useMapStore } from "./useMapStore";

describe("useMapStore", () => {
  it("defaults to search mode and switches to draw", () => {
    expect(useMapStore.getState().mode).toBe("search");
    useMapStore.getState().setMode("draw");
    expect(useMapStore.getState().mode).toBe("draw");
    useMapStore.getState().setMode("search");
  });
});