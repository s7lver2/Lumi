// apps/web/app/settings/page.tsx
import { SettingsPanel } from "../components/SettingsPanel";

export default function SettingsPage() {
  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="mb-6 text-lg font-medium text-fg">Configuración</h1>
      <SettingsPanel />
    </main>
  );
}