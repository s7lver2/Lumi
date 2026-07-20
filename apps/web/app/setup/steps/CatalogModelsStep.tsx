// apps/web/app/setup/steps/CatalogModelsStep.tsx
"use client";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { fadeRise } from "../../lib/motion";
import { fetchJson } from "../../lib/fetch-json";

interface CatalogRelease {
  kind: "code-bundle" | "generic-classifier";
  tag: string;
  version: string;
  benchmark: { accuracyWithin50m: number };
}
interface CatalogBundleEntry {
  owner: string;
  repo: string;
  releases: CatalogRelease[];
}

/** Auto-selects the release with the highest accuracyWithin50m across every
 * bundle the marketplace currently offers — used so setup can install
 * something sensible by default without making the operator pick, while
 * still showing what was picked and why. Pure function so it's unit
 * testable without rendering anything (this repo's convention: no
 * DOM/component-render tests). */
export function pickDefaultRelease(
  bundles: CatalogBundleEntry[]
): { owner: string; repo: string; release: CatalogRelease } | null {
  let best: { owner: string; repo: string; release: CatalogRelease } | null = null;
  for (const bundle of bundles) {
    for (const release of bundle.releases) {
      // Setup only ever auto-installs the mandatory retrieval/verification
      // model — a generic-classifier release (Wanda/Velle) is always an
      // optional, later Ajustes → Modelos install (spec: docs/superpowers/
      // specs/2026-07-20-unified-model-catalog-design.md, "Setup wizard"),
      // regardless of what number its own benchmark shape happens to carry.
      if (release.kind !== "code-bundle") continue;
      if (!best || release.benchmark.accuracyWithin50m > best.release.benchmark.accuracyWithin50m) {
        best = { owner: bundle.owner, repo: bundle.repo, release };
      }
    }
  }
  return best;
}

export function CatalogModelsStep({ onComplete }: { onComplete: () => void }) {
  const [bundles, setBundles] = useState<CatalogBundleEntry[]>([]);
  const [status, setStatus] = useState<"loading" | "idle" | "installing" | "done" | "error">("loading");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchJson<{ bundles: CatalogBundleEntry[] }>("/api/model-catalog").then((r) => {
      setBundles(r.data?.bundles ?? []);
      setStatus("idle");
    });
  }, []);

  async function install() {
    const picked = pickDefaultRelease(bundles);
    if (!picked) {
      setError("No hay ninguna versión disponible en el marketplace todavía.");
      setStatus("error");
      return;
    }
    setStatus("installing");
    const { ok, data } = await fetchJson<{ error?: string }>("/api/model-catalog/install", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ owner: picked.owner, repo: picked.repo, tag: picked.release.tag }),
    });
    if (!ok) {
      setError(data?.error ?? "No se pudo instalar el modelo");
      setStatus("error");
      return;
    }
    setStatus("done");
    onComplete();
  }

  return (
    <motion.div variants={fadeRise} initial="hidden" animate="show">
      <div className="mb-0.5 text-[15px] font-medium text-fg">Modelo desde el marketplace</div>
      <p className="mb-4 text-xs text-muted">
        Instala un modelo de recuperación + verificación publicado en tu catálogo. Podrás desinstalarlo o cambiarlo
        más tarde desde Ajustes → Modelos.
      </p>

      {status === "loading" && <p className="text-xs text-muted">Consultando el marketplace…</p>}

      {status !== "loading" && bundles.length === 0 && (
        <p className="text-xs text-warning-fg">
          No hay ningún catálogo configurado todavía (falta GITHUB_TOKEN/MODEL_CATALOG_REPO en Ajustes) — puedes
          completar la instalación más tarde desde Ajustes → Modelos.
        </p>
      )}

      {bundles.length > 0 && status !== "done" && (
        <button
          onClick={install}
          disabled={status === "installing"}
          className="rounded-md bg-accent px-4 py-2 text-xs font-medium text-black disabled:opacity-50"
        >
          {status === "installing" ? "Instalando…" : "Instalar modelo recomendado"}
        </button>
      )}

      {status === "done" && <p className="text-xs text-fg">Modelo instalado.</p>}
      {error && <p className="mt-2 text-xs text-danger-fg">{error}</p>}
    </motion.div>
  );
}
