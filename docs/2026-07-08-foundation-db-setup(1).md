# Foundation: Monorepo Scaffold, Database Schema & Setup Wizard — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the `netryx-fork` monorepo skeleton, the Postgres schema (pgvector + PostGIS, from spec §11 and §14.3), the first-run setup wizard that lets the operator configure Street View/Mapbox keys and cost/area limits from the web instead of hand-editing `.env` (spec §14), and the shared model registry that lets `/settings` offer a Lumi Preview/Laila model choice without hardcoding it (spec §15.3).

**Architecture:** pnpm workspace monorepo with `apps/web` (Next.js 14.2 App Router), `packages/shared-types` (shared TS interfaces, including `SETTINGS_SCHEMA` and a TS mirror of the model registry), and `db/` (SQL migrations via `node-pg-migrate`, chosen over Prisma because `geography`/`geometry`/`vector` column types aren't first-class in Prisma's schema language and we'd be fighting the ORM on every spatial/embedding column). Setup-completion gating is implemented as a server-component layout check (`app/(protected)/layout.tsx`) rather than literal edge `middleware.ts`, because the settings repo needs the `pg` driver, which does not run in the Edge runtime that `middleware.ts` uses by default — this achieves the same redirect behavior described in spec §14.2 without fighting the runtime. `RETRIEVAL_MODEL`/`VERIFICATION_MODEL` are added to `SETTINGS_SCHEMA` as a new `"enum"` setting type (spec §15.3), defaulting to `lumi-preview`/`laila` so setup can complete without asking the operator to pick a model up front — the choice only becomes editable on `/settings`. `apps/worker` and `services/inference` are scaffolded as empty stubs only (real job/inference logic is out of scope for this plan — separate plans); the one exception is `services/inference/models/registry.py`, which is *data only* (spec §15.3's Python source of truth) and has no runtime dependency on FastAPI or on models actually loading, so it's included here to keep the TS mirror honest from day one.

**Tech Stack:** TypeScript, Next.js 14.2 (App Router), pnpm workspaces, PostgreSQL 16 + pgvector + PostGIS, `node-pg-migrate`, `pg` (node-postgres), Vitest, `next/navigation` for redirects.

**Out of scope for this plan (separate plans, per spec §1–§13):** indexing pipeline (worker + inference service), search/refine pipeline, dashboard map UI, pg-boss job queue wiring, and the inference service actually *loading* whichever model `RETRIEVAL_MODEL`/`VERIFICATION_MODEL` points to (spec §15.4 — that's runtime behavior for the Indexing Pipeline plan; this plan only ships the registry data and the settings UI to choose from it). This plan only needs the DB reachable and the settings/setup layer working end-to-end.

---

## Prerequisites

- Node.js 20+, pnpm 9+ installed.
- A local Postgres 16 instance with `pgvector` and `postgis` extensions installable (per spec §7.1 — Windows: EDB installer + Stack Builder for PostGIS, precompiled pgvector binaries; Linux/Mac: `apt install postgresql-16-pgvector postgresql-16-postgis-3` or equivalent).
- Two databases for this plan: `netryx_dev` and `netryx_test` (tests run migrations against `netryx_test` and never touch `netryx_dev`).

---

## File Structure

```
netryx-fork/
├── package.json                          # root workspace config
├── pnpm-workspace.yaml
├── .env.example                          # infra-only vars (spec §14.1)
├── .gitignore                            # includes apps/web/data/settings.key
├── db/
│   ├── package.json
│   ├── migrations/
│   │   └── 1720400000000_init.js
│   └── test/
│       └── migrations.test.ts
├── packages/
│   └── shared-types/
│       ├── package.json
│       ├── tsconfig.json
│       └── src/
│           ├── index.ts
│           ├── settings.ts
│           ├── settings.test.ts
│           ├── models.ts
│           └── models.test.ts
├── services/
│   └── inference/
│       ├── README.md
│       └── models/
│           └── registry.py
└── apps/
    └── web/
        ├── package.json
        ├── next.config.js
        ├── tsconfig.json
        ├── vitest.config.ts
        ├── lib/
        │   ├── db.ts
        │   ├── crypto.ts
        │   ├── crypto.test.ts
        │   ├── settings-repo.ts
        │   └── settings-repo.test.ts
        └── app/
            ├── (protected)/
            │   ├── layout.tsx
            │   └── layout.test.ts
            ├── setup/
            │   ├── page.tsx
            │   ├── actions.ts
            │   └── actions.test.ts
            ├── settings/
            │   └── page.tsx
            └── api/
                └── settings/
                    └── route.ts
```

---

### Task 1: Root workspace scaffold

**Files:**
- Create: `netryx-fork/package.json`
- Create: `netryx-fork/pnpm-workspace.yaml`
- Create: `netryx-fork/.gitignore`
- Create: `netryx-fork/.env.example`

- [ ] **Step 1: Create the root `package.json`**

```json
{
  "name": "netryx-fork",
  "private": true,
  "version": "0.1.0",
  "scripts": {
    "db:migrate": "pnpm --filter @netryx/db migrate:up",
    "db:migrate:test": "pnpm --filter @netryx/db migrate:up:test",
    "test": "pnpm -r test",
    "build": "pnpm -r build"
  },
  "packageManager": "pnpm@9.7.0"
}
```

- [ ] **Step 2: Create `pnpm-workspace.yaml`**

```yaml
packages:
  - "apps/*"
  - "packages/*"
  - "db"
```

- [ ] **Step 3: Create `.gitignore`**

```
node_modules/
.next/
dist/
*.log
.env
apps/web/data/settings.key
```

- [ ] **Step 4: Create `.env.example` (infra-only, per spec §14.1)**

```bash
# Infra-level only — everything else (API keys, cost/area limits) is configured
# from the web at first run via /setup, and lives in the system_settings table.
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_USER=netryx
POSTGRES_PASSWORD=changeme
POSTGRES_DB=netryx_dev

PORT=3000
NODE_ENV=development

# Optional: if unset, apps/web generates and persists one at
# apps/web/data/settings.key on first boot (see spec §14.4).
# SETTINGS_ENCRYPTION_KEY=
```

- [ ] **Step 5: Install pnpm and verify workspace resolves**

Run: `cd netryx-fork && pnpm install`
Expected: completes with no packages yet (workspace globs match nothing), no error.

- [ ] **Step 6: Commit**

```bash
git init
git add package.json pnpm-workspace.yaml .gitignore .env.example
git commit -m "chore: scaffold pnpm workspace root"
```

---

### Task 2: Database migrations package (`db/`)

**Files:**
- Create: `db/package.json`
- Create: `db/migrations/1720400000000_init.js`
- Create: `db/test/migrations.test.ts`
- Create: `db/vitest.config.ts`
- Create: `db/tsconfig.json`

- [ ] **Step 1: Create `db/package.json`**

```json
{
  "name": "@netryx/db",
  "private": true,
  "version": "0.1.0",
  "scripts": {
    "migrate:up": "node-pg-migrate up --envPath ../.env",
    "migrate:up:test": "node-pg-migrate up -d TEST_DATABASE_URL",
    "test": "vitest run"
  },
  "devDependencies": {
    "node-pg-migrate": "^7.6.1",
    "pg": "^8.12.0",
    "vitest": "^2.0.5",
    "typescript": "^5.5.4"
  }
}
```

- [ ] **Step 2: Write the failing test (schema shape)**

```typescript
// db/test/migrations.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "pg";

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgres://netryx:changeme@localhost:5432/netryx_test";

let client: Client;

beforeAll(async () => {
  client = new Client({ connectionString: TEST_DATABASE_URL });
  await client.connect();
});

afterAll(async () => {
  await client.end();
});

async function tableExists(name: string): Promise<boolean> {
  const { rows } = await client.query(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = $1
     ) AS exists`,
    [name]
  );
  return rows[0].exists;
}

async function extensionExists(name: string): Promise<boolean> {
  const { rows } = await client.query(
    `SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = $1) AS exists`,
    [name]
  );
  return rows[0].exists;
}

