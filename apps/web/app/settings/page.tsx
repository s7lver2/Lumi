// apps/web/app/settings/page.tsx
import { SettingsPanel } from "../components/SettingsPanel";
import { ModelUsageSection } from "../components/ModelUsageSection";

export default function SettingsPage() {
  return (
    <main className="mx-auto max-w-[1100px] p-8">
      <h1 className="mb-6 text-lg font-medium text-fg">Configuración</h1>
      <SettingsPanel />
      <ModelUsageSection />
    </main>
  );
}
