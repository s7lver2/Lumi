// apps/web/app/settings/page.tsx
"use client";

import { useEffect, useState } from "react";
import { SETTINGS_SCHEMA } from "@netryx/shared-types";

export default function SettingsPage() {
  const [values, setValues] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then(setValues);
  }, []);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setStatus(null);
    const form = new FormData(e.currentTarget);
    const body: Record<string, string> = {};
    for (const def of SETTINGS_SCHEMA) {
      const raw = form.get(def.key);
      if (raw !== null && raw !== "" && raw !== "••••••••") {
        body[def.key] = String(raw);
      }
    }

    const res = await fetch("/api/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

    if (res.ok) {
      setStatus("Guardado");
    } else {
      const json = await res.json();
      setStatus(`Error: ${json.error}`);
    }
  }

  return (
    <main>
      <h1>Configuración</h1>
      <form onSubmit={handleSubmit}>
        {SETTINGS_SCHEMA.map((def) =>
          def.type === "enum" ? (
            <label key={def.key}>
              {def.label}
              <select name={def.key} defaultValue={values[def.key] ?? def.defaultValue}>
                {(def.options ?? []).map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <label key={def.key}>
              {def.label}
              <input
                name={def.key}
                type={def.type === "number" ? "number" : "text"}
                defaultValue={values[def.key] ?? ""}
              />
            </label>
          )
        )}
        <button type="submit">Guardar</button>
      </form>
      {status && <p>{status}</p>}
      {/* Changing RETRIEVAL_MODEL/VERIFICATION_MODEL here does not take effect
          until the inference service restarts (spec §15.4) — the Indexing
          Pipeline plan is responsible for surfacing that warning in this UI
          once the inference service actually exists. */}
    </main>
  );
}