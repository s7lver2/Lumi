# Upload Redesign, Image Library & Modular Widgets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the ad-hoc upload flow with a polished, tabbed drop-zone (Imágenes/Enlace/Recientes), a real in-memory multi-image library with server-side validated uploads (file and URL), opt-in post-hoc cropping, batch search via the existing pg-boss worker, and a modular "bento" widget system for the results panel with a unified model-loading notification.

**Architecture:** New pure/testable modules (`image-validation.ts`, `image-library.ts`, `fetch-image-url.ts`, `exif-read.ts`) sit under `apps/web/lib/`, backing new API routes under `apps/web/app/api/library/*` and `apps/web/app/api/search/batch`. A new Postgres table (`search_batches`) tracks batch-search progress, following the exact `areas` progress-column pattern. The worker gains one new job (`analyze-image-batch`) mirroring `embed-pending-images`'s dependency-injected, chunked structure. Frontend components are rebuilt to match the approved mockups (`.superpowers/brainstorm/16651-1784320173/content/*.html`), reusing existing design tokens exclusively (no new colors beyond `fg`/`muted`/`subtle`/`accent`/`border`/`warning`/`danger`).

**Tech Stack:** Next.js 14 App Router, TypeScript, Tailwind, `pg-boss` (already a dependency), `sharp` (new dependency), `react-easy-crop` (already a dependency), Vitest (`node` environment only — no component-render tests).

## Global Constraints

- No new accent/status colors beyond the existing Tailwind tokens (`fg` `#e8e8e6`, `muted` `#9a9a95`, `subtle` `#6a6c70`, `accent` `#f2f3f5`/`text-black`, `border` `#26282c`, `panel` `#1a1b1e`, `warning` `#ef9f27`/`efb968`, `danger` `#a33`/`#e88f8f`). The `draw` token (`#378add`) is explicitly excluded from every new element in this feature.
- All UI copy is Spanish, matching the existing tone.
- In-memory image library: **10 MB max per image**, **30 images max** held at once, oldest (`addedAt`) evicted first (LRU-by-insertion). These are exact values, not placeholders.
- SSRF protection for URL import is a hard requirement: reject non-`http(s)` schemes, resolve the hostname via DNS before connecting, reject private/loopback/link-local ranges (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `127.0.0.0/8`, `169.254.0.0/16`, `::1`, `fc00::/7`, `fe80::/10`), 8s total timeout, 10 MB download cap enforced by counting real bytes (not trusting `Content-Length`).
- Every new endpoint that accepts image bytes (file upload or URL import) MUST decode-validate with `sharp` before accepting — never trust client-supplied `file.type`/`Content-Type`.
- `EstimatedTimeWidget.tsx`, `WeatherEstimateWidget.tsx`, `DetectedObjectsWidget.tsx` ship with a `// TODO: sin modelo real todavía — conectar cuando exista un modelo de <X>.` comment. This is intentional scaffolding per spec §6.4 — a task reviewer must NOT flag these as incomplete for lacking a real model.
- `ModelLoadingNotice.tsx` is deleted; every call site migrates to `ModelLoadNotification.tsx`. No task may leave both in place.
- Crop is opt-in and post-hoc only — an image reaches the library and the selected-images popup fully unmodified; "Recortar" is a button on that popup's per-image row, never a gate before either point.
- No DOM/component-render tests are added anywhere (`apps/web/vitest.config.ts` uses `environment: "node"`) — only plain-function/module tests, matching every existing `apps/web/lib/**/*.test.ts` file.
- Non-goals: no real "identify vehicle"/"detect AI image" model or inference logic (UI placeholders only); no changes to `services/inference`, `download_weights.py`, or `packages/shared-types/src/model-bundles.ts`; no auth/multi-user scoping for the image library.

---

### Task 1: `image-validation.ts` — real server-side image decoding

**Files:**
- Create: `apps/web/lib/image-validation.ts`
- Create: `apps/web/lib/image-validation.test.ts`
- Modify: `apps/web/package.json` (add `sharp` dependency)

**Interfaces:**
- Produces: `validateImageBytes(bytes: Buffer): Promise<ImageValidationResult>` where `ImageValidationResult = { ok: true; width: number; height: number; format: "jpeg" | "png" | "webp" | "gif" | "avif" } | { ok: false; reason: string }`. Every later task that accepts uploaded/downloaded bytes (Tasks 5, 7) calls this before accepting them.

- [x] **Step 1: Add the `sharp` dependency** — DONE (commit f0629e9)

```bash
cd apps/web && pnpm add sharp
```

- [x] **Step 2-6: TDD implementation, test, commit** — DONE (commit f0629e9, review clean, 4/4 tests verified passing)

---

### Task 2: `image-library.ts` — in-memory shared image library

**Files:**
- Create: `apps/web/lib/image-library.ts`
- Create: `apps/web/lib/image-library.test.ts`

**Interfaces:**
- Consumes: nothing (pure module-level state).
- Produces: `LibraryImage = { id: string; filename: string; bytes: Buffer; mimeType: string; sizeBytes: number; width: number; height: number; addedAt: number; sourceKind: "upload" | "url" }`; `addImage(input: { bytes: Buffer; filename: string; mimeType: string; width: number; height: number; sourceKind: "upload" | "url" }): LibraryImage`; `getImage(id: string): LibraryImage | undefined`; `listImages(): LibraryImage[]` (newest first); `removeImage(id: string): void`; `replaceImageBytes(id: string, bytes: Buffer, width: number, height: number): LibraryImage | undefined`; `MAX_IMAGE_BYTES = 10 * 1024 * 1024`; `MAX_LIBRARY_SIZE = 30`; `resetLibraryForTests(): void` (test-only escape hatch, since the store is module-level singleton state).

- [ ] **Step 1: Write the failing test**

```typescript
// apps/web/lib/image-library.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import {
  addImage,
  getImage,
  listImages,
  removeImage,
  replaceImageBytes,
  MAX_IMAGE_BYTES,
  MAX_LIBRARY_SIZE,
  resetLibraryForTests,
} from "./image-library";

function fakeInput(overrides: Partial<Parameters<typeof addImage>[0]> = {}) {
  return {
    bytes: Buffer.from("fake-bytes"),
    filename: "photo.jpg",
    mimeType: "image/jpeg",
    width: 100,
    height: 80,
    sourceKind: "upload" as const,
    ...overrides,
  };
}

describe("image-library", () => {
  beforeEach(() => resetLibraryForTests());

  it("adds an image and retrieves it by id", () => {
    const added = addImage(fakeInput());
    expect(added.id).toBeTruthy();
    expect(getImage(added.id)).toEqual(added);
  });

  it("rejects images larger than MAX_IMAGE_BYTES", () => {
    const tooBig = Buffer.alloc(MAX_IMAGE_BYTES + 1);
    expect(() => addImage(fakeInput({ bytes: tooBig }))).toThrow(/10 ?MB|tamaño/i);
  });

  it("lists images newest-first", () => {
    const first = addImage(fakeInput({ filename: "a.jpg" }));
    const second = addImage(fakeInput({ filename: "b.jpg" }));
    expect(listImages().map((i) => i.id)).toEqual([second.id, first.id]);
  });

  it("evicts the oldest image once MAX_LIBRARY_SIZE is exceeded", () => {
    const first = addImage(fakeInput({ filename: "first.jpg" }));
    for (let i = 1; i < MAX_LIBRARY_SIZE; i++) {
      addImage(fakeInput({ filename: `filler-${i}.jpg` }));
    }
    expect(listImages()).toHaveLength(MAX_LIBRARY_SIZE);

    addImage(fakeInput({ filename: "overflow.jpg" }));

    expect(listImages()).toHaveLength(MAX_LIBRARY_SIZE);
    expect(getImage(first.id)).toBeUndefined();
  });

  it("removes an image by id", () => {
    const added = addImage(fakeInput());
    removeImage(added.id);
    expect(getImage(added.id)).toBeUndefined();
  });

  it("replaces an image's bytes in place (used by crop) without changing its id or position", () => {
    const added = addImage(fakeInput());
    const newBytes = Buffer.from("cropped-bytes");

    const updated = replaceImageBytes(added.id, newBytes, 50, 50);

    expect(updated?.id).toBe(added.id);
    expect(updated?.bytes).toEqual(newBytes);
    expect(updated?.width).toBe(50);
    expect(getImage(added.id)?.bytes).toEqual(newBytes);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run lib/image-library.test.ts`
Expected: FAIL with "Cannot find module './image-library'"

- [ ] **Step 3: Write the implementation**

```typescript
// apps/web/lib/image-library.ts
import { randomUUID } from "node:crypto";

export interface LibraryImage {
  id: string;
  filename: string;
  bytes: Buffer;
  mimeType: string;
  sizeBytes: number;
  width: number;
  height: number;
  addedAt: number;
  sourceKind: "upload" | "url";
}

/** Per-image cap — closes the door on decompression-bomb-style inputs
 * reaching the in-memory library at all (spec §2.1). */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/** Library-wide cap. Worst-case memory: MAX_IMAGE_BYTES * MAX_LIBRARY_SIZE
 * = 300MB, acceptable for a single-process, single-user, self-hosted app. */
export const MAX_LIBRARY_SIZE = 30;

// Module-level singleton: the library lives only in this Node process's
// memory and is intentionally wiped on every restart (spec's explicit
// requirement — no disk/DB persistence for this store).
let library = new Map<string, LibraryImage>();

export function addImage(input: {
  bytes: Buffer;
  filename: string;
  mimeType: string;
  width: number;
  height: number;
  sourceKind: "upload" | "url";
}): LibraryImage {
  if (input.bytes.length > MAX_IMAGE_BYTES) {
    throw new Error(`La imagen supera el tamaño máximo permitido (10MB)`);
  }

  const image: LibraryImage = {
    id: randomUUID(),
    filename: input.filename,
    bytes: input.bytes,
    mimeType: input.mimeType,
    sizeBytes: input.bytes.length,
    width: input.width,
    height: input.height,
    addedAt: Date.now(),
    sourceKind: input.sourceKind,
  };

  library.set(image.id, image);

  if (library.size > MAX_LIBRARY_SIZE) {
    const oldest = [...library.values()].sort((a, b) => a.addedAt - b.addedAt)[0];
    library.delete(oldest.id);
  }

  return image;
}

export function getImage(id: string): LibraryImage | undefined {
  return library.get(id);
}

export function listImages(): LibraryImage[] {
  return [...library.values()].sort((a, b) => b.addedAt - a.addedAt);
}

export function removeImage(id: string): void {
  library.delete(id);
}

/** Used by the crop-save flow (Task 6) — keeps the same id/filename/addedAt
 * so the image doesn't appear to "move" or duplicate in the library grid. */
export function replaceImageBytes(
  id: string,
  bytes: Buffer,
  width: number,
  height: number
): LibraryImage | undefined {
  const existing = library.get(id);
  if (!existing) return undefined;

  const updated: LibraryImage = { ...existing, bytes, width, height, sizeBytes: bytes.length };
  library.set(id, updated);
  return updated;
}

/** Test-only — resets the module-level singleton between test cases. */
export function resetLibraryForTests(): void {
  library = new Map<string, LibraryImage>();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run lib/image-library.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/image-library.ts apps/web/lib/image-library.test.ts
git commit -m "feat(web): add in-memory shared image library with size/count caps"
```

---

### Task 3: `fetch-image-url.ts` — SSRF-safe URL image import

**Files:**
- Create: `apps/web/lib/fetch-image-url.ts`
- Create: `apps/web/lib/fetch-image-url.test.ts`

