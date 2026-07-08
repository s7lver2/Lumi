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