describe("init migration", () => {
  it("enables vector and postgis extensions", async () => {
    expect(await extensionExists("vector")).toBe(true);
    expect(await extensionExists("postgis")).toBe(true);
  });

  it("creates all expected tables", async () => {
    const expected = [
      "areas",
      "indexed_images",
      "searches",
      "search_regions",
      "search_candidates",
      "api_usage",
      "system_settings",
    ];
    for (const table of expected) {
      expect(await tableExists(table)).toBe(true);
    }
  });

  it("enforces the unique (pano_id, heading) constraint on indexed_images", async () => {
    const { rows } = await client.query(
      `SELECT area_id FROM areas LIMIT 1` // sanity: areas table is queryable
    );
    expect(Array.isArray(rows)).toBe(true);

    await client.query(
      `INSERT INTO areas (id, geometry, area_km2)
       VALUES ('00000000-0000-0000-0000-000000000001',
               ST_GeomFromText('POLYGON((0 0,0 1,1 1,1 0,0 0))', 4326), 1.0)`
    );
    await client.query(
      `INSERT INTO indexed_images (area_id, pano_id, heading, location)
       VALUES ('00000000-0000-0000-0000-000000000001', 'pano-1', 0,
               ST_GeogFromText('POINT(0 0)'))`
    );

    await expect(
      client.query(
        `INSERT INTO indexed_images (area_id, pano_id, heading, location)
         VALUES ('00000000-0000-0000-0000-000000000001', 'pano-1', 0,
                 ST_GeogFromText('POINT(0 0)'))`
      )
    ).rejects.toThrow(/duplicate key value/);

    // cleanup for test idempotency
    await client.query(
      `DELETE FROM areas WHERE id = '00000000-0000-0000-0000-000000000001'`
    );
  });

  it("creates the system_settings table with the __setup_completed__ convention", async () => {
    await client.query(
      `INSERT INTO system_settings (key, value, is_secret)
       VALUES ('__setup_completed__', 'false', false)
       ON CONFLICT (key) DO NOTHING`
    );
    const { rows } = await client.query(
      `SELECT value FROM system_settings WHERE key = '__setup_completed__'`
    );
    expect(rows[0].value).toBe("false");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `createdb netryx_test && cd db && pnpm install && TEST_DATABASE_URL=postgres://netryx:changeme@localhost:5432/netryx_test pnpm test`
Expected: FAIL — `relation "areas" does not exist` (no migration has run yet).

- [ ] **Step 4: Write the migration**

```javascript
// db/migrations/1720400000000_init.js
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`CREATE EXTENSION IF NOT EXISTS vector;`);
  pgm.sql(`CREATE EXTENSION IF NOT EXISTS postgis;`);

  pgm.sql(`
    CREATE TABLE areas (
      id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      name                  text,
      geometry              geometry(Polygon, 4326) NOT NULL,
      area_km2              numeric NOT NULL,
      status                text NOT NULL DEFAULT 'pending',
      points_estimated      integer NOT NULL DEFAULT 0,
      points_captured       integer NOT NULL DEFAULT 0,
      images_embedded       integer NOT NULL DEFAULT 0,
      estimated_cost_usd    numeric,
      actual_cost_usd       numeric,
      created_at            timestamptz NOT NULL DEFAULT now(),
      updated_at            timestamptz NOT NULL DEFAULT now()
    );
  `);

  pgm.sql(`
    CREATE TABLE indexed_images (
      id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      area_id               uuid NOT NULL REFERENCES areas(id) ON DELETE CASCADE,
      pano_id               text NOT NULL,
      heading               smallint NOT NULL,
      location              geography(Point, 4326) NOT NULL,
      street_view_date      date,
      embedding             vector(8448),
      embedded_at           timestamptz,
      created_at            timestamptz NOT NULL DEFAULT now(),
      UNIQUE (pano_id, heading)
    );
  `);
  pgm.sql(
    `CREATE INDEX idx_indexed_images_location ON indexed_images USING GIST (location);`
  );
  pgm.sql(
    `CREATE INDEX idx_indexed_images_embedding ON indexed_images USING hnsw (embedding vector_cosine_ops);`
  );

  pgm.sql(`
    CREATE TABLE searches (
      id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      query_image_path      text NOT NULL,
      query_embedding       vector(8448),
      created_at            timestamptz NOT NULL DEFAULT now()
    );
  `);

  pgm.sql(`
    CREATE TABLE search_regions (
      id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      search_id             uuid NOT NULL REFERENCES searches(id) ON DELETE CASCADE,
      centroid              geography(Point, 4326) NOT NULL,
      radius_m              integer NOT NULL,
      aggregate_score       numeric NOT NULL,
      candidate_count       integer NOT NULL
    );
  `);

  pgm.sql(`
    CREATE TABLE search_candidates (
      id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      search_id             uuid NOT NULL REFERENCES searches(id) ON DELETE CASCADE,
      region_id             uuid REFERENCES search_regions(id) ON DELETE SET NULL,
      indexed_image_id      uuid NOT NULL REFERENCES indexed_images(id),
      similarity_score      numeric NOT NULL,
      verification_score    numeric,
      rank                  integer NOT NULL,
      status                text NOT NULL DEFAULT 'unreviewed'
    );
  `);

  pgm.sql(`
    CREATE TABLE api_usage (
      id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      date                  date NOT NULL DEFAULT current_date,
      street_view_requests  integer NOT NULL DEFAULT 0,
      estimated_cost_usd    numeric NOT NULL DEFAULT 0,
      UNIQUE (date)
    );
  `);

  pgm.sql(`
    CREATE TABLE system_settings (
      key                   text PRIMARY KEY,
      value                 text,
      encrypted_value       bytea,
      is_secret             boolean NOT NULL DEFAULT false,
      updated_at            timestamptz NOT NULL DEFAULT now()
    );
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DROP TABLE IF EXISTS system_settings;`);
  pgm.sql(`DROP TABLE IF EXISTS api_usage;`);
  pgm.sql(`DROP TABLE IF EXISTS search_candidates;`);
  pgm.sql(`DROP TABLE IF EXISTS search_regions;`);
  pgm.sql(`DROP TABLE IF EXISTS searches;`);
  pgm.sql(`DROP TABLE IF EXISTS indexed_images;`);
  pgm.sql(`DROP TABLE IF EXISTS areas;`);
};
```

- [ ] **Step 5: Run the migration against the test DB**

Run: `cd db && TEST_DATABASE_URL=postgres://netryx:changeme@localhost:5432/netryx_test pnpm migrate:up:test`
Expected: `> Migrating files: - 1720400000000_init` then `Migrations complete!`

- [ ] **Step 6: Run test to verify it passes**

Run: `cd db && TEST_DATABASE_URL=postgres://netryx:changeme@localhost:5432/netryx_test pnpm test`
Expected: PASS — 4 tests green.

- [ ] **Step 7: Commit**

```bash
git add db/
git commit -m "feat(db): initial schema migration (areas, indexed_images, search*, api_usage, system_settings)"
```

---

### Task 3: `packages/shared-types` — settings types and model registry shared between web and worker

**Files:**
- Create: `packages/shared-types/package.json`
- Create: `packages/shared-types/tsconfig.json`
- Create: `packages/shared-types/src/models.ts`
- Create: `packages/shared-types/src/settings.ts`
- Create: `packages/shared-types/src/index.ts`
- Test: `packages/shared-types/src/models.test.ts`
- Test: `packages/shared-types/src/settings.test.ts`

- [ ] **Step 1: Write the failing test for the model registry (spec §15.3)**

```typescript
// packages/shared-types/src/models.test.ts
import { describe, it, expect } from "vitest";
import { RETRIEVAL_MODELS, VERIFICATION_MODELS } from "./models";

describe("RETRIEVAL_MODELS", () => {
  it("includes lumi-preview as the default, backed by frozen MegaLoc", () => {
    const lumi = RETRIEVAL_MODELS.find((m) => m.id === "lumi-preview")!;
    expect(lumi).toBeDefined();
    expect(lumi.displayName).toBe("Lumi Preview");
    expect(lumi.baseModel).toMatch(/MegaLoc/);
    expect(lumi.status).toBe("preview");
    expect(lumi.embeddingDim).toBe(8448);
  });
});

describe("VERIFICATION_MODELS", () => {
  it("includes laila as the default, backed by frozen RoMa", () => {
    const laila = VERIFICATION_MODELS.find((m) => m.id === "laila")!;
    expect(laila).toBeDefined();
    expect(laila.displayName).toBe("Laila");
    expect(laila.baseModel).toMatch(/RoMa/);
    expect(laila.status).toBe("stable");
  });
});
```

- [ ] **Step 2: Write the failing test (settings key registry + validation, now including the model-selection settings from spec §15.3)**

```typescript
// packages/shared-types/src/settings.test.ts
import { describe, it, expect } from "vitest";
import { SETTINGS_SCHEMA, validateSettingValue } from "./settings";
import { RETRIEVAL_MODELS, VERIFICATION_MODELS } from "./models";

describe("SETTINGS_SCHEMA", () => {
  it("lists every product-level setting from spec §14.1", () => {
    const keys = SETTINGS_SCHEMA.map((s) => s.key);
    expect(keys).toEqual(
      expect.arrayContaining([
        "GOOGLE_MAPS_API_KEY",
        "MAPBOX_TOKEN",
        "MAX_AREA_KM2",
        "MAX_MONTHLY_BUDGET_USD",
        "MAX_CONCURRENT_REQUESTS",
        "STREET_VIEW_PRICE_PER_IMAGE_USD",
        "RETRIEVAL_MODEL",
        "VERIFICATION_MODEL",
      ])
    );
  });

  it("marks API keys/tokens as secret", () => {
    const key = SETTINGS_SCHEMA.find((s) => s.key === "GOOGLE_MAPS_API_KEY")!;
    const token = SETTINGS_SCHEMA.find((s) => s.key === "MAPBOX_TOKEN")!;
    expect(key.isSecret).toBe(true);
    expect(token.isSecret).toBe(true);
  });

  it("marks numeric limits as not secret", () => {
    const limit = SETTINGS_SCHEMA.find((s) => s.key === "MAX_AREA_KM2")!;
    expect(limit.isSecret).toBe(false);
    expect(limit.type).toBe("number");
  });

  it("exposes RETRIEVAL_MODEL/VERIFICATION_MODEL as enum settings with options derived from the registry (spec §15.3)", () => {
    const retrieval = SETTINGS_SCHEMA.find((s) => s.key === "RETRIEVAL_MODEL")!;
    const verification = SETTINGS_SCHEMA.find((s) => s.key === "VERIFICATION_MODEL")!;

    expect(retrieval.type).toBe("enum");
    expect(retrieval.isSecret).toBe(false);
    expect(retrieval.options).toEqual(RETRIEVAL_MODELS.map((m) => m.id));
    expect(retrieval.defaultValue).toBe("lumi-preview");

    expect(verification.type).toBe("enum");
    expect(verification.options).toEqual(VERIFICATION_MODELS.map((m) => m.id));
    expect(verification.defaultValue).toBe("laila");
  });
});

describe("validateSettingValue", () => {
  it("accepts a non-empty string for GOOGLE_MAPS_API_KEY", () => {
    expect(() =>
      validateSettingValue("GOOGLE_MAPS_API_KEY", "AIzaSyTest123")
    ).not.toThrow();
  });

  it("rejects an empty GOOGLE_MAPS_API_KEY", () => {
    expect(() => validateSettingValue("GOOGLE_MAPS_API_KEY", "")).toThrow(
      /required/i
    );
  });

  it("rejects a non-numeric MAX_AREA_KM2", () => {
    expect(() => validateSettingValue("MAX_AREA_KM2", "not-a-number")).toThrow(
      /number/i
    );
  });

  it("rejects MAX_AREA_KM2 <= 0", () => {
    expect(() => validateSettingValue("MAX_AREA_KM2", "0")).toThrow(
      /greater than 0/i
    );
  });

  it("accepts a valid MAX_AREA_KM2", () => {
    expect(() => validateSettingValue("MAX_AREA_KM2", "5")).not.toThrow();
  });

  it("allows an empty MAPBOX_TOKEN (optional per spec §5.1 fallback)", () => {
    expect(() => validateSettingValue("MAPBOX_TOKEN", "")).not.toThrow();
  });

  it("accepts a RETRIEVAL_MODEL value that is in the registry", () => {
    expect(() =>
      validateSettingValue("RETRIEVAL_MODEL", "lumi-preview")
    ).not.toThrow();
  });

  it("rejects a RETRIEVAL_MODEL value that isn't in the registry", () => {
    expect(() => validateSettingValue("RETRIEVAL_MODEL", "not-a-model")).toThrow(
      /one of/i
    );
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd packages/shared-types && pnpm install && pnpm test`
Expected: FAIL — `Cannot find module './models'` and `Cannot find module './settings'`.

- [ ] **Step 4: Implement `models.ts` (spec §15.3 — Python `services/inference/models/registry.py` is the runtime source of truth; this TS array only powers the `/settings` `<select>` without an extra network round-trip)**

```typescript
// packages/shared-types/src/models.ts

export interface RetrievalModelDefinition {
  id: string;
  displayName: string;
  baseModel: string;
  status: "preview" | "stable" | "deprecated";
  embeddingDim: number;
}

export interface VerificationModelDefinition {
  id: string;
  displayName: string;
  baseModel: string;
  status: "preview" | "stable" | "deprecated";
}

// Kept in manual sync with services/inference/models/registry.py —
// adding a future model means adding an entry here AND there, nothing else.
export const RETRIEVAL_MODELS: RetrievalModelDefinition[] = [
  {
    id: "lumi-preview",
    displayName: "Lumi Preview",
    baseModel: "MegaLoc (frozen)",
    status: "preview",
    embeddingDim: 8448,
  },
];

export const VERIFICATION_MODELS: VerificationModelDefinition[] = [
  {
    id: "laila",
    displayName: "Laila",
    baseModel: "RoMa (frozen)",
    status: "stable",
  },
];
```

- [ ] **Step 5: Implement `settings.ts` (adds the `"enum"` type and the two model-selection settings from spec §15.3)**

```typescript
// packages/shared-types/src/settings.ts
import { RETRIEVAL_MODELS, VERIFICATION_MODELS } from "./models";

export type SettingType = "string" | "number" | "enum";

export interface SettingDefinition {
  key: string;
  label: string;
  type: SettingType;
  isSecret: boolean;
  required: boolean;
  defaultValue?: string;
  /** Required when type is "enum" — the set of values validateSettingValue accepts. */
  options?: string[];
}

export const SETTINGS_SCHEMA: SettingDefinition[] = [
  {
    key: "GOOGLE_MAPS_API_KEY",
    label: "Street View Static API key",
    type: "string",
    isSecret: true,
    required: true,
  },
  {
    key: "MAPBOX_TOKEN",
    label: "Mapbox token (optional — leave empty to use MapLibre + free tiles)",
    type: "string",
    isSecret: true,
    required: false,
  },
  {
    key: "MAX_AREA_KM2",
    label: "Maximum area per indexing job (km²)",
    type: "number",
    isSecret: false,
    required: true,
    defaultValue: "5",
  },
  {
    key: "MAX_MONTHLY_BUDGET_USD",
    label: "Maximum monthly Street View spend (USD)",
    type: "number",
    isSecret: false,
    required: true,
    defaultValue: "50",
  },
  {
    key: "MAX_CONCURRENT_REQUESTS",
    label: "Maximum concurrent Street View requests",
    type: "number",
    isSecret: false,
    required: true,
    defaultValue: "10",
  },
  {
    key: "STREET_VIEW_PRICE_PER_IMAGE_USD",
    label: "Street View Static API price per image (USD)",
    type: "number",
    isSecret: false,
    required: true,
    defaultValue: "0.007",
  },
  {
    key: "RETRIEVAL_MODEL",
    label: "Retrieval model",
    type: "enum",
    isSecret: false,
    required: true,
    defaultValue: "lumi-preview",
    options: RETRIEVAL_MODELS.map((m) => m.id),
  },
  {
    key: "VERIFICATION_MODEL",
    label: "Verification model",
    type: "enum",
    isSecret: false,
    required: true,
    defaultValue: "laila",
    options: VERIFICATION_MODELS.map((m) => m.id),
  },
];

export function getSettingDefinition(key: string): SettingDefinition {
  const def = SETTINGS_SCHEMA.find((s) => s.key === key);
  if (!def) {
    throw new Error(`Unknown setting key: ${key}`);
  }
  return def;
}

export function validateSettingValue(key: string, value: string): void {
  const def = getSettingDefinition(key);

  if (def.required && value.trim() === "") {
    throw new Error(`${def.label} is required`);
  }

  if (value.trim() === "") {
    return; // optional + empty is fine, nothing further to validate
  }

  if (def.type === "number") {
    const parsed = Number(value);
    if (Number.isNaN(parsed)) {
      throw new Error(`${def.label} must be a number`);
    }
    if (parsed <= 0) {
      throw new Error(`${def.label} must be greater than 0`);
    }
  }

  if (def.type === "enum") {
    const options = def.options ?? [];
    if (!options.includes(value)) {
      throw new Error(`${def.label} must be one of: ${options.join(", ")}`);
    }
  }
}
```

- [ ] **Step 6: Create `index.ts` barrel export**

```typescript
// packages/shared-types/src/index.ts
export * from "./settings";
export * from "./models";
```

- [ ] **Step 7: Create `package.json` and `tsconfig.json`**

```json
// packages/shared-types/package.json
{
  "name": "@netryx/shared-types",
  "private": true,
  "version": "0.1.0",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "vitest": "^2.0.5",
    "typescript": "^5.5.4"
  }
}
```

```json
// packages/shared-types/tsconfig.json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "declaration": true,
    "skipLibCheck": true
  },
  "include": ["src"]
}
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `cd packages/shared-types && pnpm test`
Expected: PASS — 2 model-registry tests + 12 settings tests = 14 tests green.

- [ ] **Step 9: Commit**

```bash
git add packages/shared-types
git commit -m "feat(shared-types): settings schema, enum model settings, and model registry mirror"
```

---

### Task 4: `apps/web` scaffold + Postgres client

**Files:**
- Create: `apps/web/package.json`
- Create: `apps/web/tsconfig.json`
- Create: `apps/web/next.config.js`
- Create: `apps/web/vitest.config.ts`
- Create: `apps/web/lib/db.ts`

- [ ] **Step 1: Create `apps/web/package.json`**

```json
{
  "name": "@netryx/web",
  "private": true,
  "version": "0.1.0",
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@netryx/shared-types": "workspace:*",
    "next": "14.2.5",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "pg": "^8.12.0"
  },
  "devDependencies": {
    "@types/node": "^20.14.0",
    "@types/pg": "^8.11.6",
    "@types/react": "^18.3.3",
    "typescript": "^5.5.4",
    "vitest": "^2.0.5"
  }
}
```

- [ ] **Step 2: Create `next.config.js`**

```javascript
/** @type {import('next').NextConfig} */
module.exports = {
  reactStrictMode: true,
  transpilePackages: ["@netryx/shared-types"],
};
```

- [ ] **Step 3: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "module": "esnext",
    "moduleResolution": "bundler",
    "jsx": "preserve",
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "incremental": true,
    "plugins": [{ "name": "next" }]
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 4: Create `vitest.config.ts`**

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
  },
});
```

- [ ] **Step 5: Create `lib/db.ts` (single shared pool, infra vars from `.env` per spec §14.1)**

```typescript
// apps/web/lib/db.ts
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
```

- [ ] **Step 6: Verify install and typecheck**

Run: `cd apps/web && pnpm install && pnpm typecheck`
Expected: no errors (no `.tsx` files exist yet, so this mostly validates config resolves).

- [ ] **Step 7: Commit**

```bash
git add apps/web/package.json apps/web/tsconfig.json apps/web/next.config.js apps/web/vitest.config.ts apps/web/lib/db.ts
git commit -m "chore(web): scaffold Next.js app and shared pg pool"
```

---

### Task 5: Encryption module (spec §14.3–§14.4)

**Files:**
- Create: `apps/web/lib/crypto.ts`
- Test: `apps/web/lib/crypto.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// apps/web/lib/crypto.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadOrCreateEncryptionKey, encrypt, decrypt } from "./crypto";

let dir: string;
let keyPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "netryx-crypto-test-"));
  keyPath = join(dir, "settings.key");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("loadOrCreateEncryptionKey", () => {
  it("creates a 32-byte key file if none exists", () => {
    expect(existsSync(keyPath)).toBe(false);
    const key = loadOrCreateEncryptionKey(keyPath);
    expect(key.length).toBe(32);
    expect(existsSync(keyPath)).toBe(true);
  });

  it("reuses the existing key file on subsequent calls", () => {
    const first = loadOrCreateEncryptionKey(keyPath);
    const second = loadOrCreateEncryptionKey(keyPath);
    expect(second.equals(first)).toBe(true);
  });

  it("prefers SETTINGS_ENCRYPTION_KEY env var over the file when set", () => {
    const envKey = Buffer.alloc(32, 7).toString("base64");
    const key = loadOrCreateEncryptionKey(keyPath, envKey);
    expect(key.toString("base64")).toBe(envKey);
    expect(existsSync(keyPath)).toBe(false);
  });
});

describe("encrypt/decrypt", () => {
  it("round-trips a plaintext string", () => {
    const key = loadOrCreateEncryptionKey(keyPath);
    const ciphertext = encrypt("AIzaSyTestSecretValue", key);
    expect(ciphertext).not.toEqual(Buffer.from("AIzaSyTestSecretValue"));
    const plaintext = decrypt(ciphertext, key);
    expect(plaintext).toBe("AIzaSyTestSecretValue");
  });

  it("fails to decrypt with the wrong key", () => {
    const key = loadOrCreateEncryptionKey(keyPath);
    const wrongKeyPath = join(dir, "other.key");
    const wrongKey = loadOrCreateEncryptionKey(wrongKeyPath);
    const ciphertext = encrypt("secret", key);
    expect(() => decrypt(ciphertext, wrongKey)).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && pnpm test lib/crypto.test.ts`
Expected: FAIL — `Cannot find module './crypto'`.

- [ ] **Step 3: Implement `crypto.ts`**

```typescript
// apps/web/lib/crypto.ts
import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

/**
 * Loads the settings encryption key, in priority order:
 * 1. `envValue` (base64) — typically process.env.SETTINGS_ENCRYPTION_KEY
 * 2. The key file at `keyPath`, if it already exists
 * 3. A freshly generated 32-byte key, persisted to `keyPath`
 *
 * See spec §14.4: this key is intentionally never asked of the user directly.
 */
export function loadOrCreateEncryptionKey(
  keyPath: string,
  envValue?: string
): Buffer {
  if (envValue) {
    return Buffer.from(envValue, "base64");
  }

  if (existsSync(keyPath)) {
    return readFileSync(keyPath);
  }

  const key = randomBytes(32);
  mkdirSync(dirname(keyPath), { recursive: true });
  writeFileSync(keyPath, key, { mode: 0o600 });
  return key;
}

/**
 * Encrypts `plaintext` and returns `iv || authTag || ciphertext` as a single
 * Buffer, ready to store in `system_settings.encrypted_value` (bytea).
 */
export function encrypt(plaintext: string, key: Buffer): Buffer {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]);
}

export function decrypt(payload: Buffer, key: Buffer): string {
  const iv = payload.subarray(0, IV_LENGTH);
  const authTag = payload.subarray(IV_LENGTH, IV_LENGTH + 16);
  const ciphertext = payload.subarray(IV_LENGTH + 16);

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString("utf8");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && pnpm test lib/crypto.test.ts`
Expected: PASS — 5 tests green.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/crypto.ts apps/web/lib/crypto.test.ts
git commit -m "feat(web): AES-256-GCM settings encryption with auto-generated key file"
```

---

### Task 6: Settings repository (read/write `system_settings`, spec §14.3/§14.5)

**Files:**
- Create: `apps/web/lib/settings-repo.ts`
- Test: `apps/web/lib/settings-repo.test.ts`

- [ ] **Step 1: Write the failing test**

Uses `TEST_DATABASE_URL` against the same `netryx_test` DB migrated in Task 2, and clears `system_settings` between tests for isolation.

```typescript
// apps/web/lib/settings-repo.test.ts
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { Pool } from "pg";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSettingsRepo } from "./settings-repo";

const connectionString =
  process.env.TEST_DATABASE_URL ??
  "postgres://netryx:changeme@localhost:5432/netryx_test";
const pool = new Pool({ connectionString });

let dir: string;
let keyPath: string;

beforeEach(async () => {
  await pool.query("DELETE FROM system_settings");
  dir = mkdtempSync(join(tmpdir(), "netryx-settings-repo-test-"));
  keyPath = join(dir, "settings.key");
});

afterAll(async () => {
  await pool.end();
});

function makeRepo() {
  return createSettingsRepo({ pool, encryptionKeyPath: keyPath, cacheTtlMs: 0 });
}

describe("settings repo", () => {
  it("starts with setup not completed", async () => {
    const repo = makeRepo();
    expect(await repo.isSetupCompleted()).toBe(false);
  });

  it("stores and retrieves a non-secret value in plaintext", async () => {
    const repo = makeRepo();
    await repo.setSetting("MAX_AREA_KM2", "5", false);
    expect(await repo.getSetting("MAX_AREA_KM2")).toBe("5");

    const { rows } = await pool.query(
      "SELECT value, encrypted_value FROM system_settings WHERE key = 'MAX_AREA_KM2'"
    );
    expect(rows[0].value).toBe("5");
    expect(rows[0].encrypted_value).toBeNull();
  });

  it("stores a secret value encrypted, never in the plaintext column", async () => {
    const repo = makeRepo();
    await repo.setSetting("GOOGLE_MAPS_API_KEY", "AIzaSyTest", true);

    const { rows } = await pool.query(
      "SELECT value, encrypted_value FROM system_settings WHERE key = 'GOOGLE_MAPS_API_KEY'"
    );
    expect(rows[0].value).toBeNull();
    expect(rows[0].encrypted_value).not.toBeNull();

    expect(await repo.getSetting("GOOGLE_MAPS_API_KEY")).toBe("AIzaSyTest");
  });

  it("completeSetup writes all values in a single transaction and flips the flag", async () => {
    const repo = makeRepo();
    await repo.completeSetup([
      { key: "GOOGLE_MAPS_API_KEY", value: "AIzaSyTest", isSecret: true },
      { key: "MAX_AREA_KM2", value: "5", isSecret: false },
    ]);

    expect(await repo.isSetupCompleted()).toBe(true);
    expect(await repo.getSetting("GOOGLE_MAPS_API_KEY")).toBe("AIzaSyTest");
    expect(await repo.getSetting("MAX_AREA_KM2")).toBe("5");
  });

  it("caches getSetting for cacheTtlMs and invalidates on write", async () => {
    const repo = createSettingsRepo({
      pool,
      encryptionKeyPath: keyPath,
      cacheTtlMs: 60_000,
    });
    await repo.setSetting("MAX_CONCURRENT_REQUESTS", "10", false);
    expect(await repo.getSetting("MAX_CONCURRENT_REQUESTS")).toBe("10");

    // mutate the DB directly, bypassing the repo, to prove the cache is serving stale data
    await pool.query(
      "UPDATE system_settings SET value = '999' WHERE key = 'MAX_CONCURRENT_REQUESTS'"
    );
    expect(await repo.getSetting("MAX_CONCURRENT_REQUESTS")).toBe("10");

    // writing through the repo must invalidate the cache
    await repo.setSetting("MAX_CONCURRENT_REQUESTS", "20", false);
    expect(await repo.getSetting("MAX_CONCURRENT_REQUESTS")).toBe("20");
  });

  it("returns null for a setting that was never set", async () => {
    const repo = makeRepo();
    expect(await repo.getSetting("MAPBOX_TOKEN")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && TEST_DATABASE_URL=postgres://netryx:changeme@localhost:5432/netryx_test pnpm test lib/settings-repo.test.ts`
Expected: FAIL — `Cannot find module './settings-repo'`.

- [ ] **Step 3: Implement `settings-repo.ts`**

```typescript
// apps/web/lib/settings-repo.ts
import type { Pool } from "pg";
import { loadOrCreateEncryptionKey, encrypt, decrypt } from "./crypto";

const SETUP_COMPLETED_KEY = "__setup_completed__";

export interface SettingWrite {
  key: string;
  value: string;
  isSecret: boolean;
}

export interface SettingsRepoOptions {
  pool: Pool;
  encryptionKeyPath: string;
  /** 0 disables caching — useful in tests. Defaults to 30s per spec §14.5. */
  cacheTtlMs?: number;
}

interface CacheEntry {
  value: string | null;
  expiresAt: number;
}

export function createSettingsRepo(options: SettingsRepoOptions) {
  const { pool, encryptionKeyPath } = options;
  const cacheTtlMs = options.cacheTtlMs ?? 30_000;
  const cache = new Map<string, CacheEntry>();

  function getKey(): Buffer {
    return loadOrCreateEncryptionKey(
      encryptionKeyPath,
      process.env.SETTINGS_ENCRYPTION_KEY
    );
  }

  function invalidate(key: string) {
    cache.delete(key);
  }

  async function getSetting(key: string): Promise<string | null> {
    const cached = cache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }

    const { rows } = await pool.query(
      "SELECT value, encrypted_value FROM system_settings WHERE key = $1",
      [key]
    );

    let value: string | null = null;
    if (rows.length > 0) {
      const row = rows[0];
      value = row.encrypted_value
        ? decrypt(row.encrypted_value, getKey())
        : row.value;
    }

    cache.set(key, { value, expiresAt: Date.now() + cacheTtlMs });
    return value;
  }

  async function setSetting(
    key: string,
    value: string,
    isSecret: boolean
  ): Promise<void> {
    if (isSecret) {
      const encrypted = encrypt(value, getKey());
      await pool.query(
        `INSERT INTO system_settings (key, value, encrypted_value, is_secret, updated_at)
         VALUES ($1, NULL, $2, true, now())
         ON CONFLICT (key) DO UPDATE
           SET value = NULL, encrypted_value = $2, is_secret = true, updated_at = now()`,
        [key, encrypted]
      );
    } else {
      await pool.query(
        `INSERT INTO system_settings (key, value, encrypted_value, is_secret, updated_at)
         VALUES ($1, $2, NULL, false, now())
         ON CONFLICT (key) DO UPDATE
           SET value = $2, encrypted_value = NULL, is_secret = false, updated_at = now()`,
        [key, value]
      );
    }
    invalidate(key);
  }

  async function isSetupCompleted(): Promise<boolean> {
    const value = await getSetting(SETUP_COMPLETED_KEY);
    return value === "true";
  }

  async function completeSetup(writes: SettingWrite[]): Promise<void> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      for (const { key, value, isSecret } of writes) {
        if (isSecret) {
          const encrypted = encrypt(value, getKey());
          await client.query(
            `INSERT INTO system_settings (key, value, encrypted_value, is_secret, updated_at)
             VALUES ($1, NULL, $2, true, now())
             ON CONFLICT (key) DO UPDATE
               SET value = NULL, encrypted_value = $2, is_secret = true, updated_at = now()`,
            [key, encrypted]
          );
        } else {
          await client.query(
            `INSERT INTO system_settings (key, value, encrypted_value, is_secret, updated_at)
             VALUES ($1, $2, NULL, false, now())
             ON CONFLICT (key) DO UPDATE
               SET value = $2, encrypted_value = NULL, is_secret = false, updated_at = now()`,
            [key, value]
          );
        }
      }
      await client.query(
        `INSERT INTO system_settings (key, value, is_secret, updated_at)
         VALUES ($1, 'true', false, now())
         ON CONFLICT (key) DO UPDATE SET value = 'true', updated_at = now()`,
        [SETUP_COMPLETED_KEY]
      );
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
      for (const { key } of writes) invalidate(key);
      invalidate(SETUP_COMPLETED_KEY);
    }
  }

  return { getSetting, setSetting, isSetupCompleted, completeSetup };
}

export type SettingsRepo = ReturnType<typeof createSettingsRepo>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && TEST_DATABASE_URL=postgres://netryx:changeme@localhost:5432/netryx_test pnpm test lib/settings-repo.test.ts`
Expected: PASS — 6 tests green.

- [ ] **Step 5: Add a singleton accessor for use in app routes**

```typescript
// apps/web/lib/settings-repo.ts  (append to the end of the file)
import { join } from "node:path";
import { getPool } from "./db";

let singleton: SettingsRepo | undefined;

export function getSettingsRepo(): SettingsRepo {
  if (!singleton) {
    singleton = createSettingsRepo({
      pool: getPool(),
      encryptionKeyPath: join(process.cwd(), "data", "settings.key"),
    });
  }
  return singleton;
}
```

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/settings-repo.ts apps/web/lib/settings-repo.test.ts
git commit -m "feat(web): settings repo with encryption, caching, and transactional setup completion"
```

---

### Task 7: Setup-completion gate (`app/(protected)/layout.tsx`)

**Files:**
- Create: `apps/web/app/(protected)/layout.tsx`
- Test: `apps/web/app/(protected)/layout.test.ts`

- [ ] **Step 1: Write the failing test**

We test the redirect *decision* as a plain function, independent of Next.js's request lifecycle, then wire it into the layout. This keeps the logic unit-testable without mocking `next/navigation` internals.

```typescript
// apps/web/app/(protected)/layout.test.ts
import { describe, it, expect, vi } from "vitest";
import { resolveGateDecision } from "./layout";

describe("resolveGateDecision", () => {
  it("redirects to /setup when setup is not completed", async () => {
    const repo = { isSetupCompleted: vi.fn().mockResolvedValue(false) };
    const decision = await resolveGateDecision(repo as any);
    expect(decision).toEqual({ type: "redirect", to: "/setup" });
  });

  it("allows the request through when setup is completed", async () => {
    const repo = { isSetupCompleted: vi.fn().mockResolvedValue(true) };
    const decision = await resolveGateDecision(repo as any);
    expect(decision).toEqual({ type: "allow" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && pnpm test app/\(protected\)/layout.test.ts`
Expected: FAIL — `Cannot find module './layout'` (or no export `resolveGateDecision`).

- [ ] **Step 3: Implement `layout.tsx`**

```typescript
// apps/web/app/(protected)/layout.tsx
import { redirect } from "next/navigation";
import { getSettingsRepo, type SettingsRepo } from "../../lib/settings-repo";

export type GateDecision = { type: "allow" } | { type: "redirect"; to: string };

export async function resolveGateDecision(
  repo: Pick<SettingsRepo, "isSetupCompleted">
): Promise<GateDecision> {
  const completed = await repo.isSetupCompleted();
  return completed ? { type: "allow" } : { type: "redirect", to: "/setup" };
}

export default async function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const decision = await resolveGateDecision(getSettingsRepo());
  if (decision.type === "redirect") {
    redirect(decision.to);
  }
  return <>{children}</>;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && pnpm test app/\(protected\)/layout.test.ts`
Expected: PASS — 2 tests green.

- [ ] **Step 5: Commit**

```bash
git add "apps/web/app/(protected)/layout.tsx" "apps/web/app/(protected)/layout.test.ts"
git commit -m "feat(web): gate protected routes behind setup completion (spec §14.2)"
```

---

### Task 8: `/api/settings` route (GET current values, PATCH to update)

**Files:**
- Create: `apps/web/app/api/settings/route.ts`
- Test: `apps/web/app/api/settings/route.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// apps/web/app/api/settings/route.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET, PATCH } from "./route";

vi.mock("../../../lib/settings-repo", () => {
  const store = new Map<string, string>();
  return {
    getSettingsRepo: () => ({
      getSetting: vi.fn(async (key: string) => store.get(key) ?? null),
      setSetting: vi.fn(async (key: string, value: string) => {
        store.set(key, value);
      }),
      isSetupCompleted: vi.fn(async () => store.get("__setup_completed__") === "true"),
      completeSetup: vi.fn(),
    }),
    __store: store,
  };
});

beforeEach(async () => {
  const mod: any = await import("../../../lib/settings-repo");
  mod.__store.clear();
});

function makeRequest(body?: unknown) {
  return new Request("http://localhost/api/settings", {
    method: body ? "PATCH" : "GET",
    body: body ? JSON.stringify(body) : undefined,
    headers: { "content-type": "application/json" },
  });
}

describe("GET /api/settings", () => {
  it("returns non-secret values and masks secret ones", async () => {
    const mod: any = await import("../../../lib/settings-repo");
    mod.__store.set("MAX_AREA_KM2", "5");
    mod.__store.set("GOOGLE_MAPS_API_KEY", "AIzaSyRealSecret");

    const res = await GET();
    const json = await res.json();

    expect(json.MAX_AREA_KM2).toBe("5");
    expect(json.GOOGLE_MAPS_API_KEY).toBe("••••••••");
  });

  it("omits secret keys entirely when they are unset", async () => {
    const res = await GET();
    const json = await res.json();
    expect(json.GOOGLE_MAPS_API_KEY).toBeUndefined();
  });
});

describe("PATCH /api/settings", () => {
  it("rejects an invalid value with 400", async () => {
    const res = await PATCH(makeRequest({ MAX_AREA_KM2: "not-a-number" }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/number/i);
  });

  it("persists a valid non-secret value and returns 200", async () => {
    const res = await PATCH(makeRequest({ MAX_AREA_KM2: "8" }));
    expect(res.status).toBe(200);

    const getRes = await GET();
    const json = await getRes.json();
    expect(json.MAX_AREA_KM2).toBe("8");
  });

  it("rejects an unknown setting key with 400", async () => {
    const res = await PATCH(makeRequest({ NOT_A_REAL_SETTING: "x" }));
    expect(res.status).toBe(400);
  });

  it("persists a valid RETRIEVAL_MODEL value (enum setting, spec §15.3)", async () => {
    const res = await PATCH(makeRequest({ RETRIEVAL_MODEL: "lumi-preview" }));
    expect(res.status).toBe(200);

    const getRes = await GET();
    const json = await getRes.json();
    expect(json.RETRIEVAL_MODEL).toBe("lumi-preview");
  });

  it("rejects a RETRIEVAL_MODEL value not in the registry with 400", async () => {
    const res = await PATCH(makeRequest({ RETRIEVAL_MODEL: "some-future-model" }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/one of/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && pnpm test app/api/settings/route.test.ts`
Expected: FAIL — `Cannot find module './route'`.

- [ ] **Step 3: Implement `route.ts`**

```typescript
// apps/web/app/api/settings/route.ts
import { NextResponse } from "next/server";
import {
  SETTINGS_SCHEMA,
  validateSettingValue,
  getSettingDefinition,
} from "@netryx/shared-types";
import { getSettingsRepo } from "../../../lib/settings-repo";

const MASK = "••••••••";

export async function GET() {
  const repo = getSettingsRepo();
  const result: Record<string, string> = {};

  for (const def of SETTINGS_SCHEMA) {
    const value = await repo.getSetting(def.key);
    if (value === null) continue;
    result[def.key] = def.isSecret ? MASK : value;
  }

  return NextResponse.json(result);
}

export async function PATCH(request: Request) {
  const body = (await request.json()) as Record<string, string>;
  const repo = getSettingsRepo();

  for (const [key, value] of Object.entries(body)) {
    let def;
    try {
      def = getSettingDefinition(key);
    } catch {
      return NextResponse.json(
        { error: `Unknown setting key: ${key}` },
        { status: 400 }
      );
    }

    try {
      validateSettingValue(key, value);
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : String(err) },
        { status: 400 }
      );
    }
  }

  for (const [key, value] of Object.entries(body)) {
    const def = getSettingDefinition(key);
    await repo.setSetting(key, value, def.isSecret);
  }

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && pnpm test app/api/settings/route.test.ts`
Expected: PASS — 7 tests green.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/api/settings
git commit -m "feat(web): /api/settings GET (masked) and PATCH (validated) endpoints"
```

---

### Task 9: `/setup` wizard page + server action (spec §14.2)

**Files:**
- Create: `apps/web/app/setup/actions.ts`
- Test: `apps/web/app/setup/actions.test.ts`
- Create: `apps/web/app/setup/page.tsx`

- [ ] **Step 1: Write the failing test for the server action**

```typescript
// apps/web/app/setup/actions.test.ts
import { describe, it, expect, vi } from "vitest";
import { submitSetup } from "./actions";

function makeFormData(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

describe("submitSetup", () => {
  it("returns a field error and does not call completeSetup on invalid input", async () => {
    const repo = { completeSetup: vi.fn() };
    const result = await submitSetup(
      repo as any,
      makeFormData({
        GOOGLE_MAPS_API_KEY: "",
        MAPBOX_TOKEN: "",
        MAX_AREA_KM2: "5",
        MAX_MONTHLY_BUDGET_USD: "50",
        MAX_CONCURRENT_REQUESTS: "10",
        STREET_VIEW_PRICE_PER_IMAGE_USD: "0.007",
      })
    );
    expect(result.ok).toBe(false);
    expect(result.ok || result.error).toMatch(/required/i);
    expect(repo.completeSetup).not.toHaveBeenCalled();
  });

  it("calls completeSetup with all fields, marking API key/token as secret, and fills RETRIEVAL_MODEL/VERIFICATION_MODEL from their defaults since the wizard doesn't render those fields (spec §14.2 vs §15.3)", async () => {
    const repo = { completeSetup: vi.fn() };
    const result = await submitSetup(
      repo as any,
      makeFormData({
        GOOGLE_MAPS_API_KEY: "AIzaSyTest",
        MAPBOX_TOKEN: "",
        MAX_AREA_KM2: "5",
        MAX_MONTHLY_BUDGET_USD: "50",
        MAX_CONCURRENT_REQUESTS: "10",
        STREET_VIEW_PRICE_PER_IMAGE_USD: "0.007",
        // note: no RETRIEVAL_MODEL / VERIFICATION_MODEL field — not part of
        // the wizard's four steps (spec §14.2); they must still get written.
      })
    );

    expect(result.ok).toBe(true);
    expect(repo.completeSetup).toHaveBeenCalledWith([
      { key: "GOOGLE_MAPS_API_KEY", value: "AIzaSyTest", isSecret: true },
      { key: "MAPBOX_TOKEN", value: "", isSecret: true },
      { key: "MAX_AREA_KM2", value: "5", isSecret: false },
      { key: "MAX_MONTHLY_BUDGET_USD", value: "50", isSecret: false },
      { key: "MAX_CONCURRENT_REQUESTS", value: "10", isSecret: false },
      { key: "STREET_VIEW_PRICE_PER_IMAGE_USD", value: "0.007", isSecret: false },
      { key: "RETRIEVAL_MODEL", value: "lumi-preview", isSecret: false },
      { key: "VERIFICATION_MODEL", value: "laila", isSecret: false },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && pnpm test app/setup/actions.test.ts`
Expected: FAIL — `Cannot find module './actions'`.

- [ ] **Step 3: Implement `actions.ts`**

```typescript
// apps/web/app/setup/actions.ts
"use server";

import { SETTINGS_SCHEMA, validateSettingValue } from "@netryx/shared-types";
import { getSettingsRepo, type SettingsRepo } from "../../lib/settings-repo";

export type SubmitSetupResult = { ok: true } | { ok: false; error: string };

/**
 * Resolves the value to write for a setting from the submitted form.
 *
 * If the field is present in the form (even as an empty string, e.g. an
 * optional field like MAPBOX_TOKEN left blank), that submitted value wins.
 * If the field is absent entirely — true for RETRIEVAL_MODEL/VERIFICATION_MODEL,
 * which the wizard doesn't render per spec §14.2's four steps — fall back to
 * the setting's defaultValue so setup can still complete (spec §15.3's
 * "lumi-preview"/"laila" defaults).
 */
function resolveValue(formData: FormData, def: (typeof SETTINGS_SCHEMA)[number]): string {
  const raw = formData.get(def.key);
  if (raw !== null) return String(raw);
  return def.defaultValue ?? "";
}

export async function submitSetup(
  repo: Pick<SettingsRepo, "completeSetup">,
  formData: FormData
): Promise<SubmitSetupResult> {
  const writes = SETTINGS_SCHEMA.map((def) => ({
    key: def.key,
    value: resolveValue(formData, def),
    isSecret: def.isSecret,
  }));

  for (const def of SETTINGS_SCHEMA) {
    try {
      validateSettingValue(def.key, resolveValue(formData, def));
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  await repo.completeSetup(writes);
  return { ok: true };
}

export async function submitSetupAction(formData: FormData) {
  return submitSetup(getSettingsRepo(), formData);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && pnpm test app/setup/actions.test.ts`
Expected: PASS — 2 tests green (the second one also confirms `RETRIEVAL_MODEL`/`VERIFICATION_MODEL` are written from their defaults even with no matching form field).

- [ ] **Step 5: Implement the wizard page (single form, one step per §14.2's four groups — `RETRIEVAL_MODEL`/`VERIFICATION_MODEL` are intentionally NOT a step here, per spec §14.2; they're covered by `resolveValue`'s default fallback above and only become user-editable on `/settings`, Task 10)**

```tsx
// apps/web/app/setup/page.tsx
import { SETTINGS_SCHEMA } from "@netryx/shared-types";
import { submitSetupAction } from "./actions";

export default function SetupPage() {
  const streetView = SETTINGS_SCHEMA.filter((s) => s.key === "GOOGLE_MAPS_API_KEY");
  const mapbox = SETTINGS_SCHEMA.filter((s) => s.key === "MAPBOX_TOKEN");
  const limits = SETTINGS_SCHEMA.filter(
    (s) => s.key !== "GOOGLE_MAPS_API_KEY" && s.key !== "MAPBOX_TOKEN"
  );

  return (
    <main>
      <h1>Configuración inicial</h1>
      <form action={submitSetupAction}>
        <fieldset>
          <legend>1. Street View</legend>
          {streetView.map((def) => (
            <label key={def.key}>
              {def.label}
              <input name={def.key} type="text" required={def.required} />
            </label>
          ))}
        </fieldset>

        <fieldset>
          <legend>2. Mapa (opcional)</legend>
          {mapbox.map((def) => (
            <label key={def.key}>
              {def.label}
              <input name={def.key} type="text" required={def.required} />
            </label>
          ))}
        </fieldset>

        <fieldset>
          <legend>3. Límites</legend>
          {limits.map((def) => (
            <label key={def.key}>
              {def.label}
              <input
                name={def.key}
                type="number"
                step="any"
                defaultValue={def.defaultValue}
                required={def.required}
              />
            </label>
          ))}
        </fieldset>

        <button type="submit">Finalizar setup</button>
      </form>
    </main>
  );
}
```

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/setup
git commit -m "feat(web): /setup wizard page and server action (spec §14.2)"
```

---

### Task 10: `/settings` page (post-setup editing, reuses the same schema and API)

**Files:**
- Create: `apps/web/app/settings/page.tsx`

- [ ] **Step 1: Implement the settings page**

No new business logic here — this page is a thin client over the already-tested `/api/settings` GET/PATCH (Task 8), so it's covered by those tests plus manual verification in Step 2.

```tsx
// apps/web/app/settings/page.tsx
"use client";

import { useEffect, useState } from "react";
import { SETTINGS_SCHEMA } from "@netryx/shared-types";

export default function SettingsPage() {
  const [values, setValues] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then(setValues);
  }, []);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setStatus(null);
    const form = new FormData(e.currentTarget);
    const body: Record<string, string> = {};
    for (const def of SETTINGS_SCHEMA) {
      const raw = form.get(def.key);
      if (raw !== null && raw !== "" && raw !== "••••••••") {
        body[def.key] = String(raw);
      }
    }

    const res = await fetch("/api/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

    if (res.ok) {
      setStatus("Guardado");
    } else {
      const json = await res.json();
      setStatus(`Error: ${json.error}`);
    }
  }

  return (
    <main>
      <h1>Configuración</h1>
      <form onSubmit={handleSubmit}>
        {SETTINGS_SCHEMA.map((def) =>
          def.type === "enum" ? (
            <label key={def.key}>
              {def.label}
              <select name={def.key} defaultValue={values[def.key] ?? def.defaultValue}>
                {(def.options ?? []).map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <label key={def.key}>
              {def.label}
              <input
                name={def.key}
                type={def.type === "number" ? "number" : "text"}
                defaultValue={values[def.key] ?? ""}
              />
            </label>
          )
        )}
        <button type="submit">Guardar</button>
      </form>
      {status && <p>{status}</p>}
      {/* Changing RETRIEVAL_MODEL/VERIFICATION_MODEL here does not take effect
          until the inference service restarts (spec §15.4) — the Indexing
          Pipeline plan is responsible for surfacing that warning in this UI
          once the inference service actually exists. */}
    </main>
  );
}
```

- [ ] **Step 2: Manual verification**

Run: `cd apps/web && pnpm dev`, visit `http://localhost:3000/settings` after completing `/setup` once.
Expected: form loads with masked secret fields (`••••••••`) and real values for numeric limits; editing a limit and submitting shows "Guardado".

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/settings/page.tsx
git commit -m "feat(web): /settings page for post-setup editing"
```

---

### Task 11: Worker and inference service stubs (placeholders for future plans), plus the Python model registry

**Files:**
- Create: `apps/worker/package.json`
- Create: `apps/worker/src/index.ts`
- Create: `services/inference/README.md`
- Create: `services/inference/models/registry.py`

- [ ] **Step 1: Create a minimal worker stub**

```json
// apps/worker/package.json
{
  "name": "@netryx/worker",
  "private": true,
  "version": "0.1.0",
  "scripts": {
    "start": "node --loader ts-node/esm src/index.ts"
  },
  "dependencies": {
    "@netryx/shared-types": "workspace:*"
  },
  "devDependencies": {
    "ts-node": "^10.9.2",
    "typescript": "^5.5.4"
  }
}
```

```typescript
// apps/worker/src/index.ts
// Placeholder — indexing job consumer (pg-boss) is implemented in the
// "Indexing Pipeline" plan (spec §6, §9.1, §12). Intentionally empty here.
console.log("netryx worker stub — no jobs wired up yet");
```

- [ ] **Step 2: Create the Python model registry (spec §15.3 — data only, no FastAPI dependency, so it belongs here even though the service itself is a future plan)**

```python
# services/inference/models/registry.py
#
# Source of truth for which retrieval/verification models the product offers.
# packages/shared-types/src/models.ts mirrors this manually — see the comment
# there. Adding a future model means adding an entry here AND in the TS file.
#
# NOTE: this file has no import on FastAPI/torch/MegaLoc/RoMa. It is pure data
# so it can exist before the inference service itself is implemented (spec
# §15.4 — the service that actually loads these models is a separate,
# deferred plan).

RETRIEVAL_MODELS = [
    {
        "id": "lumi-preview",
        "display_name": "Lumi Preview",
        "base_model": "MegaLoc (frozen)",
        "status": "preview",
        "embedding_dim": 8448,
    },
    # future retrieval models are added here, without touching the rest of the code
]

VERIFICATION_MODELS = [
    {
        "id": "laila",
        "display_name": "Laila",
        "base_model": "RoMa (frozen)",
        "status": "stable",
    },
    # future verification models are added here
]
```

- [ ] **Step 3: Create a placeholder README for the inference service, pointing at the registry**

```markdown
<!-- services/inference/README.md -->
# Inference service (stub)

FastAPI service loading MegaLoc + RoMa in memory, per spec §3 and §6.2.
Implemented in the "Indexing & Search Pipeline" plan — not part of the
Foundation plan.

`models/registry.py` (this directory) already exists as of the Foundation
plan: it's the Python source of truth for which models are offered as
"Lumi Preview" (retrieval) / "Laila" (verification) in `/settings`, per spec
§15.3. When this service is implemented, it reads `RETRIEVAL_MODEL`/
`VERIFICATION_MODEL` from `system_settings` once at startup (spec §14.5) and
loads the matching entry from this registry — it does not re-read
`system_settings` per request.
```

- [ ] **Step 4: Verify the workspace still installs cleanly with the new package**

Run: `cd netryx-fork && pnpm install`
Expected: `@netryx/worker` resolves as a workspace package, no errors.

- [ ] **Step 5: Sanity-check the Python registry parses (no test runner needed for a data-only stub — this just guards against a syntax typo)**

Run: `python3 -c "import ast; ast.parse(open('services/inference/models/registry.py').read())"`
Expected: exits with no output/error.

- [ ] **Step 6: Commit**

```bash
git add apps/worker services/inference
git commit -m "chore: scaffold worker/inference stubs; add Python model registry (spec §15.3)"
```

---

## Self-Review

**1. Spec coverage:**
- §11 schema (areas, indexed_images, searches, search_regions, search_candidates, api_usage) → Task 2. ✔
- §14.1 (which vars stay in `.env` vs move to DB) → `.env.example` in Task 1 + `SETTINGS_SCHEMA` in Task 3. ✔
- §14.2 (setup wizard flow, redirect gate) → Tasks 7 and 9. ✔
- §14.3 (`system_settings` table, encrypted secrets) → Task 2 (schema) + Task 6 (repo). ✔
- §14.4 (auto-generated encryption key, file-based) → Task 5. ✔
- §14.5 (worker reads settings from DB with short-TTL cache, not env) → Task 6's `cacheTtlMs` default of 30s; worker consumption itself is deferred to the indexing pipeline plan since there's no job logic yet to consume it (noted in Task 11). ✔
- §7.2 repo structure (`apps/web`, `apps/worker`, `services/inference`, `packages/shared-types`) → Tasks 1, 4, 11. ✔
- §15.3 (Lumi Preview/Laila model registry, `RETRIEVAL_MODEL`/`VERIFICATION_MODEL` as a new `"enum"` `SETTINGS_SCHEMA` type, TS registry mirroring the Python one) → Task 3 (`models.ts`, enum settings) + Task 11 (`registry.py`). ✔
- §15.3/§14.2 interaction (model settings live in `system_settings` but are *not* one of the wizard's four steps) → Task 9's `resolveValue` default fallback, so `/setup` completes without asking for a model choice, and Task 10's `/settings` `<select>` is where it actually becomes editable. ✔
- §15.4 (model change requires restarting the inference service, not hot-reloadable) → explicitly NOT implemented here; noted as a UI warning to add once the inference service exists (Task 10 code comment), tracked under "Deferred to later plans" below. ✔ (by omission, correctly scoped out)

**2. Placeholder scan:** No "TBD"/"handle errors appropriately" left in any step; every step shows real code or a real command with expected output.

**3. Type consistency:** `SettingsRepo` (Task 6) is the single source of truth for the repo's shape and is imported by name (not redefined) in Tasks 7, 8, and 9. `SETTINGS_SCHEMA`/`SettingDefinition` (Task 3) is imported, not duplicated, everywhere it's used (Tasks 8, 9, 10).

---

## Deferred to later plans (do not implement here)

- **Indexing Pipeline plan:** Overpass sampling, Street View download, pg-boss job queue, MegaLoc embedding service, worker's actual consumption of `MAX_AREA_KM2`/`MAX_MONTHLY_BUDGET_USD`/`MAX_CONCURRENT_REQUESTS` from this repo (spec §6, §9.1, §12).
- **Search & Refine Pipeline plan:** `/api/search`, `/api/search/:id/refine`, clustering, geometric verification (spec §9.2, §9.3, §9.4).
- **Dashboard & Map UI plan:** `MapCanvas`, `ResultsPanel`, `ConfidenceCircleLayer`, `IndexingDrawTool`, `JobProgressBar`, Zustand stores (spec §5, §8, §13).
- **Cost tracking plan:** `api_usage` writes, estimated-vs-actual cost reconciliation (spec §12.1–§12.3).
- **Indexing & Search Pipeline plan (models):** the actual FastAPI inference service reading `RETRIEVAL_MODEL`/`VERIFICATION_MODEL` from `system_settings` once at startup and loading the corresponding entry from `services/inference/models/registry.py` (spec §14.5, §15.4); Lumi Preview's multi-heading aggregation/TTA/re-ranking and Laila's tiled matching/MAGSAC++/calibrated score (spec §15.1, §15.2); the "restart required to apply" warning surfaced in `/settings` once that service exists (spec §15.4). This plan only ships the registry data and the settings UI to pick a model id — it never loads a model.

---

**Next step:** pick one of the four deferred plans above and I'll write it in the same task-by-task format once this Foundation plan is merged (each depends on `system_settings`/`areas`/`indexed_images` existing, which this plan provides).
