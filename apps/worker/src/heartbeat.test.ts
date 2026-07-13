import { describe, it, expect, vi, beforeEach, afterAll, afterEach } from "vitest";
import { Pool } from "pg";
import { touchHeartbeat, startHeartbeatLoop } from "./heartbeat";

const connectionString =
  process.env.TEST_DATABASE_URL ?? "postgres://netryx:changeme@localhost:5432/netryx_test";
const pool = new Pool({ connectionString });

beforeEach(async () => {
  await pool.query("UPDATE worker_heartbeat SET updated_at = now() - interval '1 hour' WHERE id = 1");
});

afterEach(() => {
  vi.useRealTimers();
});

afterAll(async () => {
  await pool.end();
});

describe("touchHeartbeat", () => {
  it("updates the singleton row's updated_at to now", async () => {
    const before = Date.now();
    await touchHeartbeat(pool);
    const { rows } = await pool.query("SELECT updated_at FROM worker_heartbeat WHERE id = 1");
    expect(new Date(rows[0].updated_at).getTime()).toBeGreaterThanOrEqual(before);
  });
});

describe("startHeartbeatLoop", () => {
  it("touches the heartbeat immediately, then again every intervalMs", async () => {
    vi.useFakeTimers();
    const touches: number[] = [];
    const fakePool = { query: vi.fn(async () => { touches.push(Date.now()); return { rows: [] }; }) } as unknown as Pool;

    const handle = startHeartbeatLoop(fakePool, 5000);
    await vi.advanceTimersByTimeAsync(0);
    expect(touches.length).toBe(1);

    await vi.advanceTimersByTimeAsync(5000);
    expect(touches.length).toBe(2);

    await vi.advanceTimersByTimeAsync(10000);
    expect(touches.length).toBe(4);

    clearInterval(handle);
  });
});
