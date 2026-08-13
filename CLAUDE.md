# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Lumi Station v2: a complete rewrite of Lumi, a self-hosted image-geolocation tool for forensic
investigation ("give it a photo, it tells you where it was taken"). Two independent halves:

- **Lumi Station** (`crates/lumid`, `crates/lumi-cli`, `client/`) — the investigator-facing
  product: a Tauri desktop client paired over TLS to a Rust daemon (`lumid`) that the server
  owner installs on their own GPU box.
- **Lumi Indexer** (`indexer/`, `crates/lumi-index`) — a *separate*, single-operator Tauri app
  with no accounts/server, used to build the geo-referenced image corpus (`.lumidx` packages)
  the inference engine will eventually search. Does not talk to `lumid` or the client at all;
  shares only `client/src/ui` (visual vocabulary) and the pure-logic `lumi-index` crate.

The v1 (old Next.js monorepo) lives at `E:\Lumi` — a separate directory, not this repo. v2 is a
from-scratch rewrite, not a migration, except that the wizard/map visual style is deliberately
kept near-identical to v1 by explicit owner decision (see DESIGN.md).

Full context: [PRODUCT.md](PRODUCT.md) (users, tone, anti-references), [DESIGN.md](DESIGN.md)
(tokens/motion/prohibitions), [ARCHITECTURE.md](ARCHITECTURE.md) (the authoritative deep dive —
read this first for anything cross-cutting), [FUTURO.md](FUTURO.md) (deferred work), per-subsystem
specs/plans under `docs/superpowers/{specs,plans}/`.

## Commands

```bash
# Lumi Station: daemon + Tauri client together (fixed port 7717)
python tools/build.py

# Lumi Indexer alone (no daemon involved — it's autonomous)
python tools/build.py indexer

# Package both for release
python tools/build.py build

# Rust workspace (lumi-proto, lumi-index, lumid, lumi-cli — client/src-tauri and
# indexer/src-tauri are separate Cargo projects excluded from the workspace)
cargo build
cargo test -p lumi-proto        # only crate with tests: key, crypto, caps

# Frontends (client/ and indexer/ are independent npm projects, same scripts)
cd client && npm install && npm run dev     # Vite only, browser at :5173 — no Tauri invoke()
cd client && npm run tauri dev              # full native window, needs WebView2 + MSVC C++ tools
cd client && npm run build                  # tsc -b && vite build
cd client && npm run lint                   # oxlint
# same for indexer/
```

No test suite beyond `lumi-proto`: **no tests unless explicitly requested** (see Conventions).

On Windows, `lumid` runs fine (TLS/SQLite/queue/telemetry are OS-agnostic) but `lumi install`
deliberately fails the systemd check, and the task runner fails spawning `/bin/sh` — both are
correct guard behavior, not bugs. Test the install flow itself only in WSL/Linux with systemd.

Redis and Qdrant (see Architecture below) don't ship official Windows binaries; the Indexer's
settings panel has a "Levantar en WSL" button that installs/adopts them inside WSL and forwards
`localhost`. This is a dev convenience, not the supported install path — real indexing runs
inside WSL entirely, since the embedding worker also needs its Python venv there.

## Architecture

### Workspace layout

```
crates/lumi-proto      pairing-key format, protocol/API types, crypto — shared by daemon+CLI+client
crates/lumid           the daemon: TLS, HTTP API (routes/), task runner, queue (queue/), encryption
crates/lumi-cli        `lumi` binary: install, uninstall, key reissue, status
crates/lumi-index      pure logic (no GPU/services/window) shared by the Indexer: manifest, tiles,
                       vectors, coverage, budget, embed, streets, network, legacy-import
client/                Lumi Station's Tauri v2 + React + Tailwind app
  src-tauri/            fingerprint verification, SSE bridge to lumid
  src/                  wizard, admin, work (projects/cases/map), dev harness
indexer/               Lumi Indexer's Tauri v2 + React + Tailwind app (independent npm project)
  src-tauri/            origins/ (network adapters), download, ingest, queue, territory, qdrant,
                        keys/crypto, package (.lumidx read/write), probe, review, spend
  src/                  catalog, download, ingest, review, seal, settings, territory
workers/               Python inference workers — the Rust↔Python boundary is explicit:
                       lumi_worker.py (reference geolocation stub), lumi_embed.py (embedding)
registros/             modelos, verificadores, niveles y agentes — datos, no código. `registros/geo/`
                       trae además los datasets offline (países, Köppen) que los agentes que filtran
                       necesitan; se publican ausentes y sin ellos el agente se abstiene
tools/build.py          dev orchestration (see Commands)
tools/package.py        zips everything not excluded by .gitignore
```

