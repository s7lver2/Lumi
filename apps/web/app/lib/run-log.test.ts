// apps/web/app/lib/run-log.test.ts
import { describe, it, expect } from "vitest";
import { parseRunEvent } from "./run-log";
it("parses log and done events from SSE data", () => {
  expect(parseRunEvent('{"type":"log","line":"Collecting torch"}')).toEqual({ type: "log", line: "Collecting torch" });
  expect(parseRunEvent('{"type":"done","code":0}')).toEqual({ type: "done", code: 0 });
});