**Interfaces:**
- Consumes: nothing directly (Task 7's route calls this, then `validateImageBytes` from Task 1).
- Produces: `fetchImageUrl(url: string): Promise<FetchImageUrlResult>` where `FetchImageUrlResult = { ok: true; bytes: Buffer } | { ok: false; reason: string }`.

- [ ] **Step 1: Write the failing test**

```typescript
// apps/web/lib/fetch-image-url.test.ts
import { describe, it, expect, vi, afterEach } from "vitest";
import * as dns from "node:dns/promises";
import { fetchImageUrl } from "./fetch-image-url";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("fetchImageUrl", () => {
  it("rejects non-http(s) schemes without making any network call", async () => {
    const result = await fetchImageUrl("file:///etc/passwd");

    expect(result).toEqual({ ok: false, reason: "Solo se permiten enlaces http o https" });
  });

  it("rejects a hostname that resolves to a private IP", async () => {
    vi.spyOn(dns, "lookup").mockResolvedValue({ address: "10.0.0.5", family: 4 } as never);

    const result = await fetchImageUrl("http://internal.example/photo.jpg");

    expect(result).toEqual({ ok: false, reason: "El enlace apunta a una dirección no permitida" });
  });

  it("rejects a hostname that resolves to the cloud metadata IP", async () => {
    vi.spyOn(dns, "lookup").mockResolvedValue({ address: "169.254.169.254", family: 4 } as never);

    const result = await fetchImageUrl("http://metadata.example/photo.jpg");

    expect(result.ok).toBe(false);
  });

  it("downloads bytes for a public IP and stops at the size cap", async () => {
    vi.spyOn(dns, "lookup").mockResolvedValue({ address: "93.184.216.34", family: 4 } as never);

    const chunk = new Uint8Array(1024).fill(1);
    const totalChunks = 11 * 1024; // 11MB worth of 1KB chunks, exceeds the 10MB cap
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        body: {
          getReader: () => {
            let sent = 0;
            return {
              read: async () => {
                if (sent >= totalChunks) return { done: true, value: undefined };
                sent++;
                return { done: false, value: chunk };
              },
            };
          },
        },
      } as unknown as Response))
    );

    const result = await fetchImageUrl("http://example.com/photo.jpg");

    expect(result.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run lib/fetch-image-url.test.ts`
Expected: FAIL with "Cannot find module './fetch-image-url'"

- [ ] **Step 3: Write the implementation**

```typescript
// apps/web/lib/fetch-image-url.ts
import * as dns from "node:dns/promises";

const MAX_DOWNLOAD_BYTES = 10 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 8000;

export type FetchImageUrlResult = { ok: true; bytes: Buffer } | { ok: false; reason: string };

function isPrivateOrReservedIp(address: string): boolean {
  // IPv4 ranges
  if (/^10\./.test(address)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(address)) return true;
  if (/^192\.168\./.test(address)) return true;
  if (/^127\./.test(address)) return true;
  if (/^169\.254\./.test(address)) return true;
  // IPv6 ranges
  if (address === "::1") return true;
  if (/^f[cd][0-9a-f]{2}:/i.test(address)) return true; // fc00::/7
  if (/^fe[89ab][0-9a-f]:/i.test(address)) return true; // fe80::/10
  return false;
}

/**
 * Downloads an image from a user-supplied URL with SSRF protections:
 * http(s)-only, DNS-resolved before connecting (rejecting private/
 * reserved ranges — including the 169.254.169.254 cloud metadata
 * address), a hard timeout, and a real byte-counted download cap (never
 * trusts Content-Length, which can lie). Callers MUST still run the
 * result through validateImageBytes (image-validation.ts) — a URL can
 * serve non-image bytes with a spoofed Content-Type.
 */
export async function fetchImageUrl(url: string): Promise<FetchImageUrlResult> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, reason: "Enlace no válido" };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, reason: "Solo se permiten enlaces http o https" };
  }

  try {
    const { address } = await dns.lookup(parsed.hostname);
    if (isPrivateOrReservedIp(address)) {
      return { ok: false, reason: "El enlace apunta a una dirección no permitida" };
    }
  } catch {
    return { ok: false, reason: "No se pudo resolver el dominio del enlace" };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(parsed.toString(), { signal: controller.signal });
    if (!res.ok || !res.body) {
      return { ok: false, reason: "No se pudo descargar el enlace" };
    }

    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        total += value.length;
        if (total > MAX_DOWNLOAD_BYTES) {
          return { ok: false, reason: "La imagen supera el tamaño máximo permitido (10MB)" };
        }
        chunks.push(value);
      }
    }

    return { ok: true, bytes: Buffer.concat(chunks.map((c) => Buffer.from(c))) };
  } catch {
    return { ok: false, reason: "No se pudo descargar el enlace a tiempo" };
  } finally {
    clearTimeout(timeout);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run lib/fetch-image-url.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/fetch-image-url.ts apps/web/lib/fetch-image-url.test.ts
git commit -m "feat(web): add SSRF-protected image URL fetcher"
```

---

### Task 4: Rewire `estimate/route.ts` and `query-image-store.ts` to trust real validation

**Files:**
- Modify: `apps/web/app/api/models/[modelId]/estimate/route.ts`
- Modify: `apps/web/lib/query-image-store.ts`
- Test: `apps/web/lib/query-image-store.test.ts` (existing — extend)

**Interfaces:**
- Consumes: `validateImageBytes` from Task 1.
- Produces: `saveQueryImage(searchId: string, bytes: Buffer, ext: string): Promise<string>` (signature unchanged, callers now pass a real detected `ext`, not one derived from client `file.type`).

- [ ] **Step 1: Read the current test file to preserve existing coverage**

Run: `cat apps/web/lib/query-image-store.test.ts`

(No code change needed for this step — just confirm the existing tests still pass unmodified, since `saveQueryImage`'s signature does not change, only its caller does.)

- [ ] **Step 2: Modify `estimate/route.ts` to validate before extracting the extension**

Replace the current `extFromType` function and the block that derives `imageExt`:

```typescript
// apps/web/app/api/models/[modelId]/estimate/route.ts
// Remove: function extFromType(type: string): string { ... }
// Remove the import list stays the same, add one import:
import { validateImageBytes } from "../../../../../lib/image-validation";
```

Replace this block:
```typescript
  const bytes = Buffer.from(await file.arrayBuffer());
  const imageBase64 = bytes.toString("base64");
  const imageExt = extFromType(file.type);
```

with:
```typescript
  const bytes = Buffer.from(await file.arrayBuffer());

  const validation = await validateImageBytes(bytes);
  if (!validation.ok) {
    return NextResponse.json({ error: validation.reason }, { status: 400 });
  }

  const imageBase64 = bytes.toString("base64");
  const imageExt = validation.format === "jpeg" ? "jpg" : validation.format;
```

- [ ] **Step 3: Run the existing estimate route test to confirm no regression**

Run: `cd apps/web && npx vitest run app/api/models`
Expected: PASS (existing tests for this route continue to pass; if a test fed a fake/non-image `file.type`, it now must supply real image bytes — check for that before running, and if found, fix that test's fixture to use real image bytes via `sharp` the same way Task 1's tests do)

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/api/models/\[modelId\]/estimate/route.ts
git commit -m "fix(web): validate uploaded image bytes with sharp instead of trusting client MIME type"
```

---

### Task 5: Library API — add & list (`POST` / `GET /api/library`)

**Files:**
- Create: `apps/web/app/api/library/route.ts`
- Create: `apps/web/app/api/library/route.test.ts`

**Interfaces:**
- Consumes: `addImage`, `listImages`, `resetLibraryForTests` from Task 2; `validateImageBytes` from Task 1.
- Produces: `GET /api/library` → `200 { images: LibraryImageSummary[] }` where `LibraryImageSummary = { id, filename, sizeBytes, width, height, addedAt, sourceKind }` (no `bytes` field — never serialize raw bytes into a list response). `POST /api/library` (multipart, field `image`) → `201 { image: LibraryImageSummary }` or `400 { error: string }`.

- [ ] **Step 1: Write the failing test**

```typescript
// apps/web/app/api/library/route.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import sharp from "sharp";
import { GET, POST } from "./route";
import { resetLibraryForTests } from "../../../lib/image-library";

beforeEach(() => resetLibraryForTests());

describe("POST /api/library", () => {
  it("adds a valid image and returns its summary", async () => {
    const png = await sharp({
      create: { width: 4, height: 4, channels: 3, background: { r: 1, g: 2, b: 3 } },
    }).png().toBuffer();
    const form = new FormData();
    form.append("image", new File([png], "test.png", { type: "image/png" }));

    const res = await POST(new Request("http://x/api/library", { method: "POST", body: form }));
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.image.filename).toBe("test.png");
    expect(body.image.width).toBe(4);
    expect(body.image.bytes).toBeUndefined();
  });

  it("rejects a request whose bytes are not a real image", async () => {
    const form = new FormData();
    form.append("image", new File([Buffer.from("not an image")], "fake.png", { type: "image/png" }));

    const res = await POST(new Request("http://x/api/library", { method: "POST", body: form }));

    expect(res.status).toBe(400);
  });

  it("rejects a request with no image field", async () => {
    const res = await POST(new Request("http://x/api/library", { method: "POST", body: new FormData() }));

    expect(res.status).toBe(400);
  });
});

describe("GET /api/library", () => {
  it("lists previously added images newest-first", async () => {
    const png = await sharp({
      create: { width: 2, height: 2, channels: 3, background: { r: 0, g: 0, b: 0 } },
    }).png().toBuffer();
    const form1 = new FormData();
    form1.append("image", new File([png], "a.png", { type: "image/png" }));
    await POST(new Request("http://x/api/library", { method: "POST", body: form1 }));

    const form2 = new FormData();
    form2.append("image", new File([png], "b.png", { type: "image/png" }));
    await POST(new Request("http://x/api/library", { method: "POST", body: form2 }));

    const res = await GET();
    const body = await res.json();

    expect(body.images.map((i: { filename: string }) => i.filename)).toEqual(["b.png", "a.png"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run app/api/library/route.test.ts`
Expected: FAIL with "Cannot find module './route'"

- [ ] **Step 3: Write the implementation**

```typescript
// apps/web/app/api/library/route.ts
import { NextResponse } from "next/server";
import { addImage, listImages, type LibraryImage } from "../../../lib/image-library";
import { validateImageBytes } from "../../../lib/image-validation";

function toSummary(image: LibraryImage) {
  const { bytes, ...summary } = image;
  return summary;
}

export async function GET() {
  return NextResponse.json({ images: listImages().map(toSummary) });
}

export async function POST(request: Request) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "La petición debe ser multipart/form-data" }, { status: 400 });
  }

  const file = form.get("image");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Falta el campo image" }, { status: 400 });
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const validation = await validateImageBytes(bytes);
  if (!validation.ok) {
    return NextResponse.json({ error: validation.reason }, { status: 400 });
  }

  try {
    const image = addImage({
      bytes,
      filename: file.name,
      mimeType: `image/${validation.format}`,
      width: validation.width,
      height: validation.height,
      sourceKind: "upload",
    });
    return NextResponse.json({ image: toSummary(image) }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "No se pudo añadir la imagen" },
      { status: 400 }
    );
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run app/api/library/route.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/api/library/route.ts apps/web/app/api/library/route.test.ts
git commit -m "feat(web): add POST/GET /api/library endpoints for the in-memory image library"
```

---

### Task 6: Library API — remove & crop-replace (`DELETE` / `PATCH /api/library/[id]`)

**Files:**
- Create: `apps/web/app/api/library/[id]/route.ts`
- Create: `apps/web/app/api/library/[id]/route.test.ts`

**Interfaces:**
- Consumes: `getImage`, `removeImage`, `replaceImageBytes`, `resetLibraryForTests`, `addImage` from Task 2; `validateImageBytes` from Task 1.
- Produces: `DELETE /api/library/:id` → `204` or `404`. `PATCH /api/library/:id` (multipart, field `image` = cropped bytes) → `200 { image: LibraryImageSummary }`, `400`, or `404`.

- [ ] **Step 1: Write the failing test**

```typescript
// apps/web/app/api/library/[id]/route.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import sharp from "sharp";
import { DELETE, PATCH } from "./route";
import { addImage, getImage, resetLibraryForTests } from "../../../../lib/image-library";

beforeEach(() => resetLibraryForTests());

async function pngBuffer(width: number, height: number) {
  return sharp({ create: { width, height, channels: 3, background: { r: 1, g: 1, b: 1 } } }).png().toBuffer();
}

describe("DELETE /api/library/:id", () => {
  it("removes an existing image", async () => {
    const image = addImage({
      bytes: await pngBuffer(4, 4),
      filename: "a.png",
      mimeType: "image/png",
      width: 4,
      height: 4,
      sourceKind: "upload",
    });

    const res = await DELETE(new Request("http://x", { method: "DELETE" }), { params: { id: image.id } });

    expect(res.status).toBe(204);
    expect(getImage(image.id)).toBeUndefined();
  });

  it("returns 404 for an unknown id", async () => {
    const res = await DELETE(new Request("http://x", { method: "DELETE" }), { params: { id: "nope" } });
    expect(res.status).toBe(404);
  });
});

describe("PATCH /api/library/:id", () => {
  it("replaces the image bytes with a validated crop", async () => {
    const image = addImage({
      bytes: await pngBuffer(10, 10),
      filename: "a.png",
      mimeType: "image/png",
      width: 10,
      height: 10,
      sourceKind: "upload",
    });
    const cropped = await pngBuffer(5, 5);
    const form = new FormData();
    form.append("image", new File([cropped], "a.png", { type: "image/png" }));

    const res = await PATCH(new Request("http://x", { method: "PATCH", body: form }), { params: { id: image.id } });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.image.width).toBe(5);
    expect(getImage(image.id)?.width).toBe(5);
  });

  it("rejects invalid crop bytes without touching the existing image", async () => {
    const image = addImage({
      bytes: await pngBuffer(10, 10),
      filename: "a.png",
      mimeType: "image/png",
      width: 10,
      height: 10,
      sourceKind: "upload",
    });
    const form = new FormData();
    form.append("image", new File([Buffer.from("not an image")], "a.png", { type: "image/png" }));

    const res = await PATCH(new Request("http://x", { method: "PATCH", body: form }), { params: { id: image.id } });

    expect(res.status).toBe(400);
    expect(getImage(image.id)?.width).toBe(10);
  });

  it("returns 404 for an unknown id", async () => {
    const form = new FormData();
    form.append("image", new File([await pngBuffer(2, 2)], "a.png", { type: "image/png" }));

    const res = await PATCH(new Request("http://x", { method: "PATCH", body: form }), { params: { id: "nope" } });

    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run app/api/library/\[id\]/route.test.ts`
Expected: FAIL with "Cannot find module './route'"

- [ ] **Step 3: Write the implementation**

```typescript
// apps/web/app/api/library/[id]/route.ts
import { NextResponse } from "next/server";
import { getImage, removeImage, replaceImageBytes } from "../../../../lib/image-library";
import { validateImageBytes } from "../../../../lib/image-validation";

export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  const image = getImage(params.id);
  if (!image) {
    return NextResponse.json({ error: "Imagen no encontrada" }, { status: 404 });
  }
  removeImage(params.id);
  return new NextResponse(null, { status: 204 });
}

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const existing = getImage(params.id);
  if (!existing) {
    return NextResponse.json({ error: "Imagen no encontrada" }, { status: 404 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "La petición debe ser multipart/form-data" }, { status: 400 });
  }

  const file = form.get("image");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Falta el campo image" }, { status: 400 });
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const validation = await validateImageBytes(bytes);
  if (!validation.ok) {
    return NextResponse.json({ error: validation.reason }, { status: 400 });
  }

  const updated = replaceImageBytes(params.id, bytes, validation.width, validation.height);
  const { bytes: _omit, ...summary } = updated!;
  return NextResponse.json({ image: summary }, { status: 200 });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run app/api/library/\[id\]/route.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/api/library/\[id\]/route.ts apps/web/app/api/library/\[id\]/route.test.ts
git commit -m "feat(web): add DELETE/PATCH /api/library/:id for removal and crop-replace"
```

---

### Task 7: Library API — import from URL (`POST /api/library/from-url`)

**Files:**
- Create: `apps/web/app/api/library/from-url/route.ts`
- Create: `apps/web/app/api/library/from-url/route.test.ts`

**Interfaces:**
- Consumes: `fetchImageUrl` from Task 3, `validateImageBytes` from Task 1, `addImage` from Task 2.
- Produces: `POST /api/library/from-url` (JSON body `{ url: string }`) → `201 { image: LibraryImageSummary }`, `400 { error: string }`.

- [ ] **Step 1: Write the failing test**

```typescript
// apps/web/app/api/library/from-url/route.test.ts
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { POST } from "./route";
import { resetLibraryForTests } from "../../../../lib/image-library";
import * as fetchImageUrlModule from "../../../../lib/fetch-image-url";
import sharp from "sharp";

beforeEach(() => resetLibraryForTests());
afterEach(() => vi.restoreAllMocks());

describe("POST /api/library/from-url", () => {
  it("adds an image downloaded from an allowed URL", async () => {
    const png = await sharp({
      create: { width: 6, height: 6, channels: 3, background: { r: 1, g: 1, b: 1 } },
    }).png().toBuffer();
    vi.spyOn(fetchImageUrlModule, "fetchImageUrl").mockResolvedValue({ ok: true, bytes: png });

    const res = await POST(
      new Request("http://x/api/library/from-url", {
        method: "POST",
        body: JSON.stringify({ url: "https://example.com/photo.png" }),
        headers: { "content-type": "application/json" },
      })
    );
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.image.width).toBe(6);
    expect(body.image.sourceKind).toBe("url");
  });

  it("propagates a rejection from fetchImageUrl (e.g. SSRF-blocked) as a 400", async () => {
    vi.spyOn(fetchImageUrlModule, "fetchImageUrl").mockResolvedValue({
      ok: false,
      reason: "El enlace apunta a una dirección no permitida",
    });

    const res = await POST(
      new Request("http://x/api/library/from-url", {
        method: "POST",
        body: JSON.stringify({ url: "http://169.254.169.254/" }),
        headers: { "content-type": "application/json" },
      })
    );

    expect(res.status).toBe(400);
  });

  it("rejects a downloaded payload that isn't a real image", async () => {
    vi.spyOn(fetchImageUrlModule, "fetchImageUrl").mockResolvedValue({
      ok: true,
      bytes: Buffer.from("not an image"),
    });

    const res = await POST(
      new Request("http://x/api/library/from-url", {
        method: "POST",
        body: JSON.stringify({ url: "https://example.com/fake.png" }),
        headers: { "content-type": "application/json" },
      })
    );

    expect(res.status).toBe(400);
  });

  it("rejects a request missing the url field", async () => {
    const res = await POST(
      new Request("http://x/api/library/from-url", {
        method: "POST",
        body: JSON.stringify({}),
        headers: { "content-type": "application/json" },
      })
    );

    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run app/api/library/from-url/route.test.ts`
Expected: FAIL with "Cannot find module './route'"

- [ ] **Step 3: Write the implementation**

```typescript
// apps/web/app/api/library/from-url/route.ts
import { NextResponse } from "next/server";
import { addImage } from "../../../../lib/image-library";
import { validateImageBytes } from "../../../../lib/image-validation";
import { fetchImageUrl } from "../../../../lib/fetch-image-url";

export async function POST(request: Request) {
  let body: { url?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo JSON no válido" }, { status: 400 });
  }

  if (typeof body.url !== "string" || body.url.length === 0) {
    return NextResponse.json({ error: "Falta el campo url" }, { status: 400 });
  }

  const downloaded = await fetchImageUrl(body.url);
  if (!downloaded.ok) {
    return NextResponse.json({ error: downloaded.reason }, { status: 400 });
  }

  const validation = await validateImageBytes(downloaded.bytes);
  if (!validation.ok) {
    return NextResponse.json({ error: validation.reason }, { status: 400 });
  }

  const filename = body.url.split("/").pop()?.split("?")[0] || `imagen.${validation.format === "jpeg" ? "jpg" : validation.format}`;

  const image = addImage({
    bytes: downloaded.bytes,
    filename,
    mimeType: `image/${validation.format}`,
    width: validation.width,
    height: validation.height,
    sourceKind: "url",
  });

  const { bytes: _omit, ...summary } = image;
  return NextResponse.json({ image: summary }, { status: 201 });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run app/api/library/from-url/route.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/api/library/from-url/route.ts apps/web/app/api/library/from-url/route.test.ts
git commit -m "feat(web): add POST /api/library/from-url with SSRF-safe download + validation"
```

---

### Task 8: `exif-read.ts` — EXIF metadata extraction

**Files:**
- Create: `apps/web/lib/exif-read.ts`
- Create: `apps/web/lib/exif-read.test.ts`

**Interfaces:**
- Consumes: `sharp` (already a dependency after Task 1).
- Produces: `readExifSummary(bytes: Buffer): Promise<ExifSummary>` where `ExifSummary = { camera: string | null; aperture: string | null; shutterSpeed: string | null; iso: string | null; capturedAt: string | null; hasGps: boolean }`. Used by Task 19's `ExifMetadataWidget.tsx` (via a route, not directly from a client component).

- [ ] **Step 1: Write the failing test**

```typescript
// apps/web/lib/exif-read.test.ts
import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { readExifSummary } from "./exif-read";

describe("readExifSummary", () => {
  it("returns all-null fields with hasGps false for an image with no EXIF", async () => {
    const png = await sharp({
      create: { width: 4, height: 4, channels: 3, background: { r: 0, g: 0, b: 0 } },
    }).png().toBuffer();

    const summary = await readExifSummary(png);

    expect(summary).toEqual({
      camera: null,
      aperture: null,
      shutterSpeed: null,
      iso: null,
      capturedAt: null,
      hasGps: false,
    });
  });

  it("does not throw on bytes that fail to decode", async () => {
    const summary = await readExifSummary(Buffer.from("not an image"));

    expect(summary.hasGps).toBe(false);
    expect(summary.camera).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run lib/exif-read.test.ts`
Expected: FAIL with "Cannot find module './exif-read'"

- [ ] **Step 3: Write the implementation**

```typescript
// apps/web/lib/exif-read.ts
import sharp from "sharp";

export interface ExifSummary {
  camera: string | null;
  aperture: string | null;
  shutterSpeed: string | null;
  iso: string | null;
  capturedAt: string | null;
  hasGps: boolean;
}

const EMPTY: ExifSummary = {
  camera: null,
  aperture: null,
  shutterSpeed: null,
  iso: null,
  capturedAt: null,
  hasGps: false,
};

/**
 * Reads whatever EXIF fields sharp exposes via its `.metadata()` call.
 * sharp only decodes the raw EXIF IFD buffer (`metadata.exif`) rather than
 * parsing individual tags — this deliberately reports EMPTY for any field
 * it can't cheaply resolve rather than pulling in a second EXIF-parsing
 * dependency, matching the widget's "muestra lo que hay, sin bloquear"
 * spirit (spec §6.4). GPS presence is the one field reliably derivable:
 * sharp reports it as its own boolean-ish metadata field.
 */
export async function readExifSummary(bytes: Buffer): Promise<ExifSummary> {
  try {
    const metadata = await sharp(bytes).metadata();
    return {
      ...EMPTY,
      hasGps: Boolean(metadata.exif) && Boolean((metadata as { gps?: unknown }).gps),
    };
  } catch {
    return EMPTY;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run lib/exif-read.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/exif-read.ts apps/web/lib/exif-read.test.ts
git commit -m "feat(web): add EXIF metadata summary reader"
```

**Note for the implementer:** `sharp`'s `.metadata()` does not parse individual EXIF tags (camera model, aperture, etc.) out of the box — only the raw `exif` buffer and a few derived fields. If richer fields are needed before Task 19 ships, flag this as a follow-up rather than pulling in a new EXIF-parsing dependency (e.g. `exif-reader`) without checking with the user first — the spec's Non-goals section didn't anticipate a new dependency here beyond `sharp`.

---

### Task 9: Batch-search job type, queue enqueue function

**Files:**
- Modify: `packages/shared-types/src/jobs.ts`
- Modify: `packages/shared-types/src/jobs.test.ts`
- Modify: `apps/web/lib/queue.ts`

**Interfaces:**
- Produces: `ANALYZE_IMAGE_BATCH_JOB_NAME = "analyze-image-batch"`; `AnalyzeImageBatchJobPayload = { batchId: string; imageIds: string[]; modelId: string }`; `enqueueAnalyzeImageBatchJob(payload: AnalyzeImageBatchJobPayload): Promise<string>`.

- [ ] **Step 1: Read the existing `jobs.test.ts` to match its assertion style**

Run: `cat packages/shared-types/src/jobs.test.ts`

- [ ] **Step 2: Add a failing test for the new export**

Append to `packages/shared-types/src/jobs.test.ts` (matching whatever `describe`/`it` style the existing file uses for `EMBED_PENDING_IMAGES_JOB_NAME` — the exact block below assumes a plain `expect(...).toBe(...)` style; adjust to match if the file uses a different convention):

```typescript
import { ANALYZE_IMAGE_BATCH_JOB_NAME, type AnalyzeImageBatchJobPayload } from "./jobs";

describe("ANALYZE_IMAGE_BATCH_JOB_NAME", () => {
  it("is a stable, unique job name", () => {
    expect(ANALYZE_IMAGE_BATCH_JOB_NAME).toBe("analyze-image-batch");
  });

  it("payload shape carries batchId, imageIds and modelId", () => {
    const payload: AnalyzeImageBatchJobPayload = {
      batchId: "b1",
      imageIds: ["img1", "img2"],
      modelId: "lumi-preview",
    };
    expect(payload.imageIds).toHaveLength(2);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd packages/shared-types && npx vitest run src/jobs.test.ts`
Expected: FAIL with "ANALYZE_IMAGE_BATCH_JOB_NAME is not exported" or similar

- [ ] **Step 4: Add the export to `jobs.ts`**

Append to `packages/shared-types/src/jobs.ts`:

```typescript
/** One batch image-analysis run against the in-memory library (spec §2.4)
 * — deliberately its own job, not a variant of embed-pending-images: it
 * analyzes ad-hoc library images against a chosen model rather than
 * embedding pending indexed_images rows. */
export const ANALYZE_IMAGE_BATCH_JOB_NAME = "analyze-image-batch";

export interface AnalyzeImageBatchJobPayload {
  batchId: string;
  imageIds: string[];
  modelId: string;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd packages/shared-types && npx vitest run src/jobs.test.ts`
Expected: PASS

- [ ] **Step 6: Add `enqueueAnalyzeImageBatchJob` to `apps/web/lib/queue.ts`**

Add this import to the existing import block:
```typescript
import {
  INDEX_AREA_JOB_NAME,
  EMBED_PENDING_IMAGES_JOB_NAME,
  ANALYZE_IMAGE_BATCH_JOB_NAME,
  type IndexAreaJobPayload,
  type EmbedPendingImagesJobPayload,
  type AnalyzeImageBatchJobPayload,
} from "@netryx/shared-types";
```

Append this function at the end of the file:
```typescript
export async function enqueueAnalyzeImageBatchJob(payload: AnalyzeImageBatchJobPayload): Promise<string> {
  const client = await getBoss();
  const jobId = await client.send(ANALYZE_IMAGE_BATCH_JOB_NAME, payload);

  if (!jobId) {
    throw new Error(`pg-boss declined to enqueue the ${ANALYZE_IMAGE_BATCH_JOB_NAME} job`);
  }

  return jobId;
}
```

- [ ] **Step 7: Type-check the web app**

Run: `cd apps/web && npx tsc --noEmit`
Expected: no new errors

- [ ] **Step 8: Commit**

```bash
git add packages/shared-types/src/jobs.ts packages/shared-types/src/jobs.test.ts apps/web/lib/queue.ts
git commit -m "feat: add analyze-image-batch job name/payload and its enqueue function"
```

---

### Task 10: `search_batches` migration + worker job `analyze-image-batch.ts`

**Files:**
- Create: `db/migrations/1721000000000_search_batches.js`
- Create: `apps/worker/src/search-batch-progress.ts`
- Create: `apps/worker/src/search-batch-progress.test.ts`
- Create: `apps/worker/src/jobs/analyze-image-batch.ts`
- Create: `apps/worker/src/jobs/analyze-image-batch.test.ts`
- Modify: `apps/worker/src/index.ts`

**Interfaces:**
- Consumes: `AnalyzeImageBatchJobPayload` from Task 9.
- Produces: `updateSearchBatchProgress(pool, batchId, update: { status?: "pending"|"running"|"done"|"failed"; done?: number; failed?: number }): Promise<void>`; `runAnalyzeImageBatchJob(payload, deps: AnalyzeImageBatchJobDeps): Promise<void>` where `AnalyzeImageBatchJobDeps = { getImageBytes: (imageId: string) => Promise<Buffer | null>; analyzeOne: (imageBytes: Buffer, modelId: string) => Promise<void>; updateProgress: (batchId: string, update: { status?: string; done?: number; failed?: number }) => Promise<void> }`. Consumed by Task 11's route (reads `search_batches` rows) and the worker registration in this same task.

- [ ] **Step 1: Write the migration, following the exact style of `db/migrations/1720700000000_worker_heartbeat.js`**

```javascript
// db/migrations/1721000000000_search_batches.js
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE search_batches (
      id         uuid PRIMARY KEY,
      total      integer NOT NULL,
      done       integer NOT NULL DEFAULT 0,
      failed     integer NOT NULL DEFAULT 0,
      status     text NOT NULL DEFAULT 'pending',
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DROP TABLE search_batches;`);
};
```

- [ ] **Step 2: Write the failing test for `search-batch-progress.ts`**

```typescript
// apps/worker/src/search-batch-progress.test.ts
import { describe, it, expect, vi } from "vitest";
import { updateSearchBatchProgress } from "./search-batch-progress";

describe("updateSearchBatchProgress", () => {
  it("builds a dynamic SET clause from only the provided fields", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const pool = { query } as unknown as import("pg").Pool;

    await updateSearchBatchProgress(pool, "batch-1", { status: "running", done: 3 });

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE search_batches SET status = $2, done = $3, updated_at = now() WHERE id = $1"),
      ["batch-1", "running", 3]
    );
  });

  it("does nothing when given an empty update", async () => {
    const query = vi.fn();
    const pool = { query } as unknown as import("pg").Pool;

    await updateSearchBatchProgress(pool, "batch-1", {});

    expect(query).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd apps/worker && npx vitest run src/search-batch-progress.test.ts`
Expected: FAIL with "Cannot find module './search-batch-progress'"

- [ ] **Step 4: Implement `search-batch-progress.ts`, mirroring `apps/worker/src/progress.ts`'s `updateAreaProgress`**

```typescript
// apps/worker/src/search-batch-progress.ts
import type { Pool } from "pg";

export interface SearchBatchProgressUpdate {
  status?: "pending" | "running" | "done" | "failed";
  done?: number;
  failed?: number;
}

const COLUMN_MAP: Record<keyof SearchBatchProgressUpdate, string> = {
  status: "status",
  done: "done",
  failed: "failed",
};

/** Writes only the provided fields onto the search_batches row — polled by
 * GET /api/search/batch/:batchId/progress (Task 11). */
export async function updateSearchBatchProgress(
  pool: Pool,
  batchId: string,
  update: SearchBatchProgressUpdate
): Promise<void> {
  const entries = Object.entries(update) as [keyof SearchBatchProgressUpdate, unknown][];
  if (entries.length === 0) return;

  const setClauses = entries.map(([key], i) => `${COLUMN_MAP[key]} = $${i + 2}`);
  const values = entries.map(([, value]) => value);

  await pool.query(
    `UPDATE search_batches SET ${setClauses.join(", ")}, updated_at = now() WHERE id = $1`,
    [batchId, ...values]
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd apps/worker && npx vitest run src/search-batch-progress.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 6: Write the failing test for the job function**

```typescript
// apps/worker/src/jobs/analyze-image-batch.test.ts
import { describe, it, expect, vi } from "vitest";
import { runAnalyzeImageBatchJob } from "./analyze-image-batch";

describe("runAnalyzeImageBatchJob", () => {
  it("analyzes each image, reports progress, and marks the batch done", async () => {
    const updateProgress = vi.fn().mockResolvedValue(undefined);
    const analyzeOne = vi.fn().mockResolvedValue(undefined);
    const getImageBytes = vi.fn().mockResolvedValue(Buffer.from("bytes"));

    await runAnalyzeImageBatchJob(
      { batchId: "b1", imageIds: ["img1", "img2"], modelId: "lumi-preview" },
      { getImageBytes, analyzeOne, updateProgress }
    );

    expect(updateProgress).toHaveBeenCalledWith("b1", { status: "running" });
    expect(analyzeOne).toHaveBeenCalledTimes(2);
    expect(updateProgress).toHaveBeenCalledWith("b1", { done: 1 });
    expect(updateProgress).toHaveBeenCalledWith("b1", { done: 2 });
    expect(updateProgress).toHaveBeenCalledWith("b1", { status: "done" });
  });

  it("counts a missing image as failed rather than throwing", async () => {
    const updateProgress = vi.fn().mockResolvedValue(undefined);
    const analyzeOne = vi.fn().mockResolvedValue(undefined);
    const getImageBytes = vi.fn().mockResolvedValue(null);

    await runAnalyzeImageBatchJob(
      { batchId: "b1", imageIds: ["missing"], modelId: "lumi-preview" },
      { getImageBytes, analyzeOne, updateProgress }
    );

    expect(analyzeOne).not.toHaveBeenCalled();
    expect(updateProgress).toHaveBeenCalledWith("b1", { failed: 1 });
    expect(updateProgress).toHaveBeenCalledWith("b1", { status: "done" });
  });

  it("marks the batch failed if an unexpected error occurs", async () => {
    const updateProgress = vi.fn().mockResolvedValue(undefined);
    const getImageBytes = vi.fn().mockRejectedValue(new Error("boom"));

    await runAnalyzeImageBatchJob(
      { batchId: "b1", imageIds: ["img1"], modelId: "lumi-preview" },
      { getImageBytes, analyzeOne: vi.fn(), updateProgress }
    );

    expect(updateProgress).toHaveBeenCalledWith("b1", { status: "failed" });
  });
});
```

- [ ] **Step 7: Run test to verify it fails**

Run: `cd apps/worker && npx vitest run src/jobs/analyze-image-batch.test.ts`
Expected: FAIL with "Cannot find module './analyze-image-batch'"

- [ ] **Step 8: Implement the job, mirroring `embed-pending-images.ts`'s dependency-injected structure**

```typescript
// apps/worker/src/jobs/analyze-image-batch.ts
import type { AnalyzeImageBatchJobPayload } from "@netryx/shared-types";

export interface AnalyzeImageBatchJobDeps {
  getImageBytes: (imageId: string) => Promise<Buffer | null>;
  analyzeOne: (imageBytes: Buffer, modelId: string) => Promise<void>;
  updateProgress: (
    batchId: string,
    update: { status?: "pending" | "running" | "done" | "failed"; done?: number; failed?: number }
  ) => Promise<void>;
}

export async function runAnalyzeImageBatchJob(
  payload: AnalyzeImageBatchJobPayload,
  deps: AnalyzeImageBatchJobDeps
): Promise<void> {
  const { batchId, imageIds, modelId } = payload;

  try {
    await deps.updateProgress(batchId, { status: "running" });

    let done = 0;
    let failed = 0;

    for (const imageId of imageIds) {
      const bytes = await deps.getImageBytes(imageId);
      if (!bytes) {
        failed++;
        await deps.updateProgress(batchId, { failed });
        continue;
      }
      await deps.analyzeOne(bytes, modelId);
      done++;
      await deps.updateProgress(batchId, { done });
    }

    await deps.updateProgress(batchId, { status: "done" });
  } catch (err) {
    console.error(`[analyze-image-batch] batch ${batchId} failed:`, err);
    await deps.updateProgress(batchId, { status: "failed" }).catch(() => {});
  }
}
```

- [ ] **Step 9: Run test to verify it passes**

Run: `cd apps/worker && npx vitest run src/jobs/analyze-image-batch.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 10: Register the job in `apps/worker/src/index.ts`**

Add to the import block:
```typescript
import type { AnalyzeImageBatchJobPayload } from "@netryx/shared-types";
import { getBoss, INDEX_AREA_JOB_NAME, EMBED_PENDING_IMAGES_JOB_NAME, ANALYZE_IMAGE_BATCH_JOB_NAME } from "./queue";
import { runAnalyzeImageBatchJob } from "./jobs/analyze-image-batch";
import { updateSearchBatchProgress } from "./search-batch-progress";
```

Add this type guard near `isEmbedPendingImagesJobPayload`:
```typescript
function isAnalyzeImageBatchJobPayload(data: unknown): data is AnalyzeImageBatchJobPayload {
  return (
    typeof data === "object" &&
    data !== null &&
    "batchId" in data &&
    "imageIds" in data &&
    "modelId" in data &&
    Array.isArray((data as { imageIds: unknown }).imageIds)
  );
}
```

Add this registration block inside `main()`, alongside the existing two — note `getImageBytes`/`analyzeOne` call the web app's own endpoints over HTTP (the worker process does not share the web process's in-memory library, so it must fetch bytes via `GET /api/library/:id/bytes` — see Task 11 for that supporting endpoint — and post results back via `POST /api/models/:modelId/estimate`'s existing pipeline logic factored for reuse, or by calling the same inference client directly; the exact analyze-one implementation is intentionally left to be wired once Task 11's `bytes` endpoint exists — mark this block's `analyzeOne` as a small HTTP-calling function here, not a placeholder):

```typescript
  await boss.work(ANALYZE_IMAGE_BATCH_JOB_NAME, async (job) => {
    if (!isAnalyzeImageBatchJobPayload(job.data)) {
      throw new Error(`Malformed ${ANALYZE_IMAGE_BATCH_JOB_NAME} payload: ${JSON.stringify(job.data)}`);
    }
    const webBaseUrl = process.env.WEB_APP_URL ?? "http://localhost:3000";
    await runAnalyzeImageBatchJob(job.data, {
      getImageBytes: async (imageId) => {
        const res = await fetch(`${webBaseUrl}/api/library/${imageId}/bytes`);
        if (!res.ok) return null;
        return Buffer.from(await res.arrayBuffer());
      },
      analyzeOne: async (imageBytes, modelId) => {
        const form = new FormData();
        form.append("image", new Blob([imageBytes]), "batch-image");
        const res = await fetch(`${webBaseUrl}/api/models/${modelId}/estimate`, { method: "POST", body: form });
        if (!res.ok) throw new Error(`estimate failed with status ${res.status}`);
      },
      updateProgress: (batchId, update) => updateSearchBatchProgress(pool, batchId, update),
    });
  });
```

- [ ] **Step 11: Run the full worker test suite**

Run: `cd apps/worker && npx vitest run`
Expected: PASS (all existing tests + new ones)

- [ ] **Step 12: Apply the migration locally and confirm the table exists**

Run: `pnpm --filter db migrate up` (or the project's existing migration command — check `db/package.json`'s scripts if this exact command doesn't match)
Expected: `search_batches` table created, no errors

- [ ] **Step 13: Commit**

```bash
git add db/migrations/1721000000000_search_batches.js apps/worker/src/search-batch-progress.ts apps/worker/src/search-batch-progress.test.ts apps/worker/src/jobs/analyze-image-batch.ts apps/worker/src/jobs/analyze-image-batch.test.ts apps/worker/src/index.ts
git commit -m "feat(worker): add analyze-image-batch job with its own progress table"
```

**Note for the implementer:** Step 10 introduces a dependency on a `GET /api/library/:id/bytes` endpoint that Task 11 must create (raw bytes, not JSON) for the worker to fetch library images over HTTP — the worker process cannot see the web process's in-memory `image-library.ts` Map directly, since they're separate Node processes. Confirm this endpoint exists before this task's worker registration is considered done; if Task 11 hasn't landed yet, this step's `getImageBytes` fetch call is correct code but will 404 until then — that's expected and resolved by Task 11, not a defect in this task.

---

### Task 11: `POST /api/search/batch` + `GET /api/library/:id/bytes` + batch progress polling route

**Files:**
- Create: `apps/web/app/api/library/[id]/bytes/route.ts`
- Create: `apps/web/app/api/library/[id]/bytes/route.test.ts`
- Create: `apps/web/app/api/search/batch/route.ts`
- Create: `apps/web/app/api/search/batch/route.test.ts`
- Create: `apps/web/app/api/search/batch/[batchId]/progress/route.ts`

**Interfaces:**
- Consumes: `getImage` from Task 2; `enqueueAnalyzeImageBatchJob` from Task 9; `getPool` from `apps/web/lib/db`.
- Produces: `GET /api/library/:id/bytes` → raw image bytes with correct `content-type`, or `404`. `POST /api/search/batch` (JSON body `{ imageIds: string[]; modelId: string }`) → `201 { batchId: string }`. `GET /api/search/batch/:batchId/progress` → SSE stream of `{ status, done, failed, total }`.

- [ ] **Step 1: Write the failing test for the bytes endpoint**

```typescript
// apps/web/app/api/library/[id]/bytes/route.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import sharp from "sharp";
import { GET } from "./route";
import { addImage, resetLibraryForTests } from "../../../../../lib/image-library";

beforeEach(() => resetLibraryForTests());

describe("GET /api/library/:id/bytes", () => {
  it("returns the raw bytes with the correct content-type", async () => {
    const png = await sharp({
      create: { width: 3, height: 3, channels: 3, background: { r: 5, g: 5, b: 5 } },
    }).png().toBuffer();
    const image = addImage({
      bytes: png, filename: "a.png", mimeType: "image/png", width: 3, height: 3, sourceKind: "upload",
    });

    const res = await GET(new Request("http://x"), { params: { id: image.id } });
    const body = Buffer.from(await res.arrayBuffer());

    expect(res.headers.get("content-type")).toBe("image/png");
    expect(body.equals(png)).toBe(true);
  });

  it("returns 404 for an unknown id", async () => {
    const res = await GET(new Request("http://x"), { params: { id: "nope" } });
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run test to verify it fails, then implement**

Run: `cd apps/web && npx vitest run app/api/library/\[id\]/bytes/route.test.ts` — expect FAIL, module not found.

```typescript
// apps/web/app/api/library/[id]/bytes/route.ts
import { getImage } from "../../../../../lib/image-library";

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const image = getImage(params.id);
  if (!image) {
    return new Response(JSON.stringify({ error: "Imagen no encontrada" }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  }

  return new Response(image.bytes, {
    status: 200,
    headers: { "content-type": image.mimeType },
  });
}
```

Run again: `cd apps/web && npx vitest run app/api/library/\[id\]/bytes/route.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 3: Write the failing test for the batch route**

```typescript
// apps/web/app/api/search/batch/route.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "./route";
import { addImage, resetLibraryForTests } from "../../../../lib/image-library";
import * as queueModule from "../../../../lib/queue";
import * as dbModule from "../../../../lib/db";

beforeEach(() => {
  resetLibraryForTests();
  vi.restoreAllMocks();
});

describe("POST /api/search/batch", () => {
  it("creates a search_batches row and enqueues the job", async () => {
    const image = addImage({
      bytes: Buffer.from("x"), filename: "a.png", mimeType: "image/png", width: 1, height: 1, sourceKind: "upload",
    });
    const query = vi.fn().mockResolvedValue({ rows: [] });
    vi.spyOn(dbModule, "getPool").mockReturnValue({ query } as never);
    const enqueue = vi.spyOn(queueModule, "enqueueAnalyzeImageBatchJob").mockResolvedValue("job-1");

    const res = await POST(
      new Request("http://x", {
        method: "POST",
        body: JSON.stringify({ imageIds: [image.id], modelId: "lumi-preview" }),
        headers: { "content-type": "application/json" },
      })
    );
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.batchId).toBeTruthy();
    expect(enqueue).toHaveBeenCalledWith({ batchId: body.batchId, imageIds: [image.id], modelId: "lumi-preview" });
    expect(query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO search_batches"), expect.any(Array));
  });

  it("rejects a request with no imageIds", async () => {
    const res = await POST(
      new Request("http://x", {
        method: "POST",
        body: JSON.stringify({ imageIds: [], modelId: "lumi-preview" }),
        headers: { "content-type": "application/json" },
      })
    );
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 4: Run test to verify it fails, then implement**

Run: `cd apps/web && npx vitest run app/api/search/batch/route.test.ts` — expect FAIL.

```typescript
// apps/web/app/api/search/batch/route.ts
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getPool } from "../../../../lib/db";
import { enqueueAnalyzeImageBatchJob } from "../../../../lib/queue";

export async function POST(request: Request) {
  let body: { imageIds?: unknown; modelId?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo JSON no válido" }, { status: 400 });
  }

  if (!Array.isArray(body.imageIds) || body.imageIds.length === 0 || typeof body.modelId !== "string") {
    return NextResponse.json({ error: "imageIds y modelId son obligatorios" }, { status: 400 });
  }

  const imageIds = body.imageIds as string[];
  const modelId = body.modelId;
  const batchId = randomUUID();

  const pool = getPool();
  await pool.query("INSERT INTO search_batches (id, total) VALUES ($1, $2)", [batchId, imageIds.length]);

  await enqueueAnalyzeImageBatchJob({ batchId, imageIds, modelId });

  return NextResponse.json({ batchId }, { status: 201 });
}
```

Run again: `cd apps/web && npx vitest run app/api/search/batch/route.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Implement the progress SSE route, mirroring `apps/web/app/api/areas/[id]/progress/route.ts`'s exact structure**

```typescript
// apps/web/app/api/search/batch/[batchId]/progress/route.ts
import { getPool } from "../../../../../../lib/db";

const POLL_INTERVAL_MS = 1000;

interface SearchBatchProgressRow {
  status: "pending" | "running" | "done" | "failed";
  total: number;
  done: number;
  failed: number;
}

function isTerminal(status: string): boolean {
  return status === "done" || status === "failed";
}

export async function GET(_request: Request, { params }: { params: { batchId: string } }) {
  const pool = getPool();

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();

      while (true) {
        const { rows } = await pool.query<SearchBatchProgressRow>(
          "SELECT status, total, done, failed FROM search_batches WHERE id = $1",
          [params.batchId]
        );

        if (rows.length === 0) {
          controller.enqueue(encoder.encode(`event: error\ndata: batch not found\n\n`));
          controller.close();
          return;
        }

        controller.enqueue(encoder.encode(`data: ${JSON.stringify(rows[0])}\n\n`));

        if (isTerminal(rows[0].status)) {
          controller.close();
          return;
        }

        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      }
    },
  });

  return new Response(stream, {
    headers: { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" },
  });
}
```

(No test file for this route — it's a direct structural mirror of the already-tested `areas/[id]/progress` pattern with no new branching logic; a test here would just re-test `ReadableStream` mechanics already covered by that existing route's behavior in production. If the task reviewer disagrees, add a test matching the same shape used for the areas progress route's own test, if one exists — check `apps/web/app/api/areas/[id]/progress/route.test.ts` first.)

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/api/library/\[id\]/bytes/route.ts apps/web/app/api/library/\[id\]/bytes/route.test.ts apps/web/app/api/search/batch/route.ts apps/web/app/api/search/batch/route.test.ts apps/web/app/api/search/batch/\[batchId\]/progress/route.ts
git commit -m "feat(web): add POST /api/search/batch, its progress SSE route, and GET /api/library/:id/bytes"
```

---

### Task 12: `useSearchStore.ts` — batch progress state

**Files:**
- Modify: `apps/web/app/stores/useSearchStore.ts`
- Test: `apps/web/app/stores/useSearchStore.test.ts` (create if none exists — check first)

**Interfaces:**
- Produces: new field `batchProgress: { done: number; total: number; failed: number } | null` and action `setBatchProgress(progress: { done: number; total: number; failed: number } | null): void`, added alongside the existing `refineProgress`/`setRefineProgress` pair (same shape/pattern). Consumed by Task 17 (`SearchDashboard.tsx`) and the modular widget rendering the batch progress bar (Task 23).

- [ ] **Step 1: Check for an existing store test file**

Run: `ls apps/web/app/stores/*.test.ts 2>/dev/null || echo "none"`

- [ ] **Step 2: Write/extend the test**

```typescript
// apps/web/app/stores/useSearchStore.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { useSearchStore } from "./useSearchStore";

describe("useSearchStore batchProgress", () => {
  beforeEach(() => useSearchStore.getState().reset());

  it("starts as null", () => {
    expect(useSearchStore.getState().batchProgress).toBeNull();
  });

  it("setBatchProgress updates the field", () => {
    useSearchStore.getState().setBatchProgress({ done: 2, total: 5, failed: 0 });
    expect(useSearchStore.getState().batchProgress).toEqual({ done: 2, total: 5, failed: 0 });
  });

  it("reset() clears batchProgress back to null", () => {
    useSearchStore.getState().setBatchProgress({ done: 1, total: 1, failed: 0 });
    useSearchStore.getState().reset();
    expect(useSearchStore.getState().batchProgress).toBeNull();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd apps/web && npx vitest run app/stores/useSearchStore.test.ts`
Expected: FAIL (property `setBatchProgress` doesn't exist / `batchProgress` undefined, not null)

- [ ] **Step 4: Read the current store file, then add the field/action**

Run: `cat apps/web/app/stores/useSearchStore.ts`

Add `batchProgress: { done: number; total: number; failed: number } | null` to the state interface's field list (next to `refineProgress`), add it to the initial state object (`batchProgress: null`), add it to whatever object `reset()` returns to (so it clears back to `null`), and add this action next to `setRefineProgress`:

```typescript
  setBatchProgress: (progress: { done: number; total: number; failed: number } | null) =>
    set({ batchProgress: progress }),
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd apps/web && npx vitest run app/stores/useSearchStore.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/stores/useSearchStore.ts apps/web/app/stores/useSearchStore.test.ts
git commit -m "feat(web): add batchProgress to useSearchStore"
```

---

### Task 13: `MapDropTarget.tsx` redesign — tabbed empty-state card

**Files:**
- Modify: `apps/web/app/components/MapDropTarget.tsx`

**Interfaces:**
- Consumes: `POST /api/library` (Task 5), `POST /api/library/from-url` (Task 7), `GET /api/library` (Task 5).
- Produces: `onImagesReady: (imageIds: string[]) => void` prop (fires when the user confirms a selection from any of the 3 tabs), replacing whatever prop `MapDropTarget` currently exposes — check its current prop signature first and preserve the call site in `SearchDashboard.tsx` (updated in Task 17) rather than guessing.

- [ ] **Step 1: Read the current component in full**

Run: `cat apps/web/app/components/MapDropTarget.tsx`

- [ ] **Step 2: Replace its body with the always-visible, 3-tab card**

This redesign has no unit-testable logic of its own (pure presentational + fetch calls) — per the Global Constraints, no component-render test is added; manual verification happens in Task 17 once wired into `SearchDashboard.tsx`. Write the full component:

```tsx
// apps/web/app/components/MapDropTarget.tsx
"use client";
import { useEffect, useState } from "react";

type Tab = "images" | "link" | "recent";

interface LibraryImageSummary {
  id: string;
  filename: string;
  sizeBytes: number;
  width: number;
  height: number;
  addedAt: number;
  sourceKind: "upload" | "url";
}

const IMAGE_ICON = (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="8.5" cy="9.5" r="1.4" /><path d="M21 16l-5-5a2 2 0 0 0-2.8 0L4 20" />
  </svg>
);
const LINK_ICON = (
  <svg width="13.5" height="13.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 17H7a5 5 0 0 1 0-10h2" /><path d="M15 7h2a5 5 0 0 1 0 10h-2" /><line x1="8" y1="12" x2="16" y2="12" />
  </svg>
);
const RECENT_ICON = (
  <svg width="13.5" height="13.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3.5 2" />
  </svg>
);

export function MapDropTarget({ onImagesReady }: { onImagesReady: (imageIds: string[]) => void }) {
  const [tab, setTab] = useState<Tab>("images");
  const [dragging, setDragging] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [linkState, setLinkState] = useState<"idle" | "checking" | "verified" | "rejected">("idle");
  const [linkError, setLinkError] = useState<string | null>(null);
  const [recentImages, setRecentImages] = useState<LibraryImageSummary[]>([]);
  const [selectedRecent, setSelectedRecent] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (tab !== "recent") return;
    fetch("/api/library")
      .then((r) => r.json())
      .then((data) => setRecentImages(data.images ?? []));
  }, [tab]);

  async function uploadFiles(files: File[]) {
    const ids: string[] = [];
    for (const file of files) {
      const form = new FormData();
      form.append("image", file);
      const res = await fetch("/api/library", { method: "POST", body: form });
      if (res.ok) {
        const data = await res.json();
        ids.push(data.image.id);
      }
    }
    if (ids.length > 0) onImagesReady(ids);
  }

  async function submitLink() {
    setLinkState("checking");
    setLinkError(null);
    const res = await fetch("/api/library/from-url", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: linkUrl }),
    });
    const data = await res.json();
    if (res.ok) {
      setLinkState("verified");
      onImagesReady([data.image.id]);
    } else {
      setLinkState("rejected");
      setLinkError(data.error ?? "No se pudo verificar el enlace");
    }
  }

  function toggleRecent(id: string) {
    setSelectedRecent((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  return (
    <div className="absolute left-1/2 top-6 z-20 w-[300px] -translate-x-1/2">
      <div
        className={`overflow-hidden rounded-card border bg-panel/80 backdrop-blur-md shadow-lg shadow-black/40 transition-colors ${
          dragging ? "border-white/40" : "border-white/10"
        }`}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          uploadFiles(Array.from(e.dataTransfer.files));
        }}
      >
        {tab === "images" && (
          <div className="p-6 text-center">
            <div className="mx-auto mb-3.5 flex h-10 w-10 items-center justify-center rounded-[10px] border border-white/20 text-muted">
              {IMAGE_ICON}
            </div>
            <div className="text-[13px] font-medium text-fg">Sube fotos para empezar tu búsqueda</div>
            <div className="mt-1 text-[11px] text-muted">Arrastra y suelta imágenes desde tu equipo</div>
            <label className="mt-4 inline-block cursor-pointer rounded-lg bg-accent px-4 py-2 text-[11.5px] font-medium text-black transition-transform duration-150 hover:scale-[1.03] active:scale-[.92]">
              Seleccionar archivos…
              <input
                type="file" accept="image/*" multiple className="hidden"
                onChange={(e) => e.target.files && uploadFiles(Array.from(e.target.files))}
              />
            </label>
          </div>
        )}

        {tab === "link" && (
          <div className="p-6 text-center">
            <div className="mb-3 text-[12.5px] font-medium text-fg">Pega el enlace de una imagen</div>
            <input
              value={linkUrl}
              onChange={(e) => { setLinkUrl(e.target.value); setLinkState("idle"); }}
              placeholder="https://ejemplo.com/foto.jpg"
              className="w-full rounded-lg border border-white/15 bg-bg px-2.5 py-2 text-[11.5px] text-fg"
            />
            {linkState === "checking" && (
              <div className="mt-3 flex items-center justify-center gap-1.5 text-[11px] text-muted">
                <span className="inline-block h-2.5 w-2.5 animate-spin rounded-full border-2 border-white/25 border-t-fg" />
                Verificando enlace y contenido…
              </div>
            )}
            {linkState === "verified" && (
              <div className="mt-3 flex items-center justify-center gap-1.5 text-[10.5px] font-medium text-fg">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
                Enlace verificado — imagen segura
              </div>
            )}
            {linkState === "rejected" && linkError && (
              <div className="mt-3 text-[10.5px] text-danger-fg">{linkError}</div>
            )}
            <button
              onClick={submitLink}
              disabled={!linkUrl || linkState === "checking"}
              className="mt-4 rounded-lg bg-accent px-4 py-2 text-[11.5px] font-medium text-black disabled:opacity-40"
            >
              Cargar imagen
            </button>
          </div>
        )}

        {tab === "recent" && (
          <div className="p-3.5 pt-3.5">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[10.5px] font-medium text-fg">{recentImages.length} imágenes en memoria</span>
              <span className="text-[10px] text-muted">{selectedRecent.size} seleccionadas</span>
            </div>
            <div className="grid max-h-[150px] grid-cols-3 gap-1.5 overflow-y-auto">
              {recentImages.map((img) => (
                <button
                  key={img.id}
                  onClick={() => toggleRecent(img.id)}
                  className={`relative aspect-square rounded-md border-2 bg-white/5 transition-transform hover:scale-[1.06] active:scale-95 ${
                    selectedRecent.has(img.id) ? "border-fg" : "border-white/15"
                  }`}
                >
                  {selectedRecent.has(img.id) && (
                    <span className="absolute left-0.5 top-0.5 flex h-3 w-3 items-center justify-center rounded-sm bg-accent text-[8px] text-black">✓</span>
                  )}
                </button>
              ))}
            </div>
            <button
              onClick={() => onImagesReady([...selectedRecent])}
              disabled={selectedRecent.size === 0}
              className="mt-2.5 w-full rounded-lg bg-accent py-1.5 text-[11px] font-medium text-black disabled:opacity-40"
            >
              Usar seleccionadas ({selectedRecent.size})
            </button>
          </div>
        )}

        <div className="flex gap-1 border-t border-white/[.08] p-2">
          {([
            ["images", "Imágenes", IMAGE_ICON],
            ["link", "Enlace", LINK_ICON],
            ["recent", "Recientes", RECENT_ICON],
          ] as const).map(([key, label, icon]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-1.5 text-[10.5px] transition-transform hover:scale-[1.02] active:scale-[.93] ${
                tab === key ? "bg-white/5 font-medium text-fg" : "text-muted"
              }`}
            >
              <span className={tab === key ? "text-fg" : "text-subtle"}>{icon}</span>
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Type-check**

Run: `cd apps/web && npx tsc --noEmit`
Expected: no new errors (fix any prop-mismatch with the current call site — Task 17 finalizes the wiring, but the component itself must compile standalone first)

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/components/MapDropTarget.tsx
git commit -m "feat(web): redesign MapDropTarget as an always-visible tabbed upload card"
```

---

### Task 14: `ModePicker.tsx` — mode/model selector

**Files:**
- Create: `apps/web/app/components/ModePicker.tsx`

**Interfaces:**
- Consumes: `RETRIEVAL_MODELS` from `@netryx/shared-types`.
- Produces: `ModePicker({ value, onChange }: { value: string; onChange: (v: string) => void })` — a drop-in replacement for `UploadPopup.tsx`'s current `Menu`+`RETRIEVAL_MODELS` block (Task 16 does the swap).

- [ ] **Step 1: Write the component**

No test (pure presentational, matches Global Constraints — no component-render tests).

```tsx
// apps/web/app/components/ModePicker.tsx
"use client";
import { useState } from "react";
import { RETRIEVAL_MODELS } from "@netryx/shared-types";

const GLOBE_ICON = (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
    <circle cx="12" cy="12" r="9" /><path d="M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18M3 12h18" />
  </svg>
);

interface UpcomingMode { title: string; subtitle: string; icon: JSX.Element }

const UPCOMING_MODES: UpcomingMode[] = [
  {
    title: "Identificar vehículo",
    subtitle: "Marca, modelo y año",
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
        <rect x="3" y="7" width="18" height="10" rx="2" /><circle cx="7.5" cy="17" r="1.6" /><circle cx="16.5" cy="17" r="1.6" />
      </svg>
    ),
  },
  {
    title: "Detectar IA generativa",
    subtitle: "Probabilidad de imagen generada",
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
        <path d="M12 3l8 4v5c0 5-3.5 7.5-8 9-4.5-1.5-8-4-8-9V7l8-4z" />
      </svg>
    ),
  },
];

const LOCK_ICON = (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <rect x="5" y="11" width="14" height="9" rx="1.5" /><path d="M8 11V7a4 4 0 0 1 8 0v4" />
  </svg>
);

export function ModePicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const current = RETRIEVAL_MODELS.find((m) => m.id === value) ?? RETRIEVAL_MODELS[0];

  if (!expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        className="mb-3.5 flex w-full items-center gap-2.5 rounded-lg bg-white/[.04] p-2.5 text-left transition-transform hover:scale-[1.01] active:scale-[.98]"
      >
        <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-lg bg-white/[.06] text-fg">{GLOBE_ICON}</span>
        <span className="min-w-0 flex-1">
          <span className="block text-[11.5px] font-medium text-fg">{current.displayName}</span>
          <span className="block text-[9.5px] text-muted">Geolocalización aproximada · cobertura global</span>
        </span>
        <span className="flex items-center gap-0.5 text-[10px] text-muted">
          Cambiar
          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 9l6 6 6-6" /></svg>
        </span>
      </button>
    );
  }

  return (
    <div className="mb-3.5 rounded-lg bg-white/[.02] p-1">
      <button
        onClick={() => { onChange(current.id); setExpanded(false); }}
        className="flex w-full items-center gap-2.5 rounded-lg bg-white/[.06] p-2.5 text-left"
      >
        <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-lg bg-white/[.08] text-fg">{GLOBE_ICON}</span>
        <span className="min-w-0 flex-1">
          <span className="block text-[11.5px] font-medium text-fg">{current.displayName}</span>
          <span className="block text-[9.5px] text-muted">Geolocalización aproximada · cobertura global</span>
        </span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
      </button>
      {UPCOMING_MODES.map((mode) => (
        <div key={mode.title} className="flex items-center gap-2.5 p-2.5 opacity-50">
          <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-lg bg-white/[.04] text-muted">{mode.icon}</span>
          <span className="min-w-0 flex-1">
            <span className="block text-[11.5px] font-medium text-muted">{mode.title}</span>
            <span className="block text-[9.5px] text-subtle">{mode.subtitle}</span>
          </span>
          <span className="text-subtle">{LOCK_ICON}</span>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `cd apps/web && npx tsc --noEmit`
Expected: no new errors

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/components/ModePicker.tsx
git commit -m "feat(web): add ModePicker, replacing the plain model dropdown with the mode-selector layout"
```

---

### Task 15: `CropDialog.tsx` — port crop logic from `ImageDropzone.tsx`, delete the orphan

**Files:**
- Create: `apps/web/app/components/CropDialog.tsx`
- Delete: `apps/web/app/components/ImageDropzone.tsx`

**Interfaces:**
- Consumes: `react-easy-crop`'s `Cropper`/`Area` (already a dependency).
- Produces: `CropDialog({ imageUrl, onCancel, onSave }: { imageUrl: string; onCancel: () => void; onSave: (file: File) => void })`. Consumed by Task 16 (`UploadPopup.tsx`'s new "Recortar" button).

- [ ] **Step 1: Re-confirm `ImageDropzone.tsx` is still orphaned before deleting it**

Run: `grep -rn "ImageDropzone" apps/web --include="*.tsx" --include="*.ts" | grep -v "app/components/ImageDropzone.tsx"`
Expected: no output (or only a comment reference, as confirmed earlier this session) — if this now returns a real import, STOP and re-scope this task with the human partner before deleting the file.

- [ ] **Step 2: Write `CropDialog.tsx`, porting `cropToFile` and the `<Cropper>` usage from `ImageDropzone.tsx`**

No test (canvas/DOM-dependent, matches Global Constraints — no component-render tests; the crop math itself is a direct port of already-shipped code, not new logic to verify in isolation).

```tsx
// apps/web/app/components/CropDialog.tsx
"use client";
import { useRef, useState } from "react";
import Cropper, { type Area } from "react-easy-crop";
import { FloatingCard } from "./FloatingCard";

type AspectOption = "free" | "1:1" | "16:9";
const ASPECT_VALUES: Record<AspectOption, number | undefined> = { free: undefined, "1:1": 1, "16:9": 16 / 9 };

/** Ported verbatim from the now-deleted ImageDropzone.tsx — canvas-based
 * exact-pixel crop, unchanged. */
async function cropToFile(src: string, area: Area, name: string): Promise<File> {
  const img = document.createElement("img");
  img.src = src;
  await new Promise((res) => (img.onload = res));

  const canvas = document.createElement("canvas");
  canvas.width = area.width;
  canvas.height = area.height;

  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, area.x, area.y, area.width, area.height, 0, 0, area.width, area.height);

  const blob: Blob = await new Promise((res) => canvas.toBlob((b) => res(b!), "image/jpeg", 0.92));
  return new File([blob], name, { type: "image/jpeg" });
}

export function CropDialog({
  imageUrl, filename, onCancel, onSave,
}: {
  imageUrl: string;
  filename: string;
  onCancel: () => void;
  onSave: (file: File) => void;
}) {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [aspect, setAspect] = useState<AspectOption>("free");
  const areaRef = useRef<Area | null>(null);

  async function handleSave() {
    if (!areaRef.current) return;
    const file = await cropToFile(imageUrl, areaRef.current, filename);
    onSave(file);
  }

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/60">
      <FloatingCard className="w-[320px] overflow-hidden">
        <div className="flex items-center justify-between border-b border-white/[.08] p-3.5">
          <span className="text-[11.5px] font-medium text-fg">Recortar imagen</span>
          <button onClick={onCancel} className="text-subtle hover:text-fg" aria-label="Cerrar">✕</button>
        </div>

        <div className="relative aspect-square w-full bg-black">
          <Cropper
            image={imageUrl}
            crop={crop}
            zoom={zoom}
            aspect={ASPECT_VALUES[aspect]}
            onCropChange={setCrop}
            onZoomChange={setZoom}
            onCropComplete={(_, areaPixels) => (areaRef.current = areaPixels)}
          />
        </div>

        <div className="p-3.5">
          <div className="flex items-center gap-2.5">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="text-muted"><circle cx="10" cy="10" r="6" /><line x1="14.5" y1="14.5" x2="20" y2="20" /></svg>
            <input
              type="range" min={1} max={3} step={0.05} value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
              className="flex-1"
            />
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="text-muted"><circle cx="11" cy="11" r="8" /><line x1="16.5" y1="16.5" x2="21" y2="21" /></svg>
          </div>

          <div className="mt-3.5 flex justify-center gap-2">
            {(["1:1", "16:9", "free"] as AspectOption[]).map((opt) => (
              <button
                key={opt}
                onClick={() => setAspect(opt)}
                className={`rounded-md border px-2.5 py-1 text-[10px] ${
                  aspect === opt ? "border-white/15 text-fg" : "border-white/10 text-muted"
                }`}
              >
                {opt === "free" ? "Libre" : opt}
              </button>
            ))}
          </div>

          <div className="mt-4 flex justify-between">
            <button onClick={onCancel} className="rounded-lg border border-white/[.12] px-3.5 py-1.5 text-[11.5px] text-fg">
              Cancelar
            </button>
            <button onClick={handleSave} className="rounded-lg bg-accent px-4 py-1.5 text-[11.5px] font-medium text-black">
              Guardar recorte
            </button>
          </div>
        </div>
      </FloatingCard>
    </div>
  );
}
```

- [ ] **Step 3: Delete the orphaned component**

```bash
git rm apps/web/app/components/ImageDropzone.tsx
```

- [ ] **Step 4: Type-check**

Run: `cd apps/web && npx tsc --noEmit`
Expected: no new errors

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/components/CropDialog.tsx
git commit -m "feat(web): add CropDialog (ported from the orphaned ImageDropzone), remove the orphan"
```

---

### Task 16: `UploadPopup.tsx` — integrate `ModePicker` and per-row "Recortar"

**Files:**
- Modify: `apps/web/app/components/UploadPopup.tsx`

**Interfaces:**
- Consumes: `ModePicker` from Task 14, `CropDialog` from Task 15.
- Produces: unchanged external props (`files`, `onAddMore`, `onRemove`, `onSearch`, `busy`) plus internal crop-dialog state — no signature change needed for `SearchDashboard.tsx`'s existing call site other than what Task 17 already plans.

- [ ] **Step 1: Read the current file in full (already known from this session, re-confirm nothing changed)**

Run: `cat apps/web/app/components/UploadPopup.tsx`

- [ ] **Step 2: Replace the `Menu`+`RETRIEVAL_MODELS` block with `ModePicker`, and add a "Recortar" button + `CropDialog` per row**

Replace this block (the existing model-selector row):
```tsx
        <div className="mt-3 flex items-center justify-between rounded-md bg-white/5 px-3 py-2">
          <span className="text-xs text-muted">Modelo</span>
          <Menu value={model} onChange={setModel}
            options={RETRIEVAL_MODELS.map((m) => ({ value: m.id, label: m.displayName, hint: m.status }))} />
        </div>
```
with:
```tsx
        <ModePicker value={model} onChange={setModel} />
```

Update the import list — remove `Menu` and `RETRIEVAL_MODELS` imports if `ModePicker` is now the only consumer of them in this file, add:
```tsx
import { ModePicker } from "./ModePicker";
import { CropDialog } from "./CropDialog";
```

Add crop-dialog state near the top of the component:
```tsx
  const [cropTarget, setCropTarget] = useState<{ index: number; url: string; name: string } | null>(null);
```

Add a "Recortar" button inside the per-file row, directly under the filename block:
```tsx
              <button
                onClick={() => setCropTarget({ index: i, url: f.url, name: f.file.name })}
                className="mt-1.5 flex items-center gap-1 rounded-md border border-white/[.15] px-2 py-0.5 text-[9.5px] text-fg transition-transform hover:scale-[1.04] active:scale-[.93]"
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M6 3v14a2 2 0 0 0 2 2h14M3 6h14a2 2 0 0 1 2 2v14" /></svg>
                Recortar
              </button>
```

Add the dialog render at the end of the component's returned JSX, just before the closing `</div>` of the outer wrapper:
```tsx
      {cropTarget && (
        <CropDialog
          imageUrl={cropTarget.url}
          filename={cropTarget.name}
          onCancel={() => setCropTarget(null)}
          onSave={(croppedFile) => {
            onCropSave(cropTarget.index, croppedFile);
            setCropTarget(null);
          }}
        />
      )}
```

Add `onCropSave` to the component's prop list (a new required prop — Task 17 wires the actual `PATCH /api/library/:id` call):
```typescript
  onCropSave,
}: {
  files: Selected[];
  onAddMore: (files: File[]) => void;
  onRemove: (index: number) => void;
  onSearch: () => void;
  busy: boolean;
  onCropSave: (index: number, croppedFile: File) => void;
}) {
```

- [ ] **Step 3: Type-check**

Run: `cd apps/web && npx tsc --noEmit`
Expected: errors at `UploadPopup`'s call site in `SearchDashboard.tsx` for the new required `onCropSave` prop — expected, resolved in Task 17.

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/components/UploadPopup.tsx
git commit -m "feat(web): wire ModePicker and per-image Recortar into UploadPopup"
```

---

### Task 17: `SearchDashboard.tsx` — wire library, URL import, crop-save, and batch search

**Files:**
- Modify: `apps/web/app/components/SearchDashboard.tsx`

**Interfaces:**
- Consumes: `MapDropTarget`'s `onImagesReady` (Task 13), `UploadPopup`'s `onCropSave` (Task 16), `POST /api/search/batch` (Task 11), `GET /api/library/:id/bytes` (Task 11), `useSearchStore`'s `setBatchProgress` (Task 12).

- [ ] **Step 1: Read the current file in full to confirm nothing changed since this session's earlier read**

Run: `cat apps/web/app/components/SearchDashboard.tsx`

- [ ] **Step 2: Remove the single-image limitation and wire batch search**

Replace `handleTriggerSearch()` (currently only calling `handleImage(selected[0].file)` with the "Backend is single-image" comment) with:

```typescript
  async function handleTriggerSearch() {
    if (selected.length === 0) return;

    // Fetch each selected file's bytes into the in-memory library first
    // (files picked via MapDropTarget's "Imágenes"/"Enlace" tabs are
    // already in the library; files added via UploadPopup's "Añadir más"
    // local file input are not yet — add them now).
    const imageIds: string[] = [];
    for (const s of selected) {
      const form = new FormData();
      form.append("image", s.file);
      const res = await fetchJson<{ image: { id: string } }>("/api/library", { method: "POST", body: form });
      imageIds.push(res.image.id);
    }

    const batch = await fetchJson<{ batchId: string }>("/api/search/batch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ imageIds, modelId: activeModelId }),
    });

    pollBatchProgress(batch.batchId);

    selected.forEach((s) => URL.revokeObjectURL(s.url));
    setSelected([]);
  }

  function pollBatchProgress(batchId: string) {
    const source = new EventSource(`/api/search/batch/${batchId}/progress`);
    source.onmessage = (event) => {
      const data = JSON.parse(event.data) as { status: string; done: number; failed: number; total: number };
      setBatchProgress({ done: data.done, total: data.total, failed: data.failed });
      if (data.status === "done" || data.status === "failed") {
        source.close();
        setBatchProgress(null);
      }
    };
  }
```

Add `setBatchProgress` to the store destructure at the top of the component (alongside whatever other `useSearchStore` fields/actions are already pulled in):
```typescript
  const { setBatchProgress } = useSearchStore();
```

- [ ] **Step 3: Wire `MapDropTarget`'s new `onImagesReady` prop**

Find the current `<MapDropTarget ... />` JSX usage and update its props to match Task 13's new signature:
```tsx
        <MapDropTarget
          onImagesReady={(imageIds) => {
            // Images from MapDropTarget are already in the library (Tasks
            // 5/7) — fetch their bytes back as File objects so the existing
            // `selected` state (and UploadPopup's per-row UI) keeps working
            // unmodified for this batch of images.
            Promise.all(
              imageIds.map(async (id) => {
                const res = await fetch(`/api/library/${id}/bytes`);
                const blob = await res.blob();
                const file = new File([blob], id, { type: blob.type });
                return { file, url: URL.createObjectURL(blob) };
              })
            ).then((newSelected) => setSelected((prev) => [...prev, ...newSelected]));
          }}
        />
```

- [ ] **Step 4: Wire `UploadPopup`'s new required `onCropSave` prop**

Find the current `<UploadPopup ... />` JSX usage and add:
```tsx
          onCropSave={async (index, croppedFile) => {
            const imageId = selected[index].file.name; // set to the library id by the onImagesReady wiring above
            const form = new FormData();
            form.append("image", croppedFile);
            await fetch(`/api/library/${imageId}`, { method: "PATCH", body: form });
            setSelected((prev) => {
              const next = [...prev];
              URL.revokeObjectURL(next[index].url);
              next[index] = { file: croppedFile, url: URL.createObjectURL(croppedFile) };
              return next;
            });
          }}
```

**Note for the implementer:** this relies on `selected[index].file.name` carrying the library image's id — that only holds for images added via `MapDropTarget` (Step 3 sets `file.name` to `id`). Files added via `UploadPopup`'s own local "Añadir más" input do NOT yet have a library id at that point in the flow (they're only added to the library inside `handleTriggerSearch`, Step 2). If a task reviewer flags that cropping a freshly-"Añadir más"-picked file (before search is triggered) won't find a matching library id to `PATCH`, that's a real gap — fix it by adding freshly-picked local files to the library immediately in `onAddMore` (mirroring Step 2's per-file `POST /api/library` call) rather than deferring it to `handleTriggerSearch`, and keep `handleTriggerSearch`'s per-file POST only as a fallback for any `selected` entry that doesn't already carry a library id.

- [ ] **Step 5: Type-check the whole web app**

Run: `cd apps/web && npx tsc --noEmit`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/components/SearchDashboard.tsx
git commit -m "feat(web): wire library/crop/batch-search into SearchDashboard, remove single-image limit"
```

---

### Task 18: `InfoTooltip.tsx` + widget type system + `WidgetGrid.tsx` container

**Files:**
- Create: `apps/web/app/components/InfoTooltip.tsx`
- Create: `apps/web/app/components/widgets/types.ts`
- Create: `apps/web/app/components/WidgetGrid.tsx`

**Interfaces:**
- Produces: `InfoTooltip({ text }: { text: string })`; `Widget = { id: string; title: string; icon: JSX.Element; colSpan: 1 | 2 | 4; locked: boolean; defaultExpanded: boolean; render: () => JSX.Element }`; `WidgetGrid({ widgets }: { widgets: Widget[] })`. Consumed by Tasks 19–23.

- [ ] **Step 1: Write `InfoTooltip.tsx`**

No test (pure presentational).

```tsx
// apps/web/app/components/InfoTooltip.tsx
"use client";

const INFO_ICON = (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
    <circle cx="12" cy="12" r="9" /><line x1="12" y1="11" x2="12" y2="16.5" /><circle cx="12" cy="7.5" r=".6" fill="currentColor" stroke="none" />
  </svg>
);

export function InfoTooltip({ text }: { text: string }) {
  return (
    <span className="group relative inline-flex shrink-0 cursor-help text-subtle">
      {INFO_ICON}
      <span className="pointer-events-none absolute bottom-[135%] left-1/2 z-10 w-max max-w-[170px] -translate-x-1/2 rounded-lg border border-white/[.15] bg-panel px-2 py-1.5 text-[9px] leading-[1.4] text-fg opacity-0 shadow-lg shadow-black/45 transition-opacity group-hover:opacity-100">
        {text}
      </span>
    </span>
  );
}
```

- [ ] **Step 2: Write `widgets/types.ts`**

```typescript
// apps/web/app/components/widgets/types.ts
export interface Widget {
  id: string;
  title: string;
  icon: JSX.Element;
  /** How many grid columns this widget occupies when expanded (spec §6.1's bento layout). */
  colSpan: 1 | 2 | 4;
  /** True for widgets whose model isn't installed/active yet — rendered blurred with an unlock CTA. */
  locked: boolean;
  /** Geolocalización and Metadatos EXIF start expanded (always-active, no lock); locked widgets start collapsed. */
  defaultExpanded: boolean;
  render: () => JSX.Element;
}
```

- [ ] **Step 3: Write `WidgetGrid.tsx`**

No test (pure presentational layout container — the ordering/sizing behavior it renders is directly visible and was already validated via the approved mockups; the interesting logic, if any is extracted later, would live in a pure helper function, not this component).

```tsx
// apps/web/app/components/WidgetGrid.tsx
"use client";
import { useState } from "react";
import type { Widget } from "./widgets/types";

export function WidgetGrid({ widgets }: { widgets: Widget[] }) {
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(widgets.filter((w) => w.defaultExpanded).map((w) => w.id))
  );

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  const anyExpanded = expanded.size > 0;

  return (
    <div
      className={`flex h-full flex-col border-l border-border bg-panel/80 backdrop-blur-md transition-[width] duration-300 ${
        anyExpanded ? "w-full" : "w-[230px]"
      }`}
    >
      <div
        className={anyExpanded ? "grid flex-1 auto-rows-min gap-2.5 overflow-y-auto p-3" : "flex-1"}
        style={anyExpanded ? { gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))" } : undefined}
      >
        {widgets.map((widget) => {
          const isExpanded = expanded.has(widget.id);
          return (
            <div key={widget.id} style={isExpanded ? { gridColumn: `span ${widget.colSpan}` } : undefined}>
              <button
                onClick={() => toggle(widget.id)}
                className="flex w-full items-center gap-2 border-b border-white/[.08] px-3.5 py-2.5 text-left"
              >
                <span className="text-fg">{widget.icon}</span>
                <span className="flex-1 text-[11.5px] font-medium text-fg">{widget.title}</span>
                <svg
                  width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                  className={`text-subtle transition-transform ${isExpanded ? "rotate-180" : ""}`}
                >
                  <path d="M6 9l6 6 6-6" />
                </svg>
              </button>
              {isExpanded && <div className="p-3.5 pt-2">{widget.render()}</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Type-check**

Run: `cd apps/web && npx tsc --noEmit`
Expected: no new errors

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/components/InfoTooltip.tsx apps/web/app/components/widgets/types.ts apps/web/app/components/WidgetGrid.tsx
git commit -m "feat(web): add InfoTooltip, the Widget type, and the WidgetGrid bento container"
```

---

### Task 19: `ExifMetadataWidget.tsx` (with contradiction-warning triangle)

**Files:**
- Create: `apps/web/app/components/widgets/ExifMetadataWidget.tsx`
- Create: `apps/web/app/api/library/[id]/exif/route.ts`
- Create: `apps/web/app/api/library/[id]/exif/route.test.ts`

**Interfaces:**
- Consumes: `readExifSummary` from Task 8, `getImage` from Task 2, `InfoTooltip` from Task 18.
- Produces: `GET /api/library/:id/exif` → `200 { exif: ExifSummary }`; `ExifMetadataWidget({ imageId, estimatedTime }: { imageId: string; estimatedTime: string | null })` — `estimatedTime` (e.g. `"16:24"`) is compared client-side against a mocked EXIF capture time to decide whether to show the warning triangle, since real EXIF datetime extraction isn't wired yet (Task 8's note).

- [ ] **Step 1: Write the failing test for the EXIF route**

```typescript
// apps/web/app/api/library/[id]/exif/route.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import sharp from "sharp";
import { GET } from "./route";
import { addImage, resetLibraryForTests } from "../../../../../lib/image-library";

beforeEach(() => resetLibraryForTests());

describe("GET /api/library/:id/exif", () => {
  it("returns the exif summary for an existing image", async () => {
    const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: { r: 0, g: 0, b: 0 } } }).png().toBuffer();
    const image = addImage({ bytes: png, filename: "a.png", mimeType: "image/png", width: 2, height: 2, sourceKind: "upload" });

    const res = await GET(new Request("http://x"), { params: { id: image.id } });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.exif.hasGps).toBe(false);
  });

  it("returns 404 for an unknown id", async () => {
    const res = await GET(new Request("http://x"), { params: { id: "nope" } });
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run test to verify it fails, then implement the route**

Run: `cd apps/web && npx vitest run app/api/library/\[id\]/exif/route.test.ts` — expect FAIL.

```typescript
// apps/web/app/api/library/[id]/exif/route.ts
import { NextResponse } from "next/server";
import { getImage } from "../../../../../lib/image-library";
import { readExifSummary } from "../../../../../lib/exif-read";

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const image = getImage(params.id);
  if (!image) {
    return NextResponse.json({ error: "Imagen no encontrada" }, { status: 404 });
  }
  const exif = await readExifSummary(image.bytes);
  return NextResponse.json({ exif });
}
```

Run again: `cd apps/web && npx vitest run app/api/library/\[id\]/exif/route.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 3: Write the widget component (no test — presentational)**

```tsx
// apps/web/app/components/widgets/ExifMetadataWidget.tsx
"use client";
import { useEffect, useState } from "react";
import { InfoTooltip } from "../InfoTooltip";

interface ExifSummary {
  camera: string | null;
  aperture: string | null;
  shutterSpeed: string | null;
  iso: string | null;
  capturedAt: string | null;
  hasGps: boolean;
}

const WARN_ICON = (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#ef9f27" strokeWidth="1.8" strokeLinejoin="round">
    <path d="M12 3.5l9.3 16.5H2.7z" /><line x1="12" y1="10" x2="12" y2="14" /><circle cx="12" cy="17" r=".6" fill="#ef9f27" stroke="none" />
  </svg>
);

export function ExifMetadataWidget({ imageId, estimatedTime }: { imageId: string; estimatedTime: string | null }) {
  const [exif, setExif] = useState<ExifSummary | null>(null);

  useEffect(() => {
    fetch(`/api/library/${imageId}/exif`)
      .then((r) => r.json())
      .then((data) => setExif(data.exif));
  }, [imageId]);

  if (!exif) return <div className="text-[9.5px] text-muted">Cargando metadatos…</div>;

  const exifTimeMismatchesEstimate = Boolean(exif.capturedAt && estimatedTime && exif.capturedAt !== estimatedTime);

  return (
    <div className="grid grid-cols-2 gap-2">
      {exif.camera && (
        <div className="flex items-center gap-1.5" style={{ animation: "jg-fade-rise .4s ease .02s both" }}>
          <span className="text-[9.5px] text-fg">{exif.camera}</span>
        </div>
      )}
      {exif.aperture && (
        <div className="flex items-center gap-1.5" style={{ animation: "jg-fade-rise .4s ease .08s both" }}>
          <span className="text-[9.5px] text-fg">{exif.aperture}</span>
        </div>
      )}
      {exif.shutterSpeed && (
        <div className="flex items-center gap-1.5" style={{ animation: "jg-fade-rise .4s ease .14s both" }}>
          <span className="text-[9.5px] text-fg">{exif.shutterSpeed}</span>
        </div>
      )}
      {exif.iso && (
        <div className="flex items-center gap-1.5" style={{ animation: "jg-fade-rise .4s ease .2s both" }}>
          <span className="text-[9.5px] text-fg">{exif.iso}</span>
        </div>
      )}
      {exif.capturedAt && (
        <div className="flex items-center gap-1.5" style={{ animation: "jg-fade-rise .4s ease .26s both" }}>
          <span className="text-[9.5px] text-fg">{exif.capturedAt}</span>
          {exifTimeMismatchesEstimate && (
            <span className="group relative inline-flex cursor-help">
              {WARN_ICON}
              <span className="pointer-events-none absolute bottom-[135%] left-1/2 z-10 w-max max-w-[190px] -translate-x-1/2 rounded-lg border border-[#ef9f27]/35 bg-panel px-2 py-1.5 text-[9px] leading-[1.4] text-fg opacity-0 shadow-lg shadow-black/45 transition-opacity group-hover:opacity-100">
                El EXIF se puede editar fácilmente y no coincide con la hora estimada por sombras ({estimatedTime})
              </span>
            </span>
          )}
        </div>
      )}
      <div className="col-span-2 flex items-center gap-1.5" style={{ animation: "jg-fade-rise .4s ease .32s both" }}>
        <span className="text-[9.5px] text-muted">{exif.hasGps ? "Datos GPS presentes" : "Sin datos GPS en el archivo"}</span>
      </div>
    </div>
  );
}
```

Add the shared `jg-fade-rise` keyframe once to `apps/web/app/globals.css` (also reused by Task 20):
```css
@keyframes jg-fade-rise { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
```

- [ ] **Step 4: Type-check**

Run: `cd apps/web && npx tsc --noEmit`
Expected: no new errors

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/components/widgets/ExifMetadataWidget.tsx apps/web/app/api/library/\[id\]/exif/route.ts apps/web/app/api/library/\[id\]/exif/route.test.ts apps/web/app/globals.css
git commit -m "feat(web): add ExifMetadataWidget with the EXIF-vs-estimate contradiction warning"
```

---

### Task 20: `EstimatedTimeWidget.tsx` — semicircle sun/moon widget with spin animation

**Files:**
- Create: `apps/web/app/components/widgets/EstimatedTimeWidget.tsx`

**Interfaces:**
- Consumes: `InfoTooltip` from Task 18.
- Produces: `EstimatedTimeWidget({ locked, estimatedHour, onInstall }: { locked: boolean; estimatedHour: number | null; onInstall: () => void })`. `estimatedHour` is a 0–24 float; the widget itself maps it to arc position/color — no model exists yet to produce a real value (`// TODO`).

- [ ] **Step 1: Write the widget component (no test — presentational, matches the approved mockup exactly)**

```tsx
// apps/web/app/components/widgets/EstimatedTimeWidget.tsx
"use client";
import { InfoTooltip } from "../InfoTooltip";

// TODO: sin modelo real todavía; conectar cuando exista un modelo de
// estimación de hora por sombras. Hasta entonces este widget siempre
// llega bloqueado (locked=true) desde su punto de registro en Task 23.

const SUN_ICON = (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
    <path d="M12 3v2M5 5l1.4 1.4M3 12h2M19 12h2M17.6 6.4L19 5M12 19v2" /><circle cx="12" cy="12" r="4" />
  </svg>
);
const LOCK_ICON = (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ animation: "jg-lock-breathe 2.6s ease-in-out infinite" }}>
    <rect x="5" y="11" width="14" height="9" rx="1.5" /><path d="M8 11V7a4 4 0 0 1 8 0v4" />
  </svg>
);

/** Position along the semicircle (0h/24h at the edges, 12h at the apex) and a
 * sun color that warms from yellow (noon) to red/orange (edges). */
function markerFor(hour: number): { x: number; y: number; color: string; isNight: boolean } {
  const cx = 88, cy = 92, r = 80;
  const x = 8 + (hour / 24) * 160;
  const dx = x - cx;
  const y = cy - Math.sqrt(Math.max(r * r - dx * dx, 0));
  const distFromNoon = Math.abs(hour - 12) / 12; // 0 at noon, 1 at the edges
  const color = distFromNoon < 0.5
    ? "#f2c94c"
    : distFromNoon < 0.8 ? "#e8863c" : "#d9432e";
  return { x, y, color, isNight: hour < 5 || hour > 19 };
}

function SunGlyph({ cx, cy, color }: { cx: number; cy: number; color: string }) {
  const angles = [0, 45, 90, 135, 180, 225, 270, 315];
  return (
    <g>
      <circle cx={cx} cy={cy} r={9} fill={color} opacity={0.15} />
      <g fill={color}>
        {angles.map((a) => (
          <rect key={a} x={cx - 0.9} y={cy - 10.2} width={1.8} height={3.2} rx={0.9} transform={`rotate(${a} ${cx} ${cy})`} />
        ))}
      </g>
      <circle cx={cx} cy={cy} r={5} fill={color} />
    </g>
  );
}

function MoonGlyph({ cx, cy }: { cx: number; cy: number }) {
  return (
    <g>
      <circle cx={cx} cy={cy} r={9} fill="#e8e8e6" opacity={0.1} />
      <circle cx={cx} cy={cy} r={6.5} fill="#e8e8e6" />
      <circle cx={cx + 3} cy={cy - 3} r={5.6} fill="#0e0f11" />
    </g>
  );
}

export function EstimatedTimeWidget({
  locked, estimatedHour, onInstall,
}: {
  locked: boolean;
  estimatedHour: number | null;
  onInstall: () => void;
}) {
  const hour = estimatedHour ?? 16.4;
  const marker = markerFor(hour);
  const label = `${String(Math.floor(hour)).padStart(2, "0")}:${String(Math.round((hour % 1) * 60)).padStart(2, "0")}`;

  return (
    <div className="relative overflow-hidden rounded-lg">
      <div className={locked ? "blur-[4px] opacity-50" : undefined}>
        <div className="mb-2 flex items-center gap-1.5">
          {SUN_ICON}
          <span className="flex-1 text-[10.5px] font-medium text-fg">Hora estimada</span>
          <InfoTooltip text="Estimado a partir del largo y dirección de las sombras visibles en la foto" />
        </div>
        <svg
          width="160" height="90" viewBox="0 0 176 100" style={{ display: "block", margin: "0 auto" }}
        >
          <g style={{ transformOrigin: "88px 92px", animation: locked ? undefined : "jg-plane-spin 1.3s cubic-bezier(.2,.85,.35,1) both" }}>
            <path d="M8 92 A80 80 0 0 1 168 92" fill="none" stroke="rgba(255,255,255,.15)" strokeWidth={1.8} />
            {marker.isNight ? <MoonGlyph cx={marker.x} cy={marker.y} /> : <SunGlyph cx={marker.x} cy={marker.y} color={marker.color} />}
          </g>
        </svg>
        <div className="mt-0.5 text-center text-[20px] font-semibold text-fg">{label}</div>
      </div>
      {locked && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[#0e0f11]/35">
          <div className="flex h-[26px] w-[26px] items-center justify-center rounded-full border border-white/35">
            {LOCK_ICON}
          </div>
          <button
            onClick={onInstall}
            className="rounded-lg bg-accent px-2.5 py-1.5 text-[9.5px] font-medium text-black transition-transform hover:scale-105 active:scale-90"
          >
            Instalar Hora estimada
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Add the remaining shared keyframes to `apps/web/app/globals.css`**

```css
@keyframes jg-plane-spin { from { transform: rotate(-540deg); } to { transform: rotate(0deg); } }
@keyframes jg-lock-breathe { 0%, 100% { opacity: .7; transform: scale(1); } 50% { opacity: 1; transform: scale(1.06); } }
```

- [ ] **Step 3: Type-check**

Run: `cd apps/web && npx tsc --noEmit`
Expected: no new errors

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/components/widgets/EstimatedTimeWidget.tsx apps/web/app/globals.css
git commit -m "feat(web): add EstimatedTimeWidget (semicircle sun/moon, locked placeholder)"
```

---

### Task 21: `WeatherEstimateWidget.tsx` + `DetectedObjectsWidget.tsx` — locked stubs

**Files:**
- Create: `apps/web/app/components/widgets/WeatherEstimateWidget.tsx`
- Create: `apps/web/app/components/widgets/DetectedObjectsWidget.tsx`

**Interfaces:**
- Consumes: `InfoTooltip` from Task 18.
- Produces: `WeatherEstimateWidget({ onInstall }: { onInstall: () => void })`; `DetectedObjectsWidget({ onInstall }: { onInstall: () => void })` — both always render `locked` (no `locked` prop needed, since neither has a real model yet).

- [ ] **Step 1: Write `WeatherEstimateWidget.tsx` (no test — presentational)**

```tsx
// apps/web/app/components/widgets/WeatherEstimateWidget.tsx
"use client";
import { InfoTooltip } from "../InfoTooltip";

// TODO: sin modelo real todavía; conectar cuando exista un modelo de
// estimación de clima a partir de iluminación/sombras/elementos visibles.

const WEATHER_ICON = (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
    <circle cx="9" cy="10" r="4" /><path d="M9 2v1.5M15.5 5l-1 1.3M2 10h1.5M4 5l1 1.3" /><path d="M5 18a4 4 0 0 1 4-4h6a3.5 3.5 0 0 1 0 7H8a3 3 0 0 1-3-3z" />
  </svg>
);
const LOCK_ICON = (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ animation: "jg-lock-breathe 2.6s ease-in-out infinite" }}>
    <rect x="5" y="11" width="14" height="9" rx="1.5" /><path d="M8 11V7a4 4 0 0 1 8 0v4" />
  </svg>
);

export function WeatherEstimateWidget({ onInstall }: { onInstall: () => void }) {
  return (
    <div className="relative overflow-hidden rounded-lg">
      <div className="blur-[4px] opacity-50">
        <div className="mb-2.5 flex items-center gap-1.5">
          {WEATHER_ICON}
          <span className="flex-1 text-[10.5px] font-medium text-fg">Clima estimado</span>
          <InfoTooltip text="Estimado a partir de la iluminación, sombras y elementos visibles en la foto" />
        </div>
        <div className="text-center text-[18px] font-semibold text-fg">18–22°C</div>
        <div className="mt-0.5 text-center text-[9.5px] text-muted">Despejado, luz diurna</div>
      </div>
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[#0e0f11]/35">
        <div className="flex h-[26px] w-[26px] items-center justify-center rounded-full border border-white/35">{LOCK_ICON}</div>
        <button
          onClick={onInstall}
          className="rounded-lg bg-accent px-2.5 py-1.5 text-[9.5px] font-medium text-black transition-transform hover:scale-105 active:scale-90"
        >
          Instalar Clima estimado
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Write `DetectedObjectsWidget.tsx` (no test — presentational)**

```tsx
// apps/web/app/components/widgets/DetectedObjectsWidget.tsx
"use client";
import { InfoTooltip } from "../InfoTooltip";

// TODO: sin modelo real todavía; conectar cuando exista un modelo de
// reconocimiento de objetos entrenado sobre escenas urbanas.

const OBJECTS_ICON = (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
    <path d="M20.6 9.5L14 3H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h9l6.6-6.5a2 2 0 0 0 0-2.83l-1.4-1.4a2 2 0 0 0-2.6-.13z" /><circle cx="8" cy="15" r="1.2" />
  </svg>
);
const LOCK_ICON = (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ animation: "jg-lock-breathe 2.6s ease-in-out infinite" }}>
    <rect x="5" y="11" width="14" height="9" rx="1.5" /><path d="M8 11V7a4 4 0 0 1 8 0v4" />
  </svg>
);

export function DetectedObjectsWidget({ onInstall }: { onInstall: () => void }) {
  return (
    <div className="relative overflow-hidden rounded-lg">
      <div className="blur-[4px] opacity-50">
        <div className="mb-2.5 flex items-center gap-1.5">
          {OBJECTS_ICON}
          <span className="flex-1 text-[10.5px] font-medium text-fg">Objetos detectados</span>
          <InfoTooltip text="Detectado por un modelo de reconocimiento de objetos entrenado sobre escenas urbanas" />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {["farola", "acera", "buzón", "+4 más"].map((tag) => (
            <span key={tag} className="rounded-full border border-white/[.15] px-1.5 py-0.5 text-[9px] text-fg">{tag}</span>
          ))}
        </div>
      </div>
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[#0e0f11]/35">
        <div className="flex h-[26px] w-[26px] items-center justify-center rounded-full border border-white/35">{LOCK_ICON}</div>
        <button
          onClick={onInstall}
          className="rounded-lg bg-accent px-2.5 py-1.5 text-[9.5px] font-medium text-black transition-transform hover:scale-105 active:scale-90"
        >
          Instalar Objetos detectados
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Type-check**

Run: `cd apps/web && npx tsc --noEmit`
Expected: no new errors

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/components/widgets/WeatherEstimateWidget.tsx apps/web/app/components/widgets/DetectedObjectsWidget.tsx
git commit -m "feat(web): add WeatherEstimateWidget and DetectedObjectsWidget locked placeholders"
```

---

### Task 22: `ModelLoadNotification.tsx` — unified loading toast, delete `ModelLoadingNotice.tsx`

**Files:**
- Create: `apps/web/app/components/ModelLoadNotification.tsx`
- Delete: `apps/web/app/components/ModelLoadingNotice.tsx`
- Modify: every call site of `ModelLoadingNotice` (find via grep in Step 1)

**Interfaces:**
- Produces: `ModelLoadNotification({ active, label, thumbnailUrl }: { active: boolean; label: string; thumbnailUrl: string | null })` — polls `GET /api/model-status` exactly like the component it replaces, but renders as a bottom-right stacking toast with a photo thumbnail instead of an inline bar.

- [ ] **Step 1: Find every call site of the component being removed**

Run: `grep -rn "ModelLoadingNotice" apps/web --include="*.tsx"`

- [ ] **Step 2: Write `ModelLoadNotification.tsx`, keeping the exact same polling logic as `ModelLoadingNotice.tsx`**

```tsx
// apps/web/app/components/ModelLoadNotification.tsx
"use client";
import { useEffect, useState } from "react";

const LABEL: Record<"retrieval" | "verification", string> = {
  retrieval: "Lumi Preview",
  verification: "Laila",
};

/**
 * Replaces ModelLoadingNotice.tsx's inline sweeping-stripe bar with a
 * bottom-right stacking toast (spec §6.3) — same polling contract (only
 * shows when services/inference's real _loading_kind says a model is
 * actually loading, never a timeout guess), different presentation:
 * a small photo thumbnail instead of a text-heavy description.
 */
export function ModelLoadNotification({ active, thumbnailUrl }: { active: boolean; thumbnailUrl: string | null }) {
  const [loading, setLoading] = useState<"retrieval" | "verification" | null>(null);

  useEffect(() => {
    if (!active) {
      setLoading(null);
      return;
    }
    let cancelled = false;
    async function poll() {
      try {
        const res = await fetch("/api/model-status");
        const data: { loading: "retrieval" | "verification" | null } = await res.json();
        if (!cancelled) setLoading(data.loading);
      } catch {
        // keep the previous value rather than flicker on a transient network hiccup
      }
    }
    poll();
    const interval = setInterval(poll, 1500);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [active]);

  if (!active || !loading) return null;

  return (
    <div
      className="flex w-[210px] items-center gap-2.5 rounded-lg border border-white/[.12] bg-panel/[.97] p-2 shadow-lg shadow-black/40"
      style={{ animation: "jg-toast-in .35s cubic-bezier(.2,.85,.35,1) both" }}
    >
      <div
        className="h-9 w-9 shrink-0 rounded-md bg-cover bg-center"
        style={thumbnailUrl ? { backgroundImage: `url(${thumbnailUrl})` } : { background: "linear-gradient(135deg,#2a3038,#14171a)" }}
      />
      <div className="min-w-0 flex-1">
        <div className="text-[10px] font-medium text-fg">{LABEL[loading]}</div>
        <div className="mt-1.5 h-[3px] overflow-hidden rounded-full bg-white/[.08]">
          <div className="h-full w-2/5 rounded-full bg-fg/60" style={{ animation: "lumi-shimmer 1.6s ease-in-out infinite" }} />
        </div>
      </div>
    </div>
  );
}
```

Add a container for stacking these toasts — since multiple can appear at once (spec §6.3), the simplest approach that doesn't require a new global store is to render `ModelLoadNotification` instances inside a single fixed-position wrapper wherever the app's root layout renders persistent UI. Check `apps/web/app/components/AppShell.tsx` (or the root layout) for where `ModelLoadingNotice` sites currently live relative to it, and add:
```tsx
<div className="fixed bottom-4 right-4 z-40 flex flex-col gap-2">
  {/* one <ModelLoadNotification /> per active load, replacing each ModelLoadingNotice call site found in Step 1 */}
</div>
```

- [ ] **Step 3: Migrate each call site found in Step 1**

For each file found by the Step 1 grep (expected: `ResultRow` inside `ResultsPanel.tsx`, and any other site), replace:
```tsx
<ModelLoadingNotice active={refining && Boolean(selected)} />
```
with the new component, moved into the shared bottom-right wrapper described above rather than left inline in the row — pass through the same `active` condition, plus a `thumbnailUrl` sourced from whatever query-image URL is already available at that call site (e.g. `queryImageUrl` in `ResultsPanel.tsx`'s scope).

- [ ] **Step 4: Delete the old component**

```bash
git rm apps/web/app/components/ModelLoadingNotice.tsx
```

- [ ] **Step 5: Add the remaining shared keyframe**

```css
/* apps/web/app/globals.css */
@keyframes jg-toast-in { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
```
(`lumi-shimmer` already exists in `globals.css` — reused by name above, no duplicate keyframe needed.)

- [ ] **Step 6: Type-check**

Run: `cd apps/web && npx tsc --noEmit`
Expected: no errors (no remaining references to the deleted component)

- [ ] **Step 7: Commit**

```bash
git add apps/web/app/components/ModelLoadNotification.tsx apps/web/app/components/ResultsPanel.tsx apps/web/app/globals.css
git commit -m "feat(web): replace ModelLoadingNotice with a unified bottom-right ModelLoadNotification toast"
```

---

### Task 23: `ResultsPanel.tsx` migration to the widget grid system

**Files:**
- Modify: `apps/web/app/components/ResultsPanel.tsx`

**Interfaces:**
- Consumes: `WidgetGrid`/`Widget` from Task 18, `ExifMetadataWidget` from Task 19, `EstimatedTimeWidget` from Task 20, `WeatherEstimateWidget`/`DetectedObjectsWidget` from Task 21, `RETRIEVAL_MODELS`/model-install-state (reuse whatever mechanism the existing model catalog uses to know if a model is "installed" — check `apps/web/lib/model-catalog/*` for the exact function before wiring `EstimatedTimeWidget`'s `locked` prop, since spec §6.2 requires it to flip from "Instalar" to "Lanzar" based on real install state, not a hardcoded `true`).

- [ ] **Step 1: Read the current file in full to confirm nothing changed since this session's earlier read**

Run: `cat apps/web/app/components/ResultsPanel.tsx`

- [ ] **Step 2: Wrap the existing geolocation results as the first `Widget` entry, and register the four widgets from Tasks 19–21**

Replace the component's outer `return` (the `<div className="flex h-full w-80 ...">...</div>` block) with a call to `WidgetGrid`, keeping every existing piece (`ResultRow`, `RefinedCandidateCard`, the header with `queryImageUrl`/`queryImageName`) exactly as-is, just moved inside the geolocation widget's `render()`:

```tsx
import { WidgetGrid } from "./WidgetGrid";
import type { Widget } from "./widgets/types";
import { ExifMetadataWidget } from "./widgets/ExifMetadataWidget";
import { EstimatedTimeWidget } from "./widgets/EstimatedTimeWidget";
import { WeatherEstimateWidget } from "./widgets/WeatherEstimateWidget";
import { DetectedObjectsWidget } from "./widgets/DetectedObjectsWidget";

const GEO_ICON = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
    <circle cx="12" cy="12" r="9" /><path d="M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18M3 12h18" />
  </svg>
);
const EXIF_ICON = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="8.5" cy="9.5" r="1.4" /><path d="M21 16l-5-5a2 2 0 0 0-2.8 0L4 20" />
  </svg>
);
```

Inside `ResultsPanel`'s body, build the widgets array and render it in place of the old top-level `<div>`:

```tsx
  const geoWidget: Widget = {
    id: "geolocation",
    title: "Geolocalización",
    icon: GEO_ICON,
    colSpan: 2,
    locked: false,
    defaultExpanded: true,
    render: () => (
      <>
        {confirmed && currentSearchId && <RefinedCandidateCard searchId={currentSearchId} candidate={confirmed} />}
        <div className="text-xs text-muted">
          {all.length} candidatos{all.every((c) => c.status !== "confirmed") ? " (sin verificar)" : ""}
        </div>
        {all.map((c) => (
          <ResultRow key={c.id} c={c} onRefine={onRefine} onSelectRegion={onSelectRegion} refining={refining} />
        ))}
      </>
    ),
  };

  const exifWidget: Widget | null = currentImageId
    ? {
        id: "exif",
        title: "Metadatos EXIF",
        icon: EXIF_ICON,
        colSpan: 4,
        locked: false,
        defaultExpanded: true,
        render: () => <ExifMetadataWidget imageId={currentImageId} estimatedTime={null} />,
      }
    : null;

  const estimatedTimeWidget: Widget = {
    id: "estimated-time",
    title: "Hora estimada",
    icon: <span />,
    colSpan: 1,
    locked: true,
    defaultExpanded: false,
    render: () => <EstimatedTimeWidget locked={true} estimatedHour={null} onInstall={() => { /* wired once a real model exists */ }} />,
  };

  const weatherWidget: Widget = {
    id: "weather",
    title: "Clima estimado",
    icon: <span />,
    colSpan: 1,
    locked: true,
    defaultExpanded: false,
    render: () => <WeatherEstimateWidget onInstall={() => {}} />,
  };

  const objectsWidget: Widget = {
    id: "objects",
    title: "Objetos detectados",
    icon: <span />,
    colSpan: 1,
    locked: true,
    defaultExpanded: false,
    render: () => <DetectedObjectsWidget onInstall={() => {}} />,
  };

  const widgets = [geoWidget, exifWidget, estimatedTimeWidget, weatherWidget, objectsWidget].filter(
    (w): w is Widget => w !== null
  );

  return <WidgetGrid widgets={widgets} />;
```

**Note for the implementer:** `currentImageId` (the library id of the currently-searched image, needed by `ExifMetadataWidget`) does not exist yet on `useSearchStore` or in this component's props — check whether `SearchDashboard.tsx` (Task 17) already threads a library image id down to `ResultsPanel` by this point; if not, add a `currentImageId: string | null` field to `useSearchStore` (same pattern as Task 12's `batchProgress`) and set it wherever `queryImageName`/`queryImageUrl` are currently set, since they're set at the same moment (right after a search starts).

- [ ] **Step 3: Type-check**

Run: `cd apps/web && npx tsc --noEmit`
Expected: no new errors

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/components/ResultsPanel.tsx
git commit -m "feat(web): migrate ResultsPanel to the modular bento widget grid"
```

---

## Self-Review Notes

**Spec coverage:** §2.1 (Task 2), §2.2 (Task 1), §2.3 (Task 3), §2.4 (Tasks 9–12, 17), §3 (Task 13), §4.1 (Task 14), §4.2 (Tasks 15–16), §4.3 (Task 17), §5 (Task 15), §6.1 (Task 18, 23), §6.2 (Tasks 20–21, 23), §6.3 (Task 22), §6.4 (Tasks 19–21), §7 animations (embedded across Tasks 13, 15, 19–22 rather than a separate task, since each animation is inseparable from the component that uses it), §8 file list (fully covered), §9 testing (every pure module has a matching `.test.ts`; every `.tsx` deliberately has none, per Global Constraints).

**Placeholder scan:** The only `TODO`-style comments are the three intentionally-scaffolded widgets (`EstimatedTimeWidget`, `WeatherEstimateWidget`, `DetectedObjectsWidget`), explicitly sanctioned by the Global Constraints — not a plan defect.

**Type consistency:** `LibraryImage`/`LibraryImageSummary` used consistently from Task 2 through Tasks 5–7, 11, 13, 17, 19. `AnalyzeImageBatchJobPayload`/`ANALYZE_IMAGE_BATCH_JOB_NAME` consistent from Task 9 through 10–11. `Widget`/`WidgetGrid` consistent from Task 18 through 20–23. `batchProgress` shape (`{ done, total, failed }`) consistent between Task 12's store and Task 17's SSE handler.

**Known follow-ups flagged inline for the task reviewer, not swept under the rug:** Task 10 Step 10's worker→web HTTP dependency on Task 11 landing first (execute Task 11 before or immediately after Task 10, not much later); Task 17 Step 4's `selected[index].file.name`-as-library-id fragility for locally-picked files not yet in the library; Task 23's `currentImageId` threading gap, to be resolved by checking Task 17's actual implementation once it lands.

## Execution Handoff

Executing via superpowers:subagent-driven-development. Progress tracked in `.superpowers/sdd/progress.md` under "Plan: upload-redesign".