`lumi-proto` is why the daemon is Rust: pairing-key format, cert fingerprint, protocol types and
envelope encryption are defined once and compiled into daemon, CLI, and client — a serialization
mismatch between client and server doesn't compile, rather than surfacing as a runtime bug.

### Storage: three databases, not the same three on both sides

| DB | Holds | Where |
|---|---|---|
| SQLite | Everything relational; the source of truth; survives a power cut | Station and Indexer |
| Qdrant | Vectors, one collection per `(model, version)` — chosen because pgvector caps HNSW/ivfflat at 2000 dims and these models run 8448–12288 | Station and Indexer |
| Redis | Queues and hot state only — live progress, in-flight counters | **Indexer only** |

Station's queue (subsystem 4) lives entirely in SQLite and stays there — subsystem 5 gave
Station a corpus to search (Qdrant) but deliberately did not bring Redis along: it would mean
installing, watching, and explaining a service nobody would use, since the queue already has
its "doorbell" pattern without one. **Redis is the doorbell, SQLite is the truth** remains the
rule inside the Indexer, where it does exist: if Redis is wiped, only the progress bar is lost —
work is reconstructed from SQLite. Never persist per-job progress; it's retransmitted over SSE
and forgotten. In the Indexer specifically, the queue rebuilds from SQLite by checking which
images still lack a vector.

### Trust & transport (Lumi Station)

Pairing key: `lumi1_<host:port>_<fingerprint>_<secret>` — self-signed TLS, fingerprint pinned
inside the out-of-band key. Client compares the live cert fingerprint against the key; mismatch
means **abort**, no "trust anyway" dialog (that's the MITM's entry point). Server card (no
secret, not consumed): `lumi1s_<host:port>_<fingerprint>` for pre-auth verified connection.
Fingerprint = SHA-256(DER) truncated to 128 bits, base58. Secret = 160 bits, base58, single-use,
24h expiry, Argon2id-hashed server-side.

Server states: `UNCLAIMED → CLAIMED → PROVISIONING → READY`, orthogonal `LOCKED` (sealed master
key, survives restart, telemetry stays alive to prove the box is healthy) and `MAINTENANCE`.

Capability matrix: every capped capability travels with a human-readable `reason` — the UI shows
disabled features with the real cause, never hides them. Single source of truth; apply this
pattern anywhere something is disabled in either app.

### Queue & scheduling (Lumi Station subsystem 4, done)

One worker per device (GPU, or CPU if none) starts with the daemon and stays warm between jobs.
Scheduling order: drop what can't run (owner blocked / owner disconnected without
`background_jobs` / owner at `max_concurrent`), then sort by connected-before-background,
`queue_priority`, arrival. **Work already running is never canceled** — `DELETE` on an
in-progress analysis/image returns 409. `GET /v1/queue/events` (SSE, any session — being
connected to it counts as "connected") and `GET /v1/queue` (admin) are the read surface.
`limits::effective` is the one legitimate way to read per-user limits — never read the `limits`
table directly, or the global/override precedence gets duplicated and desyncs (this is the
boundary the queue and the projects subsystem must respect).

### Indexer specifics

`.lumidx` package layout: `manifiesto.json` (provenance for *both* images and work),
`indice.db` (SQLite), `cobertura.json` (z14 tile coverage + hash), `fragmentos/<quadkey
z14>/<modelo>-<version>.{b1,i8}` (binary/int8 vectors), `imagenes/`, `SHA256SUMS`. Sealing is
irreversible and refuses to succeed if `indice.db` rows don't match each model's vectors — a
half-sealed package is worse than none. Opening always verifies every file hash first; no
"open anyway". Before spending provider quota or GPU time, every z14 tile in a drawn area is
classified `local` / `catálogo` / `nueva`; an area fully covered offers to install what exists
rather than showing a disabled "index" button.

