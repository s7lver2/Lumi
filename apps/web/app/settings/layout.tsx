// apps/web/app/settings/layout.tsx
import { PageFadeTransition } from "../components/PageFadeTransition";

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return <PageFadeTransition>{children}</PageFadeTransition>;
}