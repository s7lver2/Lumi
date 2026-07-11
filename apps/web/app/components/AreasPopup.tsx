// apps/web/app/components/AreasPopup.tsx
"use client";
import { useEffect, useState } from "react";
import { FloatingCard } from "./FloatingCard";
import { Badge } from "./Badge";
import { statusTone } from "../lib/area-status";
import { fetchJson } from "../lib/fetch-json";
import type { AreaStatus } from "@netryx/shared-types";

interface AreaItem { id: string; name: string | null; area_km2: string | number; status: AreaStatus; images_embedded: number; created_at: string }

export function AreasPopup({
  onClose, onShowArea, onChanged,
}: { onClose: () => void; onShowArea: (id: string) => void; onChanged?: () => void }) {
  const [areas, setAreas] = useState<AreaItem[]>([]);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { fetchJson<{ areas: AreaItem[] }>("/api/areas").then((r) => setAreas(r.data?.areas ?? [])); }, []);

  async function cancelArea(id: string) {
    setCancellingId(id);
    const { ok } = await fetchJson(`/api/areas/${id}/cancel`, { method: "POST" });
    setCancellingId(null);
    if (ok) {
      setAreas((prev) => prev.map((a) => (a.id === id ? { ...a, status: "cancelled" } : a)));
      onChanged?.();
    }
  }

  async function deleteArea(id: string) {
    setDeletingId(id);
    setError(null);
    const { ok, data } = await fetchJson<{ error?: string }>(`/api/areas/${id}`, { method: "DELETE" });
    setDeletingId(null);
    if (ok) {
      setAreas((prev) => prev.filter((a) => a.id !== id));
      onChanged?.();
    } else {
      // e.g. the area is still "pending"/"indexing" — the route now refuses
      // to delete it out from under an active worker job (spec: confirmed
      // live "violates foreign key constraint indexed_images_area_id_fkey"
      // when this used to succeed silently mid-job). Cancel first.
      setError(data?.error ?? "No se pudo borrar el área");
    }
  }

  return (
    // Sin posicionamiento propio a propósito: el padre (el mismo contenedor
    // flex que envuelve AreasNotification) lo coloca en flujo normal, justo
    // debajo del botón — así nunca se solapan sea cual sea la altura de este.
    <div className="w-80">
      <FloatingCard className="max-h-[70vh] overflow-y-auto p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-medium text-fg">Áreas indexadas</span>
          <button onClick={onClose} className="text-subtle hover:text-fg" aria-label="Cerrar">✕</button>
        </div>
        {error && <p className="mb-2 rounded-md bg-danger/10 px-2 py-1.5 text-xs text-danger-fg">{error}</p>}
        <div className="space-y-2">
          {areas.map((a) => {
            const cancellable = a.status === "pending" || a.status === "indexing";
            return (
              // div, no button: contiene botones anidados, y <button> dentro
              // de <button> es HTML inválido.
              <div key={a.id} role="button" tabIndex={0} onClick={() => onShowArea(a.id)}
                className="block w-full cursor-pointer rounded-card border border-border p-2.5 text-left hover:border-white/20">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-fg">{a.name ?? "Área"}</span>
                  <div className="flex items-center gap-2">
                    <Badge tone={statusTone(a.status)}>{a.status}</Badge>
                    {cancellable && (
                      <button
                        onClick={(e) => { e.stopPropagation(); cancelArea(a.id); }}
                        disabled={cancellingId === a.id}
                        className="rounded-md border border-white/10 px-2 py-0.5 text-[11px] text-fg hover:bg-white/10 disabled:opacity-50"
                      >
                        {cancellingId === a.id ? "…" : "Cancelar"}
                      </button>
                    )}
                    <button
                      onClick={(e) => { e.stopPropagation(); deleteArea(a.id); }}
                      disabled={deletingId === a.id}
                      aria-label="Quitar área"
                      className="rounded-md border border-white/10 px-2 py-0.5 text-[11px] text-danger-fg hover:bg-white/10 disabled:opacity-50"
                    >
                      {deletingId === a.id ? "…" : "✕"}
                    </button>
                  </div>
                </div>
                <div className="mt-1 text-xs text-muted">{Number(a.area_km2).toFixed(1)} km² · {a.images_embedded.toLocaleString()} imágenes</div>
              </div>
            );
          })}
          {areas.length === 0 && <p className="text-xs text-muted">Aún no hay áreas indexadas.</p>}
        </div>
      </FloatingCard>
    </div>
  );
}