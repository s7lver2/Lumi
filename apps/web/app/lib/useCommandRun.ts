// apps/web/app/lib/useCommandRun.ts
"use client";
import { useCallback, useState } from "react";
import { parseRunEvent } from "./run-log";

export function useCommandRun() {
  const [lines, setLines] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const [code, setCode] = useState<number | null>(null);

  const run = useCallback(async (step: string, rerun = false) => {
    setLines([]); setRunning(true); setDone(false); setCode(null);
    const res = await fetch(`/api/setup/run/${step}${rerun ? "?rerun=1" : ""}`, { method: "POST" });
    if (!res.ok || !res.body) {
      setLines((l) => [...l, `error: HTTP ${res.status}`]); setRunning(false); setDone(true); setCode(1);
      return;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { value, done: streamDone } = await reader.read();
      if (streamDone) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split("\n\n");
      buffer = parts.pop() ?? "";
      for (const part of parts) {
        const data = part.replace(/^data: /, "");
        const ev = parseRunEvent(data);
        if (!ev) continue;
        if (ev.type === "log") setLines((l) => [...l, ev.line]);
        else { setDone(true); setCode(ev.code); setRunning(false); }
      }
    }
    setRunning(false);
  }, []);

  return { lines, running, done, code, run };
}