El `.lumidx` **publicado** es ese mismo formato partido para viajar: la ficha (`ficha.json`)
va **en claro** —firmada Ed25519, kilobytes, y es lo que resuelve buscador, cobertura, reclamo
y dependencias sin descargar nada—, y los cuerpos y las capas van cifrados con AES-256-GCM,
que es ofuscación frente al alojamiento y **no control de acceso**: la clave viaja en la propia
ficha. Los cuerpos se trocean por grupos de quadkeys (tope 1 800 000 000 bytes por asset) y la
ficha se sube **la última**, para que una subida cortada sea invisible en vez de un índice a
medias. La ficha caduca a los 90 días: un reclamo abandonado no bloquea territorio para siempre.

`indexer/src-tauri/src/origins/` holds one adapter per network source behind a per-tile contract
(Mapillary, KartaView, Google, Mapbox Satellite, Commons, Flickr) — subsystem 7b.

### Rust↔Python boundary

JSON-lines over a child process's stdio. Types live in `lumi-proto::worker`. The worker only
embeds: it writes a query image's vector to a temp file and answers with the path
(`workers/lumi_geo.py`, subsystem 5a's default); the daemon (`lumid::recuperar`, on top of
`lumi_index::agrupar`) queries Qdrant, groups candidates by tile neighborhood, and attributes
each hypothesis to its index and author — that part had to move to Rust because provenance
lives in SQLite, which the Python worker doesn't have. `workers/lumi_worker.py` remains a valid
reference for a worker that resolves on its own (no candidates, no alternatives) instead of only
embedding; both scripts are executable specs, not docs — whoever writes a real inference engine
reads them.

### Subsystem status (see ARCHITECTURE.md §5 for the full table and ordering rationale)

Order: `1 (install/pairing) → 2 (auth) → 6 (client/projects skeleton) → 4 (queue) → 7a (indexer
foundations) → 7b (indexer network origins) → 8 (index catalog) → 5 (inference engine) → 3 (admin
panel) → 9 (website)`. 1/2/4/7a/7b/8 done; 6 is skeleton-only (no reverse geocoding, no project
ownership transfer — see FUTURO.md); 5 is **5-0, 5a, 5b and 5c done** (real models, retrieval
ensemble, competing geometric verifiers, and the agents) **with 5d pending** (annotating the corpus
with capture dates so season and time-of-day can filter instead of only describing); 3/9 not
started.

## Conventions

From `workflow/PROJECT-CONVENTIONS.md`, as they apply here:

- **No tests unless explicitly requested.** The one exception already in place:
  `cargo test -p lumi-proto` for non-trivial logic (key, crypto, capability matrix). Don't add
  tests for mechanical code.
- **One commit per finished feature**, not intermediate commits.
- **`ponytail` governs the code**: simplest solution that works. A deliberate simplification
  gets a `// ponytail:` comment naming the ceiling it hit and the way out (see
  `crates/lumi-index/src/legacy.rs` or `tools/build.py` for examples of this in practice).
  Load `.claude/skills/ponytail/` when in doubt.
- **Design**: propose 2-3 directions before committing to one; anti-slop filter always on
  (`.claude/skills/impeccable/`) — no icons in colored boxes, purple-blue gradients, stacked
  cards, glow pill buttons. DESIGN.md's Prohibitions section is the authoritative list; it's
  dark-theme-only (no light mode), no green anywhere ("done" is white), mono font for anything
  machine-produced (IPs, ports, fingerprints, timestamps, logs).
- **Fixed port per project** (7717 for `lumid`), not configurable by env.
- Hand-drawn SVG icons only, no icon library — see DESIGN.md for the exact stroke/viewBox
  pattern and the canonical icon set to reuse rather than redraw.
- Spanish is the working language for docs, specs, UI copy, and code comments in this repo.
