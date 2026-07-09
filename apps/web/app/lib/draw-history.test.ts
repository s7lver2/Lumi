// apps/web/app/lib/draw-history.test.ts
import { describe, it, expect } from "vitest";
import { DrawHistory } from "./draw-history";

describe("DrawHistory", () => {
  it("pushes states and undoes/redoes", () => {
    const h = new DrawHistory<number>();
    h.push(1); h.push(2); h.push(3);
    expect(h.undo()).toBe(2);
    expect(h.undo()).toBe(1);
    expect(h.redo()).toBe(2);
  });
  it("drops the redo tail after a new push", () => {
    const h = new DrawHistory<number>();
    h.push(1); h.push(2); h.undo(); h.push(9);
    expect(h.redo()).toBeNull(); // 2 was discarded
  });
});