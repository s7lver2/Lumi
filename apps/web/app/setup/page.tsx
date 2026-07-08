// apps/web/app/setup/page.tsx
import { SETTINGS_SCHEMA } from "@netryx/shared-types";
import { submitSetupAction } from "./actions";

export default function SetupPage() {
  const streetView = SETTINGS_SCHEMA.filter((s) => s.key === "GOOGLE_MAPS_API_KEY");
  const mapbox = SETTINGS_SCHEMA.filter((s) => s.key === "MAPBOX_TOKEN");
  const limits = SETTINGS_SCHEMA.filter(
    (s) => s.key !== "GOOGLE_MAPS_API_KEY" && s.key !== "MAPBOX_TOKEN"
  );

  return (
    <main>
      <h1>Configuración inicial</h1>
      <form action={submitSetupAction}>
        <fieldset>
          <legend>1. Street View</legend>
          {streetView.map((def) => (
            <label key={def.key}>
              {def.label}
              <input name={def.key} type="text" required={def.required} />
            </label>
          ))}
        </fieldset>

        <fieldset>
          <legend>2. Mapa (opcional)</legend>
          {mapbox.map((def) => (
            <label key={def.key}>
              {def.label}
              <input name={def.key} type="text" required={def.required} />
            </label>
          ))}
        </fieldset>

        <fieldset>
          <legend>3. Límites</legend>
          {limits.map((def) => (
            <label key={def.key}>
              {def.label}
              <input
                name={def.key}
                type="number"
                step="any"
                defaultValue={def.defaultValue}
                required={def.required}
              />
            </label>
          ))}
        </fieldset>

        <button type="submit">Finalizar setup</button>
      </form>
    </main>
  );
}