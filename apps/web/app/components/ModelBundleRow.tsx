// apps/web/app/components/ModelBundleRow.tsx
"use client";
import { MODEL_BUNDLES, resolveModelBundle, type ModelBundleDefinition } from "@netryx/shared-types";
import { Menu } from "./Menu";

export function ModelBundleRow({
  retrievalModelId,
  onChange,
}: {
  retrievalModelId: string;
  onChange: (bundle: ModelBundleDefinition) => void;
}) {
  const current = resolveModelBundle(retrievalModelId);

  if (!current) {
    return (
      <div className="rounded-md border border-dashed border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning-fg">
        La combinación actual de modelos no corresponde a ningún paquete conocido.
      </div>
    );
  }

  return (
    <Menu
      value={current.id}
      onChange={(id) => {
        const bundle = MODEL_BUNDLES.find((b) => b.id === id);
        if (bundle) onChange(bundle);
      }}
      options={MODEL_BUNDLES.map((b) => ({ value: b.id, label: b.displayName }))}
    />
  );
}
