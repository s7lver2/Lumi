// apps/worker/src/db.ts
import { Pool } from "pg";

let pool: Pool | undefined;

export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      host: process.env.POSTGRES_HOST,
      port: Number(process.env.POSTGRES_PORT ?? 5432),
      user: process.env.POSTGRES_USER,
      password: process.env.POSTGRES_PASSWORD,
      database: process.env.POSTGRES_DB,
    });
  }
  return pool;
}