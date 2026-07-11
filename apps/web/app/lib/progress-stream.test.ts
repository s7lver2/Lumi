// apps/web/app/lib/progress-stream.test.ts
import { describe, it, expect } from "vitest";
import { parseProgressData, isTerminal } from "./progress-stream";

describe("parseProgressData", () => {
  it("parses the SSE data JSON into a JobProgress", () => {
    const json =
      '{"status":"indexing","pointsEstimated":100,"pointsCaptured":40,"pointsFailed":2,"imagesEmbedded":38}';
    expect(parseProgressData(json)).toEqual({
      status: "indexing",
      pointsEstimated: 100,
      pointsCaptured: 40,
      pointsFailed: 2,
      imagesEmbedded: 38,
    });
  });
});

describe("isTerminal", () => {
  it("treats indexed and failed as terminal", () => {
    expect(isTerminal("indexed")).toBe(true);
    expect(isTerminal("failed")).toBe(true);
    expect(isTerminal("indexing")).toBe(false);
    expect(isTerminal("pending")).toBe(false);
  });

  it("treats cancelled as terminal", () => {
    expect(isTerminal("cancelled")).toBe(true);
  });
});