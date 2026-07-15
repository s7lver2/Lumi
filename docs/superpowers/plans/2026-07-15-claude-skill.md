# Claude Skill for API Interaction (Epic D) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `.claude/skills/lumi-geolocate/SKILL.md` so Claude Code, when a user hands over a photo and asks where it was taken, calls Lumi's own estimate → refine → results API end-to-end and hands back a real `/results/{searchId}` link instead of raw coordinates.

**Architecture:** A single Markdown skill file, no custom scripts — every HTTP call in its instructions is a plain `curl` command (multipart upload for estimate, JSON POST + SSE read for refine), since `curl` already handles both natively. No server-side code changes; this is purely additive documentation-as-a-skill.

**Tech Stack:** Claude Code skill (Markdown + YAML frontmatter) — no runtime dependency of its own.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-15-claude-skill-design.md` — read it before starting.
- No code, no scripts — the entire deliverable is one Markdown file.
- Hardcodes today's exact endpoint paths (`/api/models/lumi-preview/...`) rather than discovering them dynamically via `GET /api/models` — an explicit, disclosed scope decision from the spec, not something to "fix" during implementation.
- Requires Epic A (`docs/superpowers/plans/2026-07-14-api-first-architecture.md`) to actually be implemented before this skill's instructions work end-to-end against a real instance — this plan creates the skill file regardless, since the file itself has no dependency on Epic A's code existing yet, only its *use* does.
- All skill copy is in Spanish, matching the rest of the app's user-facing text and this spec's own body.

---

### Task 1: `lumi-geolocate` skill file

**Files:**
- Create: `.claude/skills/lumi-geolocate/SKILL.md`

**Interfaces:**
- Produces: a Claude Code skill discoverable via its `name`/`description` frontmatter — no other task depends on this, it's the entire deliverable.

- [ ] **Step 1: Write the file**

```markdown
---
name: lumi-geolocate
description: Use when the user shares a photo and asks where it was taken, or otherwise wants Lumi's own street-view geolocation pipeline run against an image. Requires a running local Lumi instance (default http://localhost:3000).
---

## Cómo usar esta skill

Base URL por defecto: `http://localhost:3000` (instancia local de Lumi). Si el usuario menciona otro host/puerto, úsalo en su lugar.

1. **Si la imagen es una URL**, descárgala primero a un archivo temporal:
   `curl -s -o /tmp/lumi-query.jpg "<url>"`

2. **Estimación** — sube la imagen:
   `curl -s -X POST http://localhost:3000/api/models/lumi-preview/estimate -F "image=@<ruta-local>"`
   Responde JSON `{ searchId, regions, candidatesByRegion }`. Elige la región con mayor `aggregateScore` (no asumas que es la primera del array — compara explícitamente).

3. **Refinamiento** — envía esa región:
   `curl -N -s -X POST http://localhost:3000/api/models/lumi-preview/refine -H "Content-Type: application/json" -d '{"searchId":"<searchId>","regionId":"<regionId>"}'`
   Esto es un stream SSE — puede tardar varios minutos (la verificación geométrica es ~10-25s por candidato). Antes de ejecutarlo, avisa al usuario de que puede tardar. La salida son líneas `data: {...}`; el resultado final es el evento con `"type":"done"`, que trae `result.candidates` ya repuntuados por verificación.

4. **Mostrar el resultado** — construye `http://localhost:3000/results/<searchId>` y entrégasela al usuario (como enlace, o incrustada si el cliente lo soporta) en vez de solo volcar coordenadas en crudo. Menciona también el candidato ganador (lugar aproximado, % de confianza) en texto, ya que no todo cliente puede seguir un enlace.

## Errores comunes

- **No hay respuesta en `http://localhost:3000`**: Lumi no está corriendo. Dile al usuario que arranque la app (`python3 tools/build.py` en desarrollo, o el ejecutable instalado) y reintenta.
- **`estimate` devuelve `404`/`409`**: el modelo indicado no existe o no es el activo ahora mismo — vuelve a consultar `GET /api/models` para ver cuál es el modelo activo real y usa ese id.
- **`regions` vacío**: no se encontró ninguna coincidencia. Dile esto directamente al usuario, no inventes un resultado.
- **El evento SSE final es `{"type":"error", ...}`**: el refinamiento falló (servicio de inferencia caído, etc.) — muestra `message` al usuario, no reintentes en bucle automáticamente.
```

- [ ] **Step 2: Verify the frontmatter parses as valid YAML**

Run: `python3 -c "import yaml, sys; content = open('.claude/skills/lumi-geolocate/SKILL.md').read(); frontmatter = content.split('---')[1]; d = yaml.safe_load(frontmatter); assert d['name'] == 'lumi-geolocate'; assert 'description' in d; print('OK', d)"`
Expected: prints `OK {'name': 'lumi-geolocate', 'description': '...'}` with no traceback. (If `pyyaml` isn't installed in whatever Python this runs, `pip install --user pyyaml` first — this is a one-off check, not a new project dependency.)

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/lumi-geolocate/SKILL.md
git commit -m "feat: add lumi-geolocate Claude skill for the estimate/refine/results API"
```

- [ ] **Step 4: Manual verification (once Epic A is actually implemented)**

With a real local Lumi instance running and at least one indexed area, ask Claude (in a session with this skill available — i.e. Claude Code opened with this repo as a working directory) "¿de dónde es esta foto?" attaching a real image from an already-indexed area. Confirm it: calls `estimate`, picks the highest-`aggregateScore` region, warns the user before calling `refine` (SSE, can take minutes), and ends by handing back a working `http://localhost:3000/results/{searchId}` link naming the winning candidate and its confidence — not raw coordinates. This step can't run today (Epic A's endpoints don't exist yet) — note that plainly rather than skipping it silently once Epic A ships.

---

## Self-Review Notes

- **Spec coverage:** the skill file's frontmatter (Task 1, Step 1), the full workflow (estimate → pick best region → refine with a wait-warning → `/results/{searchId}` link), and the "Errores comunes" error-handling section are all copied verbatim from the approved spec's Architecture section — nothing paraphrased or altered. The spec's Testing section (manual verification) is Task 1's Step 4.
- **Placeholder scan:** none — the file content is complete and final, not a sketch; the one deferred item (Step 4 can't run until Epic A ships) is stated explicitly, not hidden.
- **Type consistency:** n/a — no code, no types, nothing to cross-check between tasks (this plan has exactly one task).
