// apps/web/app/lib/run-log.ts
export type RunEvent = { type: "log"; line: string } | { type: "done"; code: number };
export function parseRunEvent(data: string): RunEvent { return JSON.parse(data) as RunEvent; }