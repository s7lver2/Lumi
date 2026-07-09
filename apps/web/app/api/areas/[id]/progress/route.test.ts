// apps/web/app/api/areas/[id]/progress/route.test.ts
import { describe, it, expect } from "vitest";
import { formatProgressEvent, isTerminalStatus } from "./route";

describe("formatProgressEvent", () => {
  it("formats an areas row as an SSE data event", () => {
    const event = formatProgressEvent({
      status: "indexing",
      points_estimated: 100,
      points_captured: 40,
      points_failed: 2,
      images_embedded: 38,
    });
    expect(event).toBe(
      'data: {"status":"indexing","pointsEstimated":100,"pointsCaptured":40,"pointsFailed":2,"imagesEmbedded":38}\n\n'
    );
  });
});

describe("isTerminalStatus", () => {
  it("treats indexed and failed as terminal", () => {
    expect(isTerminalStatus("indexed")).toBe(true);
    expect(isTerminalStatus("failed")).toBe(true);
  });

  it("treats pending and indexing as non-terminal", () => {
    expect(isTerminalStatus("pending")).toBe(false);
    expect(isTerminalStatus("indexing")).toBe(false);
  });
});