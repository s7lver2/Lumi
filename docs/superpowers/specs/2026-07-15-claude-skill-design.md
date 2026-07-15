# Claude skill for API interaction (Epic D) — design spec

Status: approved (design phase) — implementation not started.
Related: `docs/superpowers/backlog/2026-07-14-api-first-model-catalog-initiative.md`
(Epic D) — depends entirely on Epic A
(`docs/superpowers/specs/2026-07-14-api-first-architecture-design.md`,
planned but not yet implemented) for the endpoints this skill calls.

## Context

A Claude Code skill that lets a user hand Claude a photo and ask "where
was this taken?", with Claude calling Lumi's own API end-to-end
(estimate → refine → result) instead of the user having to drive the web
UI themselves.

Since Lumi is self-hosted (each user runs their own instance, typically at
`http://localhost:3000`), and no `.claude/skills/` directory exists in this
repo yet, this skill is bundled directly in the Lumi repo — anyone with
Claude Code open in their own Lumi checkout gets it automatically, the
same discovery mechanism already used for the `superpowers` skills
throughout this project's own tooling.

**Explicit scope decision:** the skill hardcodes today's exact endpoint
paths (`/api/models/lumi-preview/estimate` etc.) rather than discovering
them dynamically via `GET /api/models`'s self-describing response. Simpler
and more explicit now; if a second model is ever added, this file gets a
small update — an accepted, disclosed trade-off, not an oversight.

## Goals

- A single `SKILL.md`, no custom scripts — every HTTP call is a plain
  `curl` command Claude runs via Bash, since `curl` already handles
  multipart upload and SSE streaming natively.
- Covers the full pipeline: estimate → pick the best region → refine →
  show the user a real, shareable result (the `/results/{searchId}` page),
  not raw coordinates.
- Handles the realistic failure modes (Lumi not running, no matches found,
  refinement error) with clear guidance, not silent failure or invention.

## Non-goals

- Dynamic discovery via `GET /api/models` — explicitly rejected in favor
  of hardcoded paths (see Context).
- Any new server-side code — this epic only adds one Markdown file to
  `.claude/skills/`.
- Authentication/API keys for the skill's own calls — inherits the same
  no-auth, trusted-local-network boundary as every other route.
- A custom MCP server or wrapper script — `curl` already does everything
  needed in one command per step.

## Architecture

### File

`.claude/skills/lumi-geolocate/SKILL.md`:

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

Note the "estimate 404/409" guidance is the one place this skill *does*
fall back to `GET /api/models` — not for routine discovery, but as an
error-recovery path when the hardcoded id turns out to be wrong.

## Error handling

Covered inline in the `SKILL.md` body above (see "Errores comunes") — this
section exists in the spec for completeness, not as a separate mechanism:
unreachable instance, wrong/inactive model id, empty results, and a failed
refinement all get explicit, distinct guidance rather than one generic
"something went wrong."

## Testing

Since this skill is pure Markdown with no code of its own, there's no unit
test surface. Verification is manual: with a real local Lumi instance
running and at least one indexed area, ask Claude (with this skill
installed) "where was this photo taken?" attaching a real image from an
already-indexed area, and confirm it runs estimate → warns about the wait
→ refines → hands back a working `/results/{searchId}` link with the
correct candidate, rather than just loose coordinates.
