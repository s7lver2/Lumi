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
        "version": "1.0",
    },
    # future retrieval models are added here, without touching the rest of the code
]

VERIFICATION_MODELS = [
    # Ships empty on purpose — a verification model is only present here
    # once a catalog release providing one has been installed (the release
    # replaces this whole file, registry entry included). See
    # apps/web/app/api/model-catalog/install/route.ts.
]