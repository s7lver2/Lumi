// apps/web/app/components/PublishWizard.tsx
"use client";
import { useEffect, useState } from "react";
import { fetchJson } from "../lib/fetch-json";
import { canAdvanceFromAreaStep, canAdvanceFromDetailsStep, canPublish } from "../lib/publish-wizard-steps";
import { getLastDatasetRepo, setLastDatasetRepo } from "../lib/last-dataset-repo";

interface Area {
  id: string;
  name: string | null;
  status: string;
  points_captured: number;
}

export function PublishWizard({ onClose, onPublished }: { onClose: () => void; onPublished: () => void }) {
  const [step, setStep] = useState(1);
  const [areas, setAreas] = useState<Area[]>([]);
  const [areasError, setAreasError] = useState<string | null>(null);
  const [selectedAreaId, setSelectedAreaId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [repo, setRepo] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    fetchJson<{ areas: Area[] }>("/api/areas").then((r) => {
      if (!r.ok) {
        setAreasError((r.data as { error?: string } | null)?.error ?? "No se pudieron cargar las áreas");
        return;
      }
      setAreas(r.data?.areas ?? []);
    });
    setRepo(getLastDatasetRepo(window.localStorage));
  }, []);

  function selectArea(area: Area) {
    setSelectedAreaId(area.id);
    if (!title && area.name) setTitle(area.name);
  }

  async function publish() {
    setStatus("Publicando…");
    const [owner, repoName] = repo.split("/");
    const { ok, data } = await fetchJson("/api/datasets/publish", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ areaId: selectedAreaId, title, description, owner, repo: repoName }),
    });
    if (!ok) {
      setStatus((data as { error?: string } | null)?.error ?? "No se pudo publicar");
      return;
    }
    setLastDatasetRepo(window.localStorage, repo);
    onPublished();
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60">
      <div className="relative w-[480px] rounded-card border border-white/10 bg-panel p-5">
        <button onClick={onClose} className="absolute right-4 top-4 text-subtle hover:text-fg">✕</button>

        <div className="mb-4 flex gap-1.5">
          {[1, 2, 3].map((s) => (
            <div key={s} className={`h-[3px] flex-1 rounded-full ${s <= step ? "bg-[#85b7eb]" : "bg-white/10"}`} />
          ))}
        </div>

        {step === 1 && (
          <div>
            <div className="mb-3 text-xs text-muted">Paso 1 de 3 — Elige el área</div>
            {areasError && <div className="mb-3 text-xs text-danger-fg">{areasError}</div>}
            <div className="max-h-[280px] overflow-y-auto">
              {areas.map((area) => {
                const indexed = area.status === "indexed";
                const selected = selectedAreaId === area.id;
                return (
                  <div
                    key={area.id}
                    onClick={() => indexed && selectArea(area)}
                    className={`mb-2 flex items-center justify-between rounded-md border px-3 py-2.5 ${
                      !indexed
                        ? "cursor-default border-white/10 opacity-40"
                        : selected
                        ? "cursor-pointer border-[#85b7eb]"
                        : "cursor-pointer border-white/10 hover:border-white/25"
                    }`}
                  >
                    <div>
                      <div className="text-[12.5px] text-fg">{area.name ?? "(sin nombre)"}</div>
                      <div className="text-[10.5px] text-subtle">
                        {indexed ? `${area.points_captured} puntos · indexada` : "no disponible aún"}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="mt-4 flex justify-end">
              <button
                disabled={!canAdvanceFromAreaStep(selectedAreaId)}
                onClick={() => setStep(2)}
                className="rounded-md bg-accent px-4 py-2 text-xs font-medium text-black disabled:opacity-50"
              >
                Siguiente →
              </button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div>
            <div className="mb-3 text-xs text-muted">Paso 2 de 3 — Detalles</div>
            <label className="mb-1 block text-xs text-muted">Título</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="mb-3 w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-fg outline-none focus:border-white/25"
            />
            <label className="mb-1 block text-xs text-muted">Descripción (opcional)</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="mb-3 h-20 w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-fg outline-none focus:border-white/25"
            />
            <div className="flex justify-between">
              <button onClick={() => setStep(1)} className="rounded-md px-4 py-2 text-xs text-muted hover:text-fg">
                ← Volver
              </button>
              <button
                disabled={!canAdvanceFromDetailsStep(title)}
                onClick={() => setStep(3)}
                className="rounded-md bg-accent px-4 py-2 text-xs font-medium text-black disabled:opacity-50"
              >
                Siguiente →
              </button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div>
            <div className="mb-3 text-xs text-muted">Paso 3 de 3 — Destino y publicar</div>
            <label className="mb-1 block text-xs text-muted">Repositorio destino (owner/repo)</label>
            <input
              value={repo}
              onChange={(e) => setRepo(e.target.value)}
              placeholder="owner/repo"
              className="mb-3 w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-fg outline-none focus:border-white/25"
            />
            <div className="mb-3 rounded-md border border-dashed border-white/22 bg-white/[.03] px-3 py-2 text-xs text-muted">
              🔒 Se publicará etiquetado con tu modelo de retrieval activo ahora mismo (no editable).
            </div>
            <div className="mb-3 flex items-start gap-2 rounded-md border border-[rgba(163,51,51,0.4)] bg-[rgba(163,51,51,0.08)] px-3 py-2.5 text-[11.5px] text-danger-fg">
              <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} className="mt-0.5" />
              <span>
                Entiendo que publicar contenido de Street View reempaquetado a otros usuarios puede infringir los
                Términos de Servicio de Google Maps Platform (ver docs/PROOF_OF_CONCEPT.md §3.1) y asumo esa responsabilidad.
              </span>
            </div>
            <div className="flex items-center justify-between">
              <button onClick={() => setStep(2)} className="rounded-md px-4 py-2 text-xs text-muted hover:text-fg">
                ← Volver
              </button>
              <div className="flex items-center gap-3">
                {status && <span className="text-xs text-muted">{status}</span>}
                <button
                  disabled={!canPublish(repo, accepted)}
                  onClick={publish}
                  className="rounded-md bg-accent px-4 py-2 text-xs font-medium text-black disabled:opacity-50"
                >
                  Publicar
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
