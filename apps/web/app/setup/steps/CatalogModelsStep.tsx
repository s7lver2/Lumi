// apps/web/app/setup/steps/CatalogModelsStep.tsx
"use client";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { fadeRise } from "../../lib/motion";
import { fetchJson } from "../../lib/fetch-json";
import type { CatalogBundle, CodeBundleCatalogRelease, GenericClassifierCatalogRelease } from "../../lib/catalog-types";

/** Auto-selects the release with the highest accuracyWithin50m across every
 * bundle the marketplace currently offers — used so setup can install
 * something sensible by default without making the operator pick, while
 * still showing what was picked and why. Pure function so it's unit
 * testable without rendering anything (this repo's convention: no
 * DOM/component-render tests). */
export function pickDefaultRelease(
  bundles: CatalogBundle[]
): { owner: string; repo: string; release: CodeBundleCatalogRelease } | null {
  let best: { owner: string; repo: string; release: CodeBundleCatalogRelease } | null = null;
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

/** One recommended release per distinct classifier modelId (Wanda, Velle,
 * any future one) across every bundle — the first generic-classifier
 * release encountered for that modelId, since listReleasesForRepo's
 * GitHub API call already returns releases newest-first (spec: docs/
 * superpowers/specs/2026-07-20-setup-recommended-models-design.md). No
 * benchmark comparison: GenericClassifierBenchmark has no accuracy figure
 * to rank by. These are always optional — never gate onComplete(). */
export function pickRecommendedClassifiers(
  bundles: CatalogBundle[]
): { owner: string; repo: string; release: GenericClassifierCatalogRelease }[] {
  const seen = new Set<string>();
  const picked: { owner: string; repo: string; release: GenericClassifierCatalogRelease }[] = [];
  for (const bundle of bundles) {
    for (const release of bundle.releases) {
      if (release.kind !== "generic-classifier") continue;
      if (seen.has(release.modelId)) continue;
      seen.add(release.modelId);
      picked.push({ owner: bundle.owner, repo: bundle.repo, release });
    }
  }
  return picked;
}

type ClassifierStatus = "idle" | "installing" | "done" | "error";

export function CatalogModelsStep({ onComplete }: { onComplete: () => void }) {
  const [bundles, setBundles] = useState<CatalogBundle[]>([]);
  const [status, setStatus] = useState<"loading" | "idle" | "installing" | "done" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [classifierStatus, setClassifierStatus] = useState<Record<string, ClassifierStatus>>({});

  useEffect(() => {
    fetchJson<{ bundles: CatalogBundle[] }>("/api/model-catalog").then((r) => {
      setBundles(r.data?.bundles ?? []);
      setStatus("idle");
    });
  }, []);

  const picked = pickDefaultRelease(bundles);
  const recommendedClassifiers = pickRecommendedClassifiers(bundles);

  async function install() {
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

  async function installClassifier(item: { owner: string; repo: string; release: GenericClassifierCatalogRelease }) {
    setClassifierStatus((s) => ({ ...s, [item.release.modelId]: "installing" }));
    const { ok } = await fetchJson<{ error?: string }>("/api/model-catalog/install", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ owner: item.owner, repo: item.repo, tag: item.release.tag }),
    });
    setClassifierStatus((s) => ({ ...s, [item.release.modelId]: ok ? "done" : "error" }));
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

      {picked && status !== "done" && (
        <p className="mb-2 text-xs text-muted">
          Recomendado: <b className="text-fg">v{picked.release.version}</b> —{" "}
          {Math.round(picked.release.benchmark.accuracyWithin50m * 100)}% ≤ 50m (mejor precisión disponible)
        </p>
      )}

      {picked && status !== "done" && (
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

      {picked && recommendedClassifiers.length > 0 && (
        <div className="mt-5 border-t border-white/10 pt-4">
          <div className="mb-0.5 text-xs font-medium text-fg">Clasificadores disponibles (opcional)</div>
          <p className="mb-2 text-[11px] text-muted">Puedes instalarlos ahora o más tarde desde Ajustes → Modelos.</p>
          <div className="space-y-1.5">
            {recommendedClassifiers.map((item) => {
              const st = classifierStatus[item.release.modelId] ?? "idle";
              return (
                <div key={item.release.modelId} className="flex items-center justify-between text-xs text-muted">
                  <span>
                    <b className="text-fg">{item.release.modelId}</b> · {item.release.facets.map((f) => f.facet).join(", ")}
                  </span>
                  <button
                    onClick={() => installClassifier(item)}
                    disabled={st === "installing" || st === "done"}
                    className="rounded-md border border-white/20 bg-white/[.06] px-3 py-1 text-[11px] text-fg hover:bg-white/10 disabled:opacity-50"
                  >
                    {st === "installing" ? "Instalando…" : st === "done" ? "Instalado" : st === "error" ? "Reintentar" : "Instalar"}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </motion.div>
  